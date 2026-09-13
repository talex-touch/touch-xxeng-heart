import { describe, expect, it, vi } from 'vitest'
import { fetchSubtitleResource } from './subtitleResources'

const allowedUrl = 'https://events-delivery.apple.com/subtitles/en/prog_index.m3u8'

interface FakeResponseOptions {
  url?: string
  status?: number
  contentType?: string | null
  contentLength?: number | null
  text?: string
  chunks?: Uint8Array[]
}

function readerBody(list: Uint8Array[]) {
  let read = 0

  return {
    getReader: () => ({
      read: async () => {
        const value = list[read]
        if (value === undefined)
          return { done: true as const, value: undefined }

        read += 1
        return { done: false as const, value }
      },
      cancel: async () => undefined,
    }),
  }
}

function fakeResponse(options: FakeResponseOptions = {}) {
  const status = options.status ?? 200
  const headers = new Map<string, string>()
  if (options.contentType)
    headers.set('content-type', options.contentType)
  if (options.contentLength !== undefined && options.contentLength !== null)
    headers.set('content-length', String(options.contentLength))

  const response = {
    ok: status >= 200 && status < 300,
    status,
    url: options.url ?? allowedUrl,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    body: options.chunks ? readerBody(options.chunks) : undefined,
    text: async () => options.text ?? '',
  }

  return response as unknown as Response
}

/** A fresh Response per call: the injected fetch boundary only exists in the worker. */
function createFetcher(responder: () => Response) {
  const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => responder())
  return { mock, fetchImpl: mock as unknown as typeof fetch }
}

describe('fetchSubtitleResource', () => {
  it('refuses a disallowed url without issuing a request', async () => {
    const { mock, fetchImpl } = createFetcher(() => fakeResponse())

    const result = await fetchSubtitleResource('https://evil.example/master.m3u8', { fetchImpl })

    expect(result.ok).toBe(false)
    expect(mock).not.toHaveBeenCalled()
  })

  it('returns the decoded body and content type', async () => {
    const body = 'WEBVTT\n\n00:00.000 --> 00:01.000\nHi'
    const { fetchImpl } = createFetcher(() => fakeResponse({ text: body, contentType: 'text/vtt' }))

    expect(await fetchSubtitleResource(allowedUrl, { fetchImpl })).toEqual({ ok: true, text: body, contentType: 'text/vtt' })
  })

  it('joins a chunked body across reads', async () => {
    const encoder = new TextEncoder()
    const { fetchImpl } = createFetcher(() => fakeResponse({
      chunks: [encoder.encode('WEBVTT\n\n00:00.000 --> 00:01.000\n'), encoder.encode('Hi')],
    }))

    expect(await fetchSubtitleResource(allowedUrl, { fetchImpl }))
      .toEqual({ ok: true, text: 'WEBVTT\n\n00:00.000 --> 00:01.000\nHi', contentType: '' })
  })

  it('sends no credentials to Apple', async () => {
    const { mock, fetchImpl } = createFetcher(() => fakeResponse({ text: 'WEBVTT' }))

    await fetchSubtitleResource(allowedUrl, { fetchImpl })

    expect(mock.mock.calls[0]![1]).toMatchObject({ credentials: 'omit' })
  })

  it('rejects a redirect that leaves the Apple host', async () => {
    const { fetchImpl } = createFetcher(() => fakeResponse({ url: 'https://evil.example/en.vtt', text: 'secret' }))

    const result = await fetchSubtitleResource(allowedUrl, { fetchImpl })

    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error).toContain('重定向')
  })

  it('follows a redirect that stays on the Apple host', async () => {
    const { fetchImpl } = createFetcher(() => fakeResponse({
      url: 'https://events-delivery.apple.com/redirected/en.vtt',
      text: 'WEBVTT',
    }))

    expect((await fetchSubtitleResource(allowedUrl, { fetchImpl })).ok).toBe(true)
  })

  it('surfaces an HTTP failure status', async () => {
    const { fetchImpl } = createFetcher(() => fakeResponse({ status: 404 }))

    const result = await fetchSubtitleResource(allowedUrl, { fetchImpl })

    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error).toContain('404')
  })

  it('rejects a declared length over the cap', async () => {
    const { fetchImpl } = createFetcher(() => fakeResponse({ contentLength: 4096, text: 'x'.repeat(4096) }))

    const result = await fetchSubtitleResource(allowedUrl, { fetchImpl, maxBytes: 2048 })

    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error).toContain('过大')
  })

  it('cuts off a streamed body that lies about its declared length', async () => {
    const { fetchImpl } = createFetcher(() => fakeResponse({
      contentLength: 8,
      chunks: [new Uint8Array(2049).fill(97)],
    }))

    const result = await fetchSubtitleResource(allowedUrl, { fetchImpl, maxBytes: 2048 })

    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error).toContain('过大')
  })

  it('bounds the fallback text path too', async () => {
    const { fetchImpl } = createFetcher(() => fakeResponse({ text: 'a'.repeat(2049) }))

    expect((await fetchSubtitleResource(allowedUrl, { fetchImpl, maxBytes: 2048 })).ok).toBe(false)
  })

  it('counts UTF-8 bytes, not string units, on the fallback text path', async () => {
    // 1000 CJK characters are 1000 string units but 3000 UTF-8 bytes.
    const { fetchImpl } = createFetcher(() => fakeResponse({ text: '好'.repeat(1000) }))

    expect((await fetchSubtitleResource(allowedUrl, { fetchImpl, maxBytes: 2048 })).ok).toBe(false)
  })

  it('accepts a multi-byte fallback body below the byte cap', async () => {
    // 600 CJK characters are 1800 UTF-8 bytes, under the 2048-byte cap.
    const body = '好'.repeat(600)
    const { fetchImpl } = createFetcher(() => fakeResponse({ text: body }))

    const result = await fetchSubtitleResource(allowedUrl, { fetchImpl, maxBytes: 2048 })

    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.text).toBe(body)
  })

  it('accepts a body exactly at the cap', async () => {
    const { fetchImpl } = createFetcher(() => fakeResponse({
      contentLength: 2048,
      chunks: [new Uint8Array(2048).fill(97)],
    }))

    const result = await fetchSubtitleResource(allowedUrl, { fetchImpl, maxBytes: 2048 })

    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.text).toHaveLength(2048)
  })
})
