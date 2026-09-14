import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listProviderModels, runAiChat, runAiTest } from './aiRunner'
import { mergeSettings } from './defaults'
import { NEXUS_BASE_URL, createNexusProviderConfig } from './nexusClient'
import { settingsStorageKey } from './storageKeys'
import type { AiProviderConfig, LexiSettings } from './types'

/**
 * The runner is where a scene becomes a capability.
 *
 * The Nexus channel is not OpenAI-shaped, so the tests that matter are: a structured scene
 * must still arrive as `text.chat`, an explicit direct translation must arrive as
 * `text.translate` item by item, and a partial batch must come back as-is instead of being
 * replayed through another provider (which would pay for the same items twice).
 */

const mocks = vi.hoisted(() => ({
  settings: undefined as LexiSettings | undefined,
  authorizedFetch: vi.fn(),
  sendMessage: vi.fn(),
}))

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { sendMessage: mocks.sendMessage },
    storage: {
      local: {
        get: vi.fn(async () => ({ [settingsStorageKey]: JSON.stringify(mocks.settings) })),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  },
}))

vi.mock('../background/nexusAuth', () => ({
  nexusAuthorizedFetch: mocks.authorizedFetch,
}))

function invokeResponse(result: string, usage = { promptTokens: 3, completionTokens: 2, totalTokens: 5 }) {
  return new Response(JSON.stringify({ invocation: { result, usage } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function failureResponse(status = 500) {
  return new Response('gateway boom', { status })
}

function stubAuthorizedFetch(...responses: Array<Response | (() => Response)>) {
  const queue = [...responses]
  mocks.authorizedFetch.mockImplementation(async () => {
    const next = queue.shift()
    if (!next)
      throw new Error('unexpected Nexus fetch')
    return typeof next === 'function' ? next() : next
  })
  return mocks.authorizedFetch
}

function stubGenericFetch(content = '通用回答') {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function nexusProvider(patch: Partial<AiProviderConfig> = {}): AiProviderConfig {
  return { ...createNexusProviderConfig(1), enabled: true, ...patch }
}

function genericProvider(patch: Partial<AiProviderConfig> = {}): AiProviderConfig {
  return {
    id: 'generic',
    label: 'Generic',
    endpoint: 'https://api.example.com/v1',
    apiKey: 'sk-generic',
    model: 'gpt-4.1-mini',
    protocol: 'openai-chat',
    enabled: true,
    priority: 2,
    delayMs: 0,
    updatedAt: 0,
    ...patch,
  }
}

function useSettings(patch: (settings: LexiSettings) => void) {
  const settings = mergeSettings()
  patch(settings)
  mocks.settings = settings
  return settings
}

function bodyOf(fetchMock: { mock: { calls: unknown[][] } }, index: number) {
  return JSON.parse((fetchMock.mock.calls[index]?.[1] as RequestInit).body as string)
}

/** The AI call records the worker wrote through the analytics sink. */
function aiCallLogs() {
  return mocks.sendMessage.mock.calls
    .map(call => call[0] as { type?: string, data?: { kind?: string, item?: Record<string, unknown> } })
    .filter(message => message?.type === 'lexi-record-analytics' && message.data?.kind === 'ai')
    .map(message => message.data!.item!)
}

async function captureRunFailure(promise: Promise<unknown>) {
  try {
    await promise
  }
  catch (error) {
    return error as Error
  }

  throw new Error('expected the run to reject, but it resolved')
}

describe('nexus scene turns', () => {
  beforeEach(() => {
    mocks.authorizedFetch.mockReset()
    mocks.sendMessage.mockReset()
    mocks.sendMessage.mockResolvedValue({ ok: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('runs a structured scene as text.chat without a key or model', async () => {
    useSettings((settings) => {
      settings.ai.replacement.enabled = true
      const nexus = nexusProvider()
      settings.ai.providers = [nexus]
      settings.ai.replacement.providerIds = [nexus.id]
    })
    const fetchMock = stubAuthorizedFetch(invokeResponse('{"items":[]}'))
    const genericFetch = stubGenericFetch()

    const result = await runAiChat({
      scene: 'replacement',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(genericFetch).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/intelligence/invoke')
    const body = bodyOf(fetchMock, 0)
    expect(body.capabilityId).toBe('text.chat')
    expect(body.payload.messages.map((message: { role: string }) => message.role)).toEqual(['system', 'user'])
    expect(body.options.stream).toBe(false)
    expect(result?.text).toBe('{"items":[]}')
  })

  it('tests the connection as text.chat even with an empty model', async () => {
    const fetchMock = stubAuthorizedFetch(invokeResponse('ok'))

    const result = await runAiTest('selection', 'ping', nexusProvider())

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(bodyOf(fetchMock, 0).capabilityId).toBe('text.chat')
    expect(result.request).toMatchObject({ protocol: 'nexus-intelligence', authSent: true })
    expect(result.response).toBe('ok')
  })

  it('logs a Nexus chat call on the canonical endpoint with authSent and no key hint', async () => {
    useSettings((settings) => {
      settings.ai.replacement.enabled = true
      const nexus = nexusProvider()
      settings.ai.providers = [nexus]
      settings.ai.replacement.providerIds = [nexus.id]
    })
    stubAuthorizedFetch(invokeResponse('ok'))

    await runAiChat({ scene: 'replacement', messages: [{ role: 'user', content: 'hi' }] })

    const logs = aiCallLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      endpoint: `${NEXUS_BASE_URL}/api/v1/intelligence/invoke`,
      authSent: true,
      ok: true,
    })
    expect(logs[0].keyHint).toBeUndefined()
    expect(JSON.stringify(logs[0])).not.toMatch(/ak-|rk-|Bearer/)
  })

  it('reports and logs a Nexus connection test on the canonical endpoint without a key hint', async () => {
    stubAuthorizedFetch(invokeResponse('ok'))

    const result = await runAiTest('selection', 'ping', nexusProvider())

    expect(result.request).toMatchObject({
      endpoint: `${NEXUS_BASE_URL}/api/v1/intelligence/invoke`,
      protocol: 'nexus-intelligence',
      authSent: true,
    })
    expect(result.request.keyHint).toBeUndefined()

    const logs = aiCallLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      endpoint: `${NEXUS_BASE_URL}/api/v1/intelligence/invoke`,
      authSent: true,
    })
    expect(logs[0].keyHint).toBeUndefined()
  })

  it('describes a Nexus 401 as a re-login, never as a bad API key', async () => {
    useSettings((settings) => {
      settings.ai.replacement.enabled = true
      const nexus = nexusProvider()
      settings.ai.providers = [nexus]
      settings.ai.replacement.providerIds = [nexus.id]
    })
    stubAuthorizedFetch(new Response('unauthorized', { status: 401 }))

    const failure = await captureRunFailure(runAiChat({ scene: 'replacement', messages: [{ role: 'user', content: 'hi' }] }))

    expect(failure.message).toMatch(/Nexus 登录已失效/)
    expect(failure.message).not.toMatch(/API Key/)
    const logs = aiCallLogs()
    expect(logs[0].error).toMatch(/Nexus 登录已失效/)
    expect(logs[0].error).not.toMatch(/API Key/)
  })

  it('describes a Nexus quota failure as a credits problem, not a key problem', async () => {
    useSettings((settings) => {
      settings.ai.replacement.enabled = true
      const nexus = nexusProvider()
      settings.ai.providers = [nexus]
      settings.ai.replacement.providerIds = [nexus.id]
    })
    stubAuthorizedFetch(new Response('quota exceeded', { status: 402 }))

    const failure = await captureRunFailure(runAiChat({ scene: 'replacement', messages: [{ role: 'user', content: 'hi' }] }))

    expect(failure.message).toMatch(/Nexus 额度不足/)
    expect(failure.message).not.toMatch(/API Key/)
  })

  it('lists only the local auto model without calling the network', async () => {
    const fetchMock = stubAuthorizedFetch()
    const genericFetch = stubGenericFetch()

    const models = await listProviderModels(nexusProvider())

    expect(models).toEqual([{ id: 'auto', label: 'Nexus 自动路由' }])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(genericFetch).not.toHaveBeenCalled()
    expect(NEXUS_BASE_URL).toBe('https://tuff.tagzxia.com')
  })
})

describe('nexus direct translation', () => {
  beforeEach(() => {
    mocks.authorizedFetch.mockReset()
    mocks.sendMessage.mockReset()
    mocks.sendMessage.mockResolvedValue({ ok: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('invokes text.translate once per item and rebuilds the items shape', async () => {
    useSettings((settings) => {
      settings.ai.selection.enabled = true
      const nexus = nexusProvider()
      settings.ai.providers = [nexus]
      settings.ai.selection.providerIds = [nexus.id]
    })
    const fetchMock = stubAuthorizedFetch(invokeResponse('你好'), invokeResponse('世界'))

    const result = await runAiChat({
      scene: 'selection',
      translation: true,
      messages: [{ role: 'user', content: 'batch' }],
      directTranslation: {
        items: [{ id: 'a', text: 'hello' }, { id: 'b', text: 'world' }],
        direction: 'en-to-zh',
        output: 'items-json',
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [index, text] of ['hello', 'world'].entries()) {
      const body = bodyOf(fetchMock, index)
      expect(body.capabilityId).toBe('text.translate')
      expect(body.payload).toEqual({ text, targetLang: 'zh', sourceLang: 'en' })
    }
    expect(JSON.parse(result?.text ?? '')).toEqual({
      items: [{ id: 'a', translation: '你好' }, { id: 'b', translation: '世界' }],
    })
  })

  it('answers a single-text descriptor with plain text', async () => {
    useSettings((settings) => {
      settings.ai.selection.enabled = true
      const nexus = nexusProvider()
      settings.ai.providers = [nexus]
      settings.ai.selection.providerIds = [nexus.id]
    })
    const fetchMock = stubAuthorizedFetch(invokeResponse('你好'))

    const result = await runAiChat({
      scene: 'selection',
      translation: true,
      messages: [{ role: 'user', content: 'single' }],
      directTranslation: {
        items: [{ id: 'selection', text: 'hello' }],
        direction: 'en-to-zh',
        output: 'text',
      },
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(bodyOf(fetchMock, 0).capabilityId).toBe('text.translate')
    expect(result?.text).toBe('你好')
  })

  it('returns the successful subset without replaying it through another provider', async () => {
    useSettings((settings) => {
      settings.ai.selection.enabled = true
      const nexus = nexusProvider()
      const generic = genericProvider()
      settings.ai.providers = [nexus, generic]
      settings.ai.selection.providerIds = [nexus.id, generic.id]
    })
    const fetchMock = stubAuthorizedFetch(invokeResponse('你好'), failureResponse())
    const genericFetch = stubGenericFetch()

    const result = await runAiChat({
      scene: 'selection',
      translation: true,
      messages: [{ role: 'user', content: 'batch' }],
      directTranslation: {
        items: [{ id: 'a', text: 'hello' }, { id: 'b', text: 'world' }],
        direction: 'en-to-zh',
        output: 'items-json',
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(genericFetch).not.toHaveBeenCalled()
    expect(JSON.parse(result?.text ?? '')).toEqual({ items: [{ id: 'a', translation: '你好' }] })
  })

  it('falls through to a generic provider only when no item succeeded', async () => {
    useSettings((settings) => {
      settings.ai.selection.enabled = true
      const nexus = nexusProvider()
      const generic = genericProvider()
      settings.ai.providers = [nexus, generic]
      settings.ai.selection.providerIds = [nexus.id, generic.id]
    })
    const fetchMock = stubAuthorizedFetch(failureResponse())
    const genericFetch = stubGenericFetch('通用回答')

    const result = await runAiChat({
      scene: 'selection',
      translation: true,
      messages: [{ role: 'user', content: 'batch' }],
      directTranslation: {
        items: [{ id: 'a', text: 'hello' }],
        direction: 'en-to-zh',
        output: 'items-json',
      },
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(genericFetch).toHaveBeenCalledOnce()
    expect(result?.text).toBe('通用回答')
  })

  it('describes a direct-translation 401 as a Nexus re-login, never as a bad API key', async () => {
    useSettings((settings) => {
      settings.ai.selection.enabled = true
      const nexus = nexusProvider()
      settings.ai.providers = [nexus]
      settings.ai.selection.providerIds = [nexus.id]
    })
    const fetchMock = stubAuthorizedFetch(new Response('unauthorized', { status: 401 }))

    const failure = await captureRunFailure(runAiChat({
      scene: 'selection',
      translation: true,
      messages: [{ role: 'user', content: 'single' }],
      directTranslation: { items: [{ id: 'a', text: 'hello' }], direction: 'en-to-zh', output: 'text' },
    }))

    expect(failure.message).toMatch(/Nexus 登录已失效/)
    expect(failure.message).not.toMatch(/API Key/)

    const logs = aiCallLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      endpoint: `${NEXUS_BASE_URL}/api/v1/intelligence/invoke`,
      authSent: true,
      ok: false,
      status: 401,
    })
    expect(logs[0].error).toMatch(/Nexus 登录已失效/)
    expect(logs[0].error).not.toMatch(/API Key/)
    expect(logs[0].keyHint).toBeUndefined()
    expect(bodyOf(fetchMock, 0).capabilityId).toBe('text.translate')
  })

  it('describes a direct-translation quota failure as a Nexus credits problem', async () => {
    useSettings((settings) => {
      settings.ai.selection.enabled = true
      const nexus = nexusProvider()
      settings.ai.providers = [nexus]
      settings.ai.selection.providerIds = [nexus.id]
    })
    stubAuthorizedFetch(new Response('quota exceeded', { status: 402 }))

    const failure = await captureRunFailure(runAiChat({
      scene: 'selection',
      translation: true,
      messages: [{ role: 'user', content: 'single' }],
      directTranslation: { items: [{ id: 'a', text: 'hello' }], direction: 'en-to-zh', output: 'text' },
    }))

    expect(failure.message).toMatch(/Nexus 额度不足/)
    expect(failure.message).not.toMatch(/API Key/)
    expect(aiCallLogs()[0].error).toMatch(/Nexus 额度不足/)
  })

  it('leaves a non-Nexus provider on its unchanged prompt path', async () => {
    useSettings((settings) => {
      settings.ai.selection.enabled = true
      const generic = genericProvider({ priority: 1 })
      settings.ai.providers = [generic]
      settings.ai.selection.providerIds = [generic.id]
    })
    const fetchMock = stubAuthorizedFetch()
    const genericFetch = stubGenericFetch('通用回答')

    const result = await runAiChat({
      scene: 'selection',
      translation: true,
      messages: [{ role: 'user', content: 'hello world' }],
      directTranslation: {
        items: [{ id: 'a', text: 'hello world' }],
        direction: 'en-to-zh',
        output: 'items-json',
      },
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(genericFetch).toHaveBeenCalledOnce()
    const body = bodyOf(genericFetch, 0)
    expect(body.capabilityId).toBeUndefined()
    expect(body.messages.at(-1)).toMatchObject({ role: 'user', content: 'hello world' })
    expect(result?.text).toBe('通用回答')
  })
})
