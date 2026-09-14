// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { maxYoutubeCaptionTracks, youtubeCaptionBridgeChannel, youtubeCaptionBridgeVersion } from '~/logic/subtitles/youtubeBridge'
import type { YoutubeCaptionBridgeResponse, YoutubeCaptionTrackDescriptor } from '~/logic/subtitles/youtubeBridge'

const videoId = 'dQw4w9WgXcQ'
const captionUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`

interface PostedMessage {
  message: YoutubeCaptionBridgeResponse
  targetOrigin: string
}

let posts: PostedMessage[]

beforeAll(async () => {
  // A static import cannot work here: this test exercises the module-loading boundary the
  // MAIN-world entry depends on, so the import is deliberately sequenced inside the test
  // setup (after jsdom is up) instead of being hoisted to the top of the file.
  await import('./youtubeMain')
})

beforeEach(() => {
  posts = []
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, 'ytInitialPlayerResponse')
  vi.spyOn(window, 'postMessage').mockImplementation((message: unknown, options?: string | WindowPostMessageOptions) => {
    const targetOrigin = typeof options === 'string' ? options : options?.targetOrigin ?? ''
    posts.push({ message: message as YoutubeCaptionBridgeResponse, targetOrigin })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'ytInitialPlayerResponse')
})

function request(
  overrides: Record<string, unknown> = {},
  options: { origin?: string, source?: Window | null } = {},
) {
  window.dispatchEvent(new MessageEvent('message', {
    data: {
      channel: youtubeCaptionBridgeChannel,
      version: youtubeCaptionBridgeVersion,
      type: 'request-tracklist',
      requestId: 'lexi-abcdefgh',
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
const nativeDescriptor: YoutubeCaptionTrackDescriptor = { baseUrl: captionUrl, languageCode: 'en', label: 'English', kind: 'native' }

describe('youtubeMain bridge replies', () => {
  it('answers with a tracklist read from ytInitialPlayerResponse', () => {
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([nativeTrack], videoId))

    request()

    expect(posts).toHaveLength(1)
    expect(posts[0]!.message).toEqual({
      channel: youtubeCaptionBridgeChannel,
      version: youtubeCaptionBridgeVersion,
      type: 'tracklist',
      requestId: 'lexi-abcdefgh',
      videoId,
      tracks: [nativeDescriptor],
    })
    expect(posts[0]!.targetOrigin).toBe(location.origin)
  })

  it('falls back to movie_player.getPlayerResponse when the page global is absent', () => {
    mountPlayer({ getPlayerResponse: () => playerResponse([nativeTrack], videoId) })

    request()

    expect(posts[0]?.message.tracks).toEqual([nativeDescriptor])
    expect(posts[0]?.message.videoId).toBe(videoId)
  })

  it('falls back to movie_player.getOption when no player response is available', () => {
    mountPlayer({ getOption: () => ({ captionTracks: [nativeTrack] }) })

    request()

    expect(posts[0]?.message).toMatchObject({ videoId, tracks: [nativeDescriptor] })
  })

  it('prefers the player response video id over the page url', () => {
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([nativeTrack], 'abcdefghijk'))

    request()

    expect(posts[0]?.message.videoId).toBe('abcdefghijk')
  })

  it('reads the video id from the page url when the player omits videoDetails', () => {
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([nativeTrack]))

    request()

    expect(posts[0]?.message.videoId).toBe(videoId)
  })
})

describe('youtubeMain request gates', () => {
  it('stays silent for every request that fails a window gate', () => {
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

  it('does not answer when no page source exposes tracks', () => {
    request()

    expect(posts).toHaveLength(0)
  })

  it('does not answer when every exposed track is unusable', () => {
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([
      { baseUrl: 'https://evil.example/api/timedtext?v=dQw4w9WgXcQ', languageCode: 'en', name: { simpleText: 'Evil' } },
    ], videoId))

    request()

    expect(posts).toHaveLength(0)
  })
})

describe('youtubeMain track normalization', () => {
  it('caps the track list so a hostile page cannot flood the bridge consumer', () => {
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

  it('drops tracks whose address leaves the YouTube caption endpoint', () => {
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

  it('drops tracks with an unusable language and falls back to the language as a label', () => {
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

  it('reads a label from runs when the page provides no simpleText', () => {
    Reflect.set(window, 'ytInitialPlayerResponse', playerResponse([
      { baseUrl: captionUrl, languageCode: 'en', name: { runs: [{ text: 'Auto ' }, { text: 'generated' }] }, kind: 'asr' },
    ], videoId))

    request()

    expect(posts[0]!.message.tracks[0]).toMatchObject({ label: 'Auto generated', kind: 'auto' })
  })

  it('marks automatic tracks by kind or by vssId prefix', () => {
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
