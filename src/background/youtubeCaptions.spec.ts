import { describe, expect, it, vi } from 'vitest'
import { fetchYoutubeCaptionTrack } from './youtubeCaptions'

const videoId = 'dQw4w9WgXcQ'
const captionUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`
const maxYoutubeCaptionBytes = 4 * 1024 * 1024

interface FakeResponseOptions {
  url?: string
  status?: number
  contentLength?: number | null
  text?: string
}

function fakeResponse(options: FakeResponseOptions = {}) {
  const status = options.status ?? 200
  const headers = new Map<string, string>()
  if (options.contentLength !== undefined && options.contentLength !== null)
    headers.set('content-length', String(options.contentLength))

  const response = {
    ok: status >= 200 && status < 300,
    status,
    url: options.url ?? '',
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    body: undefined,
    text: async () => options.text ?? '',
  }

  return response as unknown as Response
}

/** A fresh Response per call: the injected fetch boundary only exists in the worker. */
function createFetcher(responder: () => Response) {
  const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => responder())
  return { mock, fetchImpl: mock as unknown as typeof fetch }
}

describe('fetchYoutubeCaptionTrack', () => {
  it.each([
    ['an unrelated host', 'https://evil.example/api/timedtext?v=dQw4w9WgXcQ'],
    ['plain http', `http://www.youtube.com/api/timedtext?v=${videoId}`],
    ['a lookalike suffix host', `https://www.youtube.com.evil.example/api/timedtext?v=${videoId}`],
    ['a different api path', `https://www.youtube.com/api/v3/player?v=${videoId}`],
    ['a missing video id', 'https://www.youtube.com/api/timedtext'],
  ])('refuses %s without issuing a request', async (_name, url) => {
    const { mock, fetchImpl } = createFetcher(() => fakeResponse())

    const result = await fetchYoutubeCaptionTrack(url, { fetchImpl })

    expect(result.ok).toBe(false)
    expect(mock).not.toHaveBeenCalled()
  })

  it('requests the JSON3 rendition without credentials and returns the body', async () => {
    const requested: string[] = []
    const { fetchImpl, mock } = createFetcher(() => fakeResponse({ url: requested[0], text: '{"events":[]}' }))
    vi.mocked(fetchImpl).mockImplementation(async (input: RequestInfo | URL) => {
      requested.push(String(input))
      return fakeResponse({ url: String(input), text: '{"events":[]}' })
    })

    const result = await fetchYoutubeCaptionTrack(captionUrl, { fetchImpl })

    expect(mock).toHaveBeenCalledTimes(1)
    const [requestedUrl, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(requestedUrl).toBe(`${captionUrl}&fmt=json3`)
    expect(init.credentials).toBe('omit')
    expect(init.redirect).toBe('follow')
    expect(init.headers).toEqual({ accept: 'application/json' })
    expect(result).toEqual({ ok: true, text: '{"events":[]}' })
  })

  it('overrides a stale fmt already present on the track url', async () => {
    const { mock, fetchImpl } = createFetcher(() => fakeResponse())
    mock.mockImplementation(async (input: RequestInfo | URL) => fakeResponse({ url: String(input) }))

    await fetchYoutubeCaptionTrack(`https://www.youtube.com/api/timedtext?v=${videoId}&fmt=srv3`, { fetchImpl })

    const [requestedUrl] = mock.mock.calls[0] as [string, RequestInit]
    expect(requestedUrl).toBe(`https://www.youtube.com/api/timedtext?v=${videoId}&fmt=json3`)
  })

  it('rejects a redirect that leaves the YouTube host', async () => {
    const { fetchImpl } = createFetcher(() => fakeResponse({ status: 200, url: 'https://evil.example/api/timedtext?v=dQw4w9WgXcQ' }))

    const result = await fetchYoutubeCaptionTrack(captionUrl, { fetchImpl })

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ error: expect.stringContaining('HTTP 200') })
  })

  it('accepts a redirect that stays on the YouTube host', async () => {
    const { fetchImpl } = createFetcher(() => fakeResponse({ status: 200, url: `https://youtube.com/api/timedtext?v=${videoId}&fmt=json3`, text: '{}' }))

    expect(await fetchYoutubeCaptionTrack(captionUrl, { fetchImpl })).toEqual({ ok: true, text: '{}' })
  })

  it('surfaces an HTTP failure status', async () => {
    const { fetchImpl } = createFetcher(() => fakeResponse({ status: 503, url: captionUrl }))

    expect(await fetchYoutubeCaptionTrack(captionUrl, { fetchImpl })).toMatchObject({
      ok: false,
      error: expect.stringContaining('HTTP 503'),
    })
  })

  it('rejects a declared body larger than the cap', async () => {
    const { fetchImpl } = createFetcher(() => fakeResponse({ url: captionUrl, contentLength: maxYoutubeCaptionBytes + 1 }))

    expect(await fetchYoutubeCaptionTrack(captionUrl, { fetchImpl })).toMatchObject({ ok: false })
  })

  it('maps an aborted request to a cancellation error', async () => {
    const controller = new AbortController()
    controller.abort()
    const { fetchImpl } = createFetcher(() => {
      throw new Error('network abort')
    })

    expect(await fetchYoutubeCaptionTrack(captionUrl, { fetchImpl, signal: controller.signal })).toEqual({
      ok: false,
      error: 'YouTube 字幕请求已取消',
    })
  })

  it('surfaces an unexpected transport failure message', async () => {
    const { fetchImpl } = createFetcher(() => {
      throw new Error('connection reset')
    })

    expect(await fetchYoutubeCaptionTrack(captionUrl, { fetchImpl })).toEqual({ ok: false, error: 'connection reset' })
  })
})
