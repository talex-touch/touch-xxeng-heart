import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAiChat, runAiTest } from './aiRunner'
import { mergeSettings } from './defaults'
import { settingsStorageKey } from './storageKeys'
import type { LexiSettings } from './types'

/**
 * The runner is the only place that holds a credential and touches the network, so the
 * protocol routing, header and endpoint-policy checks belong here rather than at the
 * scene layer that just shapes prompts.
 */

const mocks = vi.hoisted(() => ({ settings: undefined as LexiSettings | undefined }))

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true }) },
    storage: {
      local: {
        get: vi.fn(async () => ({ [settingsStorageKey]: JSON.stringify(mocks.settings) })),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  },
}))

function useSettings(patch: (settings: LexiSettings) => void) {
  const settings = mergeSettings()
  patch(settings)
  mocks.settings = settings
  return settings
}

function stubFetch(body: unknown) {
  // A fresh Response per call: a body can only be read once.
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function stubChatCompletion(content = 'context') {
  return stubFetch({ choices: [{ message: { content } }] })
}

describe('ai runner transport policy', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects redirects at the fetch layer', async () => {
    useSettings((settings) => {
      settings.ai.selection.enabled = true
      settings.ai.providers[0].endpoint = 'https://api.example.com/v1'
      settings.ai.providers[0].model = 'test-model'
    })
    const fetchMock = stubChatCompletion()

    await runAiTest('selection', 'ping')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error' })
  })

  it('takes the connection from the provider the scene is bound to', async () => {
    useSettings((settings) => {
      settings.ai.selection.enabled = true
      settings.ai.providers[0] = {
        ...settings.ai.providers[0],
        endpoint: 'https://provider.example.com/v1',
        apiKey: 'provider-key',
        model: 'provider-model',
      }
    })
    stubChatCompletion()

    const result = await runAiTest('selection', 'ping')

    expect(result.request).toMatchObject({
      endpoint: 'https://provider.example.com/v1/chat/completions',
      protocol: 'openai-chat',
      model: 'provider-model',
      authSent: true,
      keyHint: '...-key',
    })
  })

  it('sends a Responses provider to /v1/responses with instructions', async () => {
    const settings = useSettings((value) => {
      value.ai.selection.enabled = true
      value.ai.providers[0] = {
        ...value.ai.providers[0],
        protocol: 'openai-responses',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5',
      }
    })
    const fetchMock = stubFetch({
      output: [{ type: 'message', content: [{ type: 'output_text', text: '乐观更新' }] }],
      usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
    })

    const result = await runAiTest('selection', 'optimistic update', settings.ai.providers[0])

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses')
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(body.instructions).toContain('翻译')
    expect(body.input[0].content[0].type).toBe('input_text')
    expect(body.messages).toBeUndefined()
    expect(result.response).toBe('乐观更新')
  })

  it('routes Claude models to the Anthropic messages API', async () => {
    useSettings((settings) => {
      settings.ai.selection.enabled = true
      settings.ai.providers[0] = {
        ...settings.ai.providers[0],
        protocol: 'auto',
        endpoint: 'https://api.anthropic.com',
        apiKey: 'sk-ant-test',
        model: 'claude-sonnet-4-5',
      }
    })
    const fetchMock = stubFetch({
      content: [{ type: 'text', text: '乐观更新' }],
      usage: { input_tokens: 9, output_tokens: 3 },
    })

    const result = await runAiTest('selection', 'optimistic update')

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toMatchObject({
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
    })
    const body = JSON.parse(init.body as string)
    expect(body.system).toContain('翻译')
    expect(body.messages[0].role).toBe('user')
    expect(result.request.protocol).toBe('anthropic-messages')
    expect(result.response).toBe('乐观更新')
  })

  it('answers nothing and calls nobody when the scene is off', async () => {
    useSettings((settings) => {
      settings.ai.digest.enabled = false
      settings.ai.providers[0].endpoint = 'https://api.example.com/v1'
      settings.ai.providers[0].model = 'test-model'
    })
    const fetchMock = stubChatCompletion()

    const result = await runAiChat({ scene: 'digest', messages: [{ role: 'user', content: 'hi' }] })

    expect(result).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an unapproved HTTP endpoint before any request', async () => {
    useSettings((settings) => {
      settings.ai.selection.enabled = true
      settings.ai.providers[0].endpoint = 'http://192.168.1.9:11434/v1'
      settings.ai.providers[0].model = 'test-model'
    })
    const fetchMock = stubChatCompletion()

    await expect(runAiChat({ scene: 'selection', messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow(/尚未确认/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('carries the scene prompt as the system message unless one is supplied', async () => {
    useSettings((settings) => {
      settings.ai.selection.enabled = true
      settings.ai.selection.prompt = '场景默认提示词'
      settings.ai.providers[0].endpoint = 'https://api.example.com/v1'
      settings.ai.providers[0].model = 'test-model'
    })
    const fetchMock = stubChatCompletion('ok')

    await runAiChat({ scene: 'selection', messages: [{ role: 'user', content: 'hi' }] })
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).messages[0]).toMatchObject({
      role: 'system',
      content: '场景默认提示词',
    })

    await runAiChat({ scene: 'selection', messages: [{ role: 'user', content: 'hi' }], system: '任务专用提示词' })
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string).messages[0]).toMatchObject({
      role: 'system',
      content: '任务专用提示词',
    })
  })
})
