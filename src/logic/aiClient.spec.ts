import { afterEach, describe, expect, it, vi } from 'vitest'
import { testAiScene } from './aiClient'
import { mergeSettings } from './defaults'

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({ ok: true }),
    },
  },
}))

function stubSuccessfulAiResponse() {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { content: 'context' } }],
  }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  return fetchMock
}

describe('ai client transport policy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects redirects at the fetch layer', async () => {
    const settings = mergeSettings()
    settings.ai.selection.enabled = true
    settings.ai.providers[0].endpoint = 'https://api.example.com/v1'
    settings.ai.providers[0].model = 'test-model'

    const fetchMock = stubSuccessfulAiResponse()

    await testAiScene(settings, 'selection')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      redirect: 'error',
    })
  })

  it('uses the legacy global connection when no providers are available', async () => {
    const settings = mergeSettings()
    settings.ai.selection.enabled = true
    settings.ai.providers = []
    settings.ai.global = {
      endpoint: 'https://legacy.example.com/v1',
      apiKey: 'legacy-key',
      model: 'legacy-model',
    }
    stubSuccessfulAiResponse()

    const result = await testAiScene(settings, 'selection')

    expect(result.request).toMatchObject({
      endpoint: 'https://legacy.example.com/v1/chat/completions',
      model: 'legacy-model',
      authSent: true,
      keyHint: '...-key',
    })
  })

  it('merges global, provider and scene connections in precedence order', async () => {
    const settings = mergeSettings()
    settings.ai.selection.enabled = true
    settings.ai.global = {
      endpoint: 'https://global.example.com/v1',
      apiKey: 'global-key',
      model: 'global-model',
    }
    settings.ai.providers[0].endpoint = 'https://provider.example.com/v1'
    settings.ai.selection.model = 'scene-model'
    stubSuccessfulAiResponse()

    const result = await testAiScene(settings, 'selection')

    expect(result.request).toMatchObject({
      endpoint: 'https://provider.example.com/v1/chat/completions',
      model: 'scene-model',
      authSent: true,
      keyHint: '...-key',
    })
  })
})
