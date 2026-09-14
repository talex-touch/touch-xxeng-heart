// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createYoutubeSubtitleProvider, parseYoutubeJson3 } from './youtube'
import { youtubeCaptionBridgeChannel, youtubeCaptionBridgeVersion } from './youtubeBridge'
import type { YoutubeCaptionBridgeRequest, YoutubeCaptionTrackDescriptor } from './youtubeBridge'

const mocks = vi.hoisted(() => ({ sendRuntimeMessage: vi.fn() }))

vi.mock('../runtimeMessaging', () => ({ sendRuntimeMessage: mocks.sendRuntimeMessage }))

const media = {} as HTMLVideoElement
const videoId = 'dQw4w9WgXcQ'
const videoUrl = new URL(`https://www.youtube.com/watch?v=${videoId}`)
const nativeTrack: YoutubeCaptionTrackDescriptor = {
  baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`,
  languageCode: 'en',
  label: 'English',
  kind: 'native',
}
const autoTrack: YoutubeCaptionTrackDescriptor = {
  baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=zh-Hans`,
  languageCode: 'zh-Hans',
  label: '中文（自动）',
  kind: 'auto',
}

function createProvider(mediaElement: HTMLVideoElement | undefined) {
  return createYoutubeSubtitleProvider({ getMedia: () => mediaElement })
}

/** Captures the page-facing bridge requests; an optional responder plays the MAIN-world side. */
function installBridge(responder?: (request: YoutubeCaptionBridgeRequest) => void) {
  const posts: YoutubeCaptionBridgeRequest[] = []
  vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
    posts.push(message as YoutubeCaptionBridgeRequest)
    responder?.(message as YoutubeCaptionBridgeRequest)
  })
  return posts
}

function reply(
  request: YoutubeCaptionBridgeRequest,
  overrides: Record<string, unknown> = {},
  options: { origin?: string, source?: Window | null } = {},
) {
  window.dispatchEvent(new MessageEvent('message', {
    data: {
      channel: youtubeCaptionBridgeChannel,
      version: youtubeCaptionBridgeVersion,
      type: 'tracklist',
      requestId: request.requestId,
      videoId,
      tracks: [nativeTrack],
      ...overrides,
    },
    origin: options.origin ?? videoUrl.origin,
    source: 'source' in options ? options.source : window,
  }))
}

/** Drives a reply past every window gate and proves the provider stays undecided until timeout. */
async function expectIgnored(dispatch: (request: YoutubeCaptionBridgeRequest) => void) {
  vi.useFakeTimers()
  try {
    const posts = installBridge()
    let settled: unknown = 'pending'
    const pending = createProvider(media)
      .resolve(videoUrl)
      .then((value) => {
        settled = value
      })
    expect(posts).toHaveLength(1)

    dispatch(posts[0]!)

    await vi.advanceTimersByTimeAsync(1499)
    expect(settled).toBe('pending')

    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(settled).toBeUndefined()
  }
  finally {
    vi.useRealTimers()
  }
}

beforeEach(() => {
  mocks.sendRuntimeMessage.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('parseYoutubeJson3', () => {
  it('keeps a cue that starts at zero', () => {
    const cues = parseYoutubeJson3(JSON.stringify({
      events: [{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'hello' }] }],
    }))

    expect(cues).toEqual([{ start: 0, end: 2, text: 'hello' }])
  })

  it('derives a missing duration from the next cue and keeps the last cue displayable', () => {
    const cues = parseYoutubeJson3(JSON.stringify({
      events: [
        { tStartMs: 0, segs: [{ utf8: 'first' }] },
        { tStartMs: 1000, segs: [{ utf8: 'second' }] },
      ],
    }))

    expect(cues).toEqual([
      { start: 0, end: 1, text: 'first' },
      { start: 1, end: 3, text: 'second' },
    ])
  })

  it('treats a zero duration as missing and derives it from the next cue', () => {
    const cues = parseYoutubeJson3(JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 0, segs: [{ utf8: 'first' }] },
        { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'second' }] },
      ],
    }))

    expect(cues[0]).toEqual({ start: 0, end: 2, text: 'first' })
  })

  it('strips zero-width and BOM noise and collapses whitespace', () => {
    const cues = parseYoutubeJson3(JSON.stringify({
      events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'a\u200B' }, { utf8: '\uFEFFc\nd' }, { utf8: '\u200D' }] }],
    }))

    expect(cues[0]?.text).toBe('ac d')
  })

  it('caps a single cue text so one hostile event cannot bloat the reader', () => {
    const cues = parseYoutubeJson3(JSON.stringify({
      events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'x'.repeat(1200) }] }],
    }))

    expect(cues[0]?.text).toBe('x'.repeat(1000))
  })

  it('caps the number of cues taken from a hostile payload', () => {
    const events = Array.from({ length: 20_001 }, (_value, index) => ({
      tStartMs: index * 1000,
      dDurationMs: 500,
      segs: [{ utf8: `c${index}` }],
    }))

    const cues = parseYoutubeJson3(JSON.stringify({ events }))

    expect(cues).toHaveLength(20_000)
    expect(cues.at(-1)?.text).toBe('c19999')
    expect(cues.some(cue => cue.text === 'c20000')).toBe(false)
  })

  it.each([
    ['invalid JSON', 'not json'],
    ['a missing events array', '{"foo":[]}'],
    ['a non-array events field', '{"events":"nope"}'],
  ])('returns nothing for %s', (_name, text) => {
    expect(parseYoutubeJson3(text)).toEqual([])
  })

  it.each([
    ['a negative start', { tStartMs: -1, dDurationMs: 1000, segs: [{ utf8: 'a' }] }],
    ['a non-numeric start', { tStartMs: 'soon', dDurationMs: 1000, segs: [{ utf8: 'a' }] }],
    ['no segments', { tStartMs: 0, dDurationMs: 1000 }],
    ['empty segment text', { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '   ' }] }],
  ])('drops an event with %s', (_name, event) => {
    expect(parseYoutubeJson3(JSON.stringify({ events: [event] }))).toEqual([])
  })
})

describe('createYoutubeSubtitleProvider bridge requests', () => {
  it('posts a versioned request and resolves the track list only after a valid reply', async () => {
    const posts = installBridge()
    const pending = createProvider(media).resolve(videoUrl)

    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({
      channel: youtubeCaptionBridgeChannel,
      version: youtubeCaptionBridgeVersion,
      type: 'request-tracklist',
    })
    expect(posts[0]!.requestId).toMatch(/^[\w-]{8,80}$/)

    reply(posts[0]!, { tracks: [nativeTrack, autoTrack] })
    const source = await pending

    expect(source?.mediaId).toBe(`youtube:${videoId}`)
    expect(source?.media).toBe(media)
  })

  it('exposes the bridged native and auto tracks with their labels', async () => {
    installBridge(request => reply(request, { tracks: [nativeTrack, autoTrack] }))

    const source = await createProvider(media).resolve(videoUrl)
    const handles = await source!.listTracks()

    expect(handles.map(handle => ({ language: handle.language, label: handle.label, kind: handle.kind }))).toEqual([
      { language: 'en', label: 'English', kind: 'native' },
      { language: 'zh-Hans', label: '中文（自动）', kind: 'auto' },
    ])
  })

  it('fetches a caption body through the worker and parses the cues the bridge pointed at', async () => {
    installBridge(request => reply(request, { tracks: [nativeTrack] }))
    mocks.sendRuntimeMessage.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: 'hello' }] }] }),
    })

    const source = await createProvider(media).resolve(videoUrl)
    const [handle] = await source!.listTracks()

    expect(await handle!.load()).toEqual([{ start: 0, end: 1.5, text: 'hello' }])
    expect(mocks.sendRuntimeMessage).toHaveBeenCalledWith('lexi-fetch-youtube-caption-track', { url: nativeTrack.baseUrl })
  })

  it('declines a caption body that the worker rejects', async () => {
    installBridge(request => reply(request, { tracks: [nativeTrack] }))
    mocks.sendRuntimeMessage.mockResolvedValue({ ok: false, error: 'YouTube 字幕获取失败（HTTP 500）' })

    const source = await createProvider(media).resolve(videoUrl)
    const [handle] = await source!.listTracks()

    expect(await handle!.load()).toEqual([])
  })

  it('yields no tracks or cues once the caller aborts', async () => {
    installBridge(request => reply(request, { tracks: [nativeTrack] }))
    const source = await createProvider(media).resolve(videoUrl)

    const controller = new AbortController()
    controller.abort()

    expect(await source!.listTracks(controller.signal)).toEqual([])
    const [handle] = await source!.listTracks()
    expect(await handle!.load({ signal: controller.signal })).toEqual([])
  })
})

describe('createYoutubeSubtitleProvider window gates', () => {
  it('ignores a reply sent to or from a foreign origin', async () => {
    await expectIgnored(request => reply(request, {}, { origin: 'https://evil.example' }))
  })

  it('ignores a reply whose source is not this window', async () => {
    await expectIgnored(request => reply(request, {}, { source: null }))
  })

  it('ignores a reply carrying a different request id', async () => {
    await expectIgnored(request => reply(request, { requestId: 'lexi-someone-else' }))
  })

  it('ignores a reply whose channel or version does not match', async () => {
    await expectIgnored(request => reply(request, { channel: 'other-channel', version: 99 }))
  })

  it('ignores a reply that carries no usable tracks', async () => {
    await expectIgnored(request => reply(request, { tracks: [] }))
  })

  it('ignores a reply whose track address is not an allowed YouTube caption URL', async () => {
    await expectIgnored(request => reply(request, { tracks: [{ ...nativeTrack, baseUrl: 'https://evil.example/api/timedtext?v=dQw4w9WgXcQ' }] }))
  })

  it('times out when the page never answers', async () => {
    await expectIgnored(() => undefined)
  })

  it('returns nothing without a player and posts no request', async () => {
    const posts = installBridge()

    expect(await createProvider(undefined).resolve(videoUrl)).toBeUndefined()
    expect(posts).toHaveLength(0)
  })

  it('posts nothing for a caller that is already aborted', async () => {
    const posts = installBridge()
    const controller = new AbortController()
    controller.abort()

    expect(await createProvider(media).resolve(videoUrl, controller.signal)).toBeUndefined()
    expect(posts).toHaveLength(0)
  })

  it('stops waiting as soon as the caller aborts', async () => {
    vi.useFakeTimers()
    try {
      installBridge()
      const controller = new AbortController()
      let settled = false
      const pending = createProvider(media).resolve(videoUrl, controller.signal)
      void pending.then(() => {
        settled = true
      })

      controller.abort()
      await vi.advanceTimersByTimeAsync(0)

      expect(settled).toBe(true)
      expect(await pending).toBeUndefined()
    }
    finally {
      vi.useRealTimers()
    }
  })
})

describe('createYoutubeSubtitleProvider caching', () => {
  it('serves a resolved page from cache and only re-asks after the hit window', async () => {
    vi.useFakeTimers()
    try {
      const posts = installBridge(request => reply(request))
      const provider = createProvider(media)

      await provider.resolve(videoUrl)
      await provider.resolve(videoUrl)
      expect(posts).toHaveLength(1)

      vi.setSystemTime(Date.now() + 4 * 60 * 1000)
      await provider.resolve(videoUrl)
      expect(posts).toHaveLength(1)

      vi.setSystemTime(Date.now() + 2 * 60 * 1000)
      await provider.resolve(videoUrl)
      expect(posts).toHaveLength(2)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('re-asks a declined page only after the shorter negative window', async () => {
    vi.useFakeTimers()
    try {
      const posts = installBridge(request => reply(request, { tracks: [] }))
      const provider = createProvider(media)

      const first = provider.resolve(videoUrl)
      await vi.advanceTimersByTimeAsync(1500)
      expect(await first).toBeUndefined()
      expect(posts).toHaveLength(1)

      expect(await provider.resolve(videoUrl)).toBeUndefined()
      expect(posts).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(5000)
      const third = provider.resolve(videoUrl)
      expect(posts).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(1500)
      expect(await third).toBeUndefined()
    }
    finally {
      vi.useRealTimers()
    }
  })
})
