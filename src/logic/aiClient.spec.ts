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

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'context' } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await testAiScene(settings, 'selection')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      redirect: 'error',
    })
  })
})
