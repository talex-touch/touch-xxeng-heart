// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  maxYoutubeCaptionTracks,
  readYoutubeCaptionBridgeResponse,
  youtubeCaptionBridgeChannel,
  youtubeCaptionBridgeVersion,
} from '~/logic/subtitles/youtubeBridge'
import type { YoutubeCaptionBridgeResponse, YoutubeCaptionTrackDescriptor } from '~/logic/subtitles/youtubeBridge'

const videoId = 'dQw4w9WgXcQ'
const otherVideoId = 'abcdefghijk'
const requestId = 'lexi-abcdefgh'

/**
 * The address the tracklist itself exposes. YouTube answers exactly this URL with HTTP 200 and a
 * zero-length body for every format: the endpoint checks the attestation token, and the tracklist
 * carries none.
 */
const captionUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`

/** The token, signature and client identity the endpoint checks — none of them name a track. */
const attestationToken = 'Cg0KC2RuRzZPc0lYdE1KZ1F4WlZ0Y0hKbE1uYjJWd2VIUmxZMmh1YVdOaGJHRjBhVzl1Y0dGdVpXeHZjM1J4Wm5SdWIyNWxablZ1WTNScGIyNXpkR0Zz'
const signedParams = `pot=${attestationToken}&sig=7E9A1C0B4D6F8A2E&expire=1760000000&c=WEB&cver=2.20240814.01.00&xorb=2&xobt=3`

/** A caption request the player itself made for this page, while zh-CN auto captions were on. */
const signedRequestUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=zh-CN&kind=asr&${signedParams}&fmt=json3`

interface PostedMessage {
  message: YoutubeCaptionBridgeResponse
  targetOrigin: string
}

let posts: PostedMessage[]
/** Resource-timing entries the page already holds; the entry scans them when it loads. */
let pageRequests: string[]
/** The entry's live resource observer, which the page feeds as the player makes requests. */
let captionObserver: ((list: { getEntries: () => PerformanceEntry[] }) => void) | undefined
/** The entry's message listener, dropped before the next install so module instances never stack. */
let pageListener: EventListener | undefined

const originalAddEventListener = window.addEventListener.bind(window)
const originalRemoveEventListener = window.removeEventListener.bind(window)

beforeAll(() => {
  vi.stubGlobal('PerformanceObserver', class {
    constructor(callback: (list: { getEntries: () => PerformanceEntry[] }) => void) {
      captionObserver = callback
    }

    // The entry only needs the observer to exist; entries are delivered by the tests below.
    observe() {}
  })
})

beforeEach(() => {
  posts = []
  pageRequests = []
  captionObserver = undefined
  if (pageListener) {
    originalRemoveEventListener('message', pageListener)
    pageListener = undefined
  }
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, 'ytInitialPlayerResponse')
  // Installing the entry re-evaluates it, so the request it remembers starts out authorized by nothing.
  vi.resetModules()
  vi.spyOn(performance, 'getEntriesByType').mockImplementation(
    (type: string) => (type === 'resource' ? pageRequests.map(name => ({ name }) as unknown as PerformanceEntry) : []),
  )
  vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type === 'message')
      pageListener = listener as EventListener
    originalAddEventListener(type, listener, options)
  }) as typeof window.addEventListener)
  vi.spyOn(window, 'postMessage').mockImplementation((message: unknown, options?: string | WindowPostMessageOptions) => {
    const targetOrigin = typeof options === 'string' ? options : options?.targetOrigin ?? ''
    posts.push({ message: message as YoutubeCaptionBridgeResponse, targetOrigin })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'ytInitialPlayerResponse')
})

afterAll(() => {
  vi.unstubAllGlobals()
})

/**
 * Loads the MAIN-world entry the way a page load does: after the resource timeline is populated.
 * A static import cannot work here, because the import must happen after the page globals above
 * are installed and the module remembers the first caption request it sees.
 */
async function installEntry(...recordedRequests: string[]) {
  pageRequests.push(...recordedRequests)
  await import('./youtubeMain')
}

function request(
  overrides: Record<string, unknown> = {},
  options: { origin?: string, source?: Window | null } = {},
) {
  window.dispatchEvent(new MessageEvent('message', {
    data: {
      channel: youtubeCaptionBridgeChannel,
      version: youtubeCaptionBridgeVersion,
      type: 'request-tracklist',
      requestId,
      ...overrides,
    },
    origin: options.origin ?? location.origin,
    source: 'source' in options ? options.source : window,
  }))
}

function playerResponse(captionTracks: unknown[], id?: string) {
  return {
    ...(id ? { videoDetails: { videoId: id } } : {}),
    captions: { playerCaptionsTracklistRenderer: { captionTracks } },
  }
}

function mountPlayer(overrides: Record<string, unknown>) {
  const player = document.createElement('div')
  player.id = 'movie_player'
  Object.assign(player, overrides)
  document.body.append(player)
  return player
}

const nativeTrack = { baseUrl: captionUrl, languageCode: 'en', name: { simpleText: 'English' }, kind: 'native' }
const nativeDescriptor: YoutubeCaptionTrackDescriptor = {
  baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&${signedParams}`,
  languageCode: 'en',
  label: 'English',
  kind: 'native',
}

describe('youtubeMain bridge replies', () => {
  it('answers with a tracklist read from ytInitialPlayerResponse', async () => {
    await installEntry(signedRequestUrl)
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([nativeTrack], videoId))

    request()

    expect(posts).toHaveLength(1)
    expect(posts[0]!.message).toEqual({
      channel: youtubeCaptionBridgeChannel,
      version: youtubeCaptionBridgeVersion,
      type: 'tracklist',
      requestId,
      videoId,
      tracks: [nativeDescriptor],
    })
    expect(posts[0]!.targetOrigin).toBe(location.origin)
  })

  it('falls back to movie_player.getPlayerResponse when the page global is absent', async () => {
    await installEntry(signedRequestUrl)
    mountPlayer({ getPlayerResponse: () => playerResponse([nativeTrack], videoId) })

    request()

    expect(posts[0]?.message.tracks).toEqual([nativeDescriptor])
    expect(posts[0]?.message.videoId).toBe(videoId)
  })

  it('falls back to movie_player.getOption when no player response is available', async () => {
    await installEntry(signedRequestUrl)
    mountPlayer({ getOption: () => ({ captionTracks: [nativeTrack] }) })

    request()

    expect(posts[0]?.message).toMatchObject({ videoId, tracks: [nativeDescriptor] })
  })

  it('prefers the player response video id over the page url', async () => {
    await installEntry(signedRequestUrl)
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([nativeTrack], otherVideoId))

    request()

    expect(posts[0]?.message.videoId).toBe(otherVideoId)
  })

  it('reads the video id from the page url when the player omits videoDetails', async () => {
    await installEntry(signedRequestUrl)
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([nativeTrack]))

    request()

    expect(posts[0]?.message.videoId).toBe(videoId)
  })
})

describe('youtubeMain request gates', () => {
  it('stays silent for every request that fails a window gate', async () => {
    await installEntry(signedRequestUrl)
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([nativeTrack], videoId))

    request({}, { origin: 'https://evil.example' })
    request({}, { source: null })
    request({ channel: 'other-channel' })
    request({ version: 99 })
    request({ type: 'tracklist' })
    request({ requestId: 'short' })
    request({ requestId: 42 })

    window.dispatchEvent(new MessageEvent('message', {
      data: 'not a record',
      origin: location.origin,
      source: window,
    }))

    expect(posts).toHaveLength(0)
  })

  it('does not answer when no page source exposes tracks', async () => {
    await installEntry(signedRequestUrl)

    request()

    expect(posts).toHaveLength(0)
  })

  it('does not answer when every exposed track is unusable', async () => {
    await installEntry(signedRequestUrl)
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([
      { baseUrl: 'https://evil.example/api/timedtext?v=dQw4w9WgXcQ', languageCode: 'en', name: { simpleText: 'Evil' } },
    ], videoId))

    request()

    expect(posts).toHaveLength(0)
  })
})

describe('youtubeMain track normalization', () => {
  it('caps the track list so a hostile page cannot flood the bridge consumer', async () => {
    await installEntry(signedRequestUrl)
    const tracks = Array.from({ length: maxYoutubeCaptionTracks + 1 }, (_value, index) => ({
      baseUrl: captionUrl,
      languageCode: `en-${index}`,
      name: { simpleText: `Track ${index}` },
      kind: 'native',
    }))
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse(tracks, videoId))

    request()

    const returned = posts[0]!.message.tracks
    expect(returned).toHaveLength(maxYoutubeCaptionTracks)
    expect(returned.at(-1)?.label).toBe(`Track ${maxYoutubeCaptionTracks - 1}`)
  })

  it('drops tracks whose address leaves the YouTube caption endpoint', async () => {
    await installEntry(signedRequestUrl)
    const tracks = [
      { baseUrl: 'https://evil.example/api/timedtext?v=dQw4w9WgXcQ', languageCode: 'en', name: { simpleText: 'Evil' } },
      { baseUrl: `http://www.youtube.com/api/timedtext?v=${videoId}`, languageCode: 'en', name: { simpleText: 'Http' } },
      { baseUrl: `https://www.youtube.com/api/other?v=${videoId}`, languageCode: 'en', name: { simpleText: 'Wrong path' } },
      nativeTrack,
    ]
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse(tracks, videoId))

    request()

    expect(posts[0]!.message.tracks).toEqual([nativeDescriptor])
  })

  it('drops tracks with an unusable language and falls back to the language as a label', async () => {
    await installEntry(signedRequestUrl)
    const tracks = [
      { baseUrl: captionUrl, languageCode: 'x', name: { simpleText: 'Too short' } },
      { baseUrl: captionUrl, languageCode: 'ja' },
      nativeTrack,
    ]
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse(tracks, videoId))

    request()

    expect(posts[0]!.message.tracks.map(track => ({ languageCode: track.languageCode, label: track.label }))).toEqual([
      { languageCode: 'ja', label: 'ja' },
      { languageCode: 'en', label: 'English' },
    ])
  })

  it('reads a label from runs when the page provides no simpleText', async () => {
    await installEntry(signedRequestUrl)
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([
      { baseUrl: captionUrl, languageCode: 'en', name: { runs: [{ text: 'Auto ' }, { text: 'generated' }] }, kind: 'asr' },
    ], videoId))

    request()

    expect(posts[0]!.message.tracks[0]).toMatchObject({ label: 'Auto generated', kind: 'auto' })
  })

  it('marks automatic tracks by kind or by vssId prefix', async () => {
    await installEntry(signedRequestUrl)
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([
      { baseUrl: captionUrl, languageCode: 'en', name: { simpleText: 'Asr kind' }, kind: 'asr' },
      { baseUrl: captionUrl, languageCode: 'fr', name: { simpleText: 'Asr prefix' }, vssId: 'a.fr' },
      { baseUrl: captionUrl, languageCode: 'de', name: { simpleText: 'Legacy prefix' }, vssId: '.a.de' },
      nativeTrack,
    ], videoId))

    request()

    expect(posts[0]!.message.tracks.map(track => track.kind)).toEqual(['auto', 'auto', 'auto', 'native'])
  })
})

describe('youtubeMain caption authorization', () => {
  it('stays silent while the page has recorded no authorized caption request', async () => {
    await installEntry()
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([nativeTrack], videoId))

    request()

    // The tracklist address is allowlisted but returns nothing, so handing it out is worse than silence.
    expect(posts).toHaveLength(0)
  })

  it('ignores a recorded request that carries no attestation token', async () => {
    await installEntry(captionUrl)
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([nativeTrack], videoId))

    request()

    expect(posts).toHaveLength(0)
  })

  it('ignores a resource entry that is not a YouTube caption request', async () => {
    await installEntry(
      signedRequestUrl,
      `https://evil.example/api/timedtext?v=${videoId}&lang=en&${signedParams}`,
      `https://www.youtube.com/api/stats/playback?v=${videoId}&lang=en&${signedParams}`,
    )
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([nativeTrack], videoId))

    request()

    expect(posts[0]!.message.tracks[0]!.baseUrl).toBe(nativeDescriptor.baseUrl)
  })

  it('ignores a recorded request for another video', async () => {
    await installEntry(`https://www.youtube.com/api/timedtext?v=${otherVideoId}&lang=en&${signedParams}`)
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([
      { baseUrl: `https://www.youtube.com/api/timedtext?v=${otherVideoId}&lang=en`, languageCode: 'en', name: { simpleText: 'Stale' }, kind: 'native' },
    ], otherVideoId))

    request()

    expect(posts).toHaveLength(0)
  })

  it('drops a listed track whose address names another video than the envelope', async () => {
    await installEntry(signedRequestUrl)
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([
      { baseUrl: `https://www.youtube.com/api/timedtext?v=${otherVideoId}&lang=en`, languageCode: 'en', name: { simpleText: 'Stale' }, kind: 'native' },
    ], videoId))

    request()

    expect(posts).toHaveLength(0)
  })

  it('re-points the recorded request at the listed track, keeping its signature', async () => {
    await installEntry(signedRequestUrl)
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([nativeTrack], videoId))

    request()

    // Everything the endpoint checks survives; only the selectors naming a track are replaced.
    expect(Object.fromEntries(new URL(posts[0]!.message.tracks[0]!.baseUrl).searchParams)).toEqual({
      v: videoId,
      lang: 'en',
      pot: attestationToken,
      sig: '7E9A1C0B4D6F8A2E',
      expire: '1760000000',
      c: 'WEB',
      cver: '2.20240814.01.00',
      xorb: '2',
      xobt: '3',
    })
  })

  it('takes the caption kind from the listed track rather than the envelope', async () => {
    await installEntry(signedRequestUrl)
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([
      { baseUrl: `${captionUrl}&kind=asr`, languageCode: 'en', name: { simpleText: 'Auto' }, kind: 'asr' },
      nativeTrack,
    ], videoId))

    request()

    // The envelope was recorded for an automatic track; a manual track must not inherit its kind.
    expect(posts[0]!.message.tracks.map(track => new URL(track.baseUrl).searchParams.get('kind'))).toEqual(['asr', null])
  })

  it('appends the listed track translation and drops the response format', async () => {
    await installEntry(signedRequestUrl)
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([
      { baseUrl: `${captionUrl}&tlang=fr`, languageCode: 'en', name: { simpleText: 'French' }, kind: 'asr' },
    ], videoId))

    request()

    const emitted = new URL(posts[0]!.message.tracks[0]!.baseUrl).searchParams
    expect(emitted.get('tlang')).toBe('fr')
    expect(emitted.has('fmt')).toBe(false)
  })

  it('records the caption request the player makes after the entry has loaded', async () => {
    await installEntry()
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([nativeTrack], videoId))

    request()
    expect(posts).toHaveLength(0)

    captionObserver?.({ getEntries: () => [{ name: signedRequestUrl } as PerformanceEntry] })

    request()
    expect(posts).toHaveLength(1)
    expect(posts[0]!.message.tracks[0]!.baseUrl).toBe(nativeDescriptor.baseUrl)
  })

  it('emits only a tracklist the isolated world accepts', async () => {
    await installEntry(signedRequestUrl)
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([
      { baseUrl: `${captionUrl}&tlang=fr`, languageCode: 'en', name: { simpleText: 'French' }, kind: 'asr' },
    ], videoId))

    request()

    const accepted = readYoutubeCaptionBridgeResponse(posts[0]!.message, requestId, videoId)
    expect(accepted?.tracks[0]?.baseUrl).toBe(posts[0]!.message.tracks[0]!.baseUrl)
  })
})
