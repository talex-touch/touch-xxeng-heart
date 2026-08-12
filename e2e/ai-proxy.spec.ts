import type { BrowserContext, Page } from '@playwright/test'
import {
  configureDigestProvider,
  digestPostUrl,
  expect,
  readAiCallLogs,
  routeDigestPost,
  test,
} from './fixtures'
import type { MockAiProtocol } from './mockAiServer'

/**
 * End-to-end cover for the content-script AI path.
 *
 * The mock gateway never answers a preflight, so nothing here can pass unless the request
 * left from the extension service worker. Every protocol runs once streamed and once
 * buffered, because the two take different branches through the proxy.
 */

declare const chrome: {
  runtime: {
    connect: (info: { name: string }) => {
      postMessage: (message: unknown) => void
      disconnect: () => void
      onMessage: { addListener: (fn: (message: { type: string, message?: string }) => void) => void }
      onDisconnect: { addListener: (fn: () => void) => void }
    }
  }
}

const aiPortName = 'lexi-ai'

const apiKey = 'sk-lexi-smoke'

/** Reasoning-style names take the buffered branch; anything else streams. */
const streamedModel = 'smoke-model'
const bufferedModel = 'o1-smoke'

const protocols: Array<{
  protocol: MockAiProtocol
  label: string
  authHeader: string
  path: (model: string, streamed: boolean) => string
}> = [
  {
    protocol: 'openai-chat',
    label: 'OpenAI Chat',
    authHeader: 'authorization',
    path: () => '/v1/chat/completions',
  },
  {
    protocol: 'openai-responses',
    label: 'OpenAI Responses',
    authHeader: 'authorization',
    path: () => '/v1/responses',
  },
  {
    protocol: 'anthropic-messages',
    label: 'Anthropic',
    authHeader: 'x-api-key',
    path: () => '/v1/messages',
  },
  {
    protocol: 'gemini',
    label: 'Gemini',
    authHeader: 'x-goog-api-key',
    path: (model, streamed) => (streamed
      ? `/v1beta/models/${model}:streamGenerateContent?alt=sse`
      : `/v1beta/models/${model}:generateContent`),
  },
]

function digestAnswer(label: string) {
  // Non-ASCII on purpose: the payload is flushed on byte boundaries, so a broken streaming
  // decode shows up here as replacement characters rather than as a silent pass.
  return {
    oneLine: `通过 ${label} 协议完成的摘要——代理链路正常。`,
    summary: ['缓存以内容哈希失效。'],
    keyPoints: ['跨标签页请求需要去重。'],
    viewpoints: [],
    actions: [],
    terms: ['cache'],
  }
}

async function generateDigest(context: BrowserContext, page: Page, extensionId: string, postId: string) {
  await routeDigestPost(context, {
    id: postId,
    title: 'Browser cache architecture',
    body: 'The post compares source hashes, TTLs, and cross-tab request leases in detail.',
  })

  const contentPage = await context.newPage()
  await contentPage.goto(digestPostUrl(postId))

  const card = contentPage.locator('[data-lexi-content-digest="true"]')
  await expect(card.getByRole('button', { name: '生成摘要' })).toBeVisible()
  await card.getByRole('button', { name: '生成摘要' }).click()
  return card
}

test.describe.configure({ mode: 'parallel' })

for (const item of protocols) {
  for (const streamed of [true, false]) {
    const model = streamed ? streamedModel : bufferedModel
    const mode = streamed ? '流式' : '非流式'

    test(`${item.label} ${mode}摘要经后台代理完成`, async ({ context, page, extensionId, aiServer }) => {
      const answer = digestAnswer(item.label)
      const endpoint = aiServer.endpoint(item.protocol)
      aiServer.answerWith(JSON.stringify(answer))

      await configureDigestProvider(page, extensionId, {
        protocol: item.protocol,
        endpoint,
        model,
        apiKey,
        approvals: [endpoint],
      })

      const postId = `${item.protocol}-${streamed ? 'sse' : 'json'}`
      const card = await generateDigest(context, page, extensionId, postId)
      await expect(card.getByText(answer.oneLine)).toBeVisible()

      expect(aiServer.requests).toHaveLength(1)
      const request = aiServer.requests[0]
      expect(request.route).toBe(item.protocol)
      expect(request.method).toBe('POST')
      expect(request.path).toBe(item.path(model, streamed))
      expect(request.streamed).toBe(streamed)
      expect(request.headers[item.authHeader]).toContain(apiKey)

      // Only the adapter's own headers survive the proxy, and the page origin is not one.
      expect(request.headers.cookie).toBeUndefined()
      expect(request.headers.origin).not.toBe('https://www.reddit.com')

      const logs = await readAiCallLogs(page)
      const digest = logs.find(log => log.scene === 'digest')
      expect(digest).toMatchObject({ ok: true, status: 200, model, streamed })
    })
  }
}

test('页面直连该网关会被 CORS 拦下', async ({ context, page, extensionId, aiServer }) => {
  const endpoint = aiServer.endpoint('openai-chat')
  await configureDigestProvider(page, extensionId, {
    protocol: 'openai-chat',
    endpoint,
    model: streamedModel,
    approvals: [endpoint],
  })

  await routeDigestPost(context, { id: 'cors', title: 'CORS', body: 'Direct calls from the page must fail.' })
  const contentPage = await context.newPage()
  await contentPage.goto(digestPostUrl('cors'))

  // Same headers the OpenAI adapter builds; `authorization` is what forces the preflight.
  const result = await contentPage.evaluate(async ({ url, key }) => {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${key}` },
        body: '{}',
      })
      return 'reached'
    }
    catch (error) {
      return String(error)
    }
  }, { url: `${endpoint}/chat/completions`, key: apiKey })

  // Whether the browser stops this at the preflight or at the response depends on the
  // headers and the target network; either way the page never gets to read the answer,
  // which is exactly why the content script cannot be the transport.
  expect(result).toContain('Failed to fetch')
})

/** Speaks the AI port directly, the way a compromised content script would try to. */
async function callAiPort(page: Page, command: Record<string, unknown>) {
  return page.evaluate(async ({ command, portName }) => {
    return new Promise<Array<{ type: string, message?: string }>>((resolve) => {
      const port = chrome.runtime.connect({ name: portName })
      const events: Array<{ type: string, message?: string }> = []
      const finish = () => {
        port.disconnect()
        resolve(events)
      }

      port.onMessage.addListener((event) => {
        events.push(event)
        if (event.type !== 'delta')
          finish()
      })
      port.onDisconnect.addListener(() => resolve(events))
      port.postMessage(command)
    })
  }, { command, portName: aiPortName })
}

test('后台拒绝未经确认的 HTTP 地址', async ({ page, extensionId, aiServer }) => {
  const endpoint = aiServer.endpoint('openai-chat')
  await configureDigestProvider(page, extensionId, {
    protocol: 'openai-chat',
    endpoint,
    model: streamedModel,
    approvals: [],
  })

  const events = await callAiPort(page, {
    type: 'run',
    scene: 'digest',
    messages: [{ role: 'user', content: 'ping' }],
  })

  expect(events).toHaveLength(1)
  expect(events[0].type).toBe('error')
  expect(events[0].message).toContain('尚未确认')
  expect(aiServer.requests).toHaveLength(0)
})

test('页面世界拿不到 Endpoint 和凭据', async ({ page, extensionId, aiServer }) => {
  const endpoint = aiServer.endpoint('openai-chat')
  aiServer.answerWith('{"oneLine":"credential check"}')
  await configureDigestProvider(page, extensionId, {
    protocol: 'openai-chat',
    endpoint,
    model: streamedModel,
    apiKey,
    approvals: [endpoint],
  })

  // A caller can only name a scene; the endpoint and the key are resolved worker-side.
  const events = await callAiPort(page, {
    type: 'run',
    scene: 'digest',
    messages: [{ role: 'user', content: 'ping' }],
  })

  expect(events.map(event => event.type)).toContain('done')
  expect(aiServer.requests).toHaveLength(1)
  expect(aiServer.requests[0].headers.authorization).toBe(`Bearer ${apiKey}`)

  // Nothing in the command carried an address, so a forged one has nowhere to land.
  const forged = await callAiPort(page, {
    type: 'run',
    scene: 'digest',
    messages: [{ role: 'user', content: 'ping' }],
    url: 'https://attacker.example.com/v1/chat/completions',
    headers: { authorization: 'Bearer stolen' },
  })

  expect(forged.map(event => event.type)).toContain('done')
  expect(aiServer.requests).toHaveLength(2)
  expect(aiServer.requests[1].headers.authorization).toBe(`Bearer ${apiKey}`)
})
