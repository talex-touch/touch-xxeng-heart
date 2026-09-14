import { describe, expect, it } from 'vitest'
import {
  isAllowedYoutubeCaptionUrl,
  isYoutubeVideoPage,
  readYoutubeCaptionBridgeResponse,
  youtubeCaptionBridgeChannel,
  youtubeCaptionBridgeVersion,
  youtubeVideoIdFromUrl,
} from './youtubeBridge'
import type { YoutubeCaptionTrackDescriptor } from './youtubeBridge'

const videoId = 'dQw4w9WgXcQ'
const captionUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`

function track(overrides: Partial<YoutubeCaptionTrackDescriptor> = {}): YoutubeCaptionTrackDescriptor {
  return { baseUrl: captionUrl, languageCode: 'en', label: 'English', kind: 'native', ...overrides }
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    channel: youtubeCaptionBridgeChannel,
    version: youtubeCaptionBridgeVersion,
    type: 'tracklist',
    requestId: 'lexi-request',
    videoId,
    tracks: [track()],
    ...overrides,
  }
}

describe('isYoutubeVideoPage', () => {
  it.each([
    ['the www watch page', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['the bare host watch page', 'https://youtube.com/watch?v=dQw4w9WgXcQ'],
    ['a regional subdomain', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['a watch page with extra params', `https://www.youtube.com/watch?app=desktop&v=${videoId}&t=30`],
    ['a shorts page', `https://www.youtube.com/shorts/${videoId}`],
    ['a shorts page with a trailing slash', `https://www.youtube.com/shorts/${videoId}/`],
    ['a live page', `https://www.youtube.com/live/${videoId}`],
    ['a URL instance', new URL(`https://www.youtube.com/watch?v=${videoId}`)],
  ])('matches %s', (_name, url) => {
    expect(isYoutubeVideoPage(url)).toBe(true)
  })

  it.each([
    ['plain http', 'http://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['a lookalike suffix host', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'],
    ['a host that merely contains the name', 'https://notyoutube.com/watch?v=dQw4w9WgXcQ'],
    ['a userinfo impostor', 'https://youtube.com@evil.example/watch?v=dQw4w9WgXcQ'],
    ['an unrelated host', 'https://evil.example/watch?v=dQw4w9WgXcQ'],
    ['the short link host', 'https://youtu.be/dQw4w9WgXcQ'],
    ['a watch page without an id', 'https://www.youtube.com/watch'],
    ['an id below the length floor', 'https://www.youtube.com/watch?v=short'],
    ['an id above the length ceiling', 'https://www.youtube.com/watch?v=123456789012345678901'],
    ['a non-video path', 'https://www.youtube.com/feed/subscriptions'],
    ['malformed input', 'not a url'],
  ])('rejects %s', (_name, url) => {
    expect(isYoutubeVideoPage(url)).toBe(false)
  })
})

describe('youtubeVideoIdFromUrl', () => {
  it.each([
    ['the watch query', `https://www.youtube.com/watch?v=${videoId}`, videoId],
    ['a shorts segment', `https://www.youtube.com/shorts/${videoId}`, videoId],
    ['a live segment with a trailing slash', `https://www.youtube.com/live/${videoId}/`, videoId],
  ])('reads the id from %s', (_name, url, expected) => {
    expect(youtubeVideoIdFromUrl(url)).toBe(expected)
  })

  it('returns nothing for a page it does not claim', () => {
    expect(youtubeVideoIdFromUrl('https://www.youtube.com/feed/subscriptions')).toBeUndefined()
  })
})

describe('isAllowedYoutubeCaptionUrl', () => {
  it.each([
    ['the www host', `https://www.youtube.com/api/timedtext?v=${videoId}`],
    ['the bare host with extra params', `https://youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`],
  ])('allows %s', (_name, url) => {
    expect(isAllowedYoutubeCaptionUrl(url)).toBe(true)
  })

  it.each([
    ['plain http', `http://www.youtube.com/api/timedtext?v=${videoId}`],
    ['a regional subdomain', `https://m.youtube.com/api/timedtext?v=${videoId}`],
    ['a lookalike suffix host', `https://www.youtube.com.evil.example/api/timedtext?v=${videoId}`],
    ['an unrelated host', `https://evil.example/api/timedtext?v=${videoId}`],
    ['a deeper path', `https://www.youtube.com/api/timedtext/extra?v=${videoId}`],
    ['a different api path', `https://www.youtube.com/api/v3/player?v=${videoId}`],
    ['a missing video id', 'https://www.youtube.com/api/timedtext'],
    ['an id below the length floor', 'https://www.youtube.com/api/timedtext?v=short'],
    ['malformed input', 'not a url'],
  ])('rejects %s', (_name, url) => {
    expect(isAllowedYoutubeCaptionUrl(url)).toBe(false)
  })
})

describe('readYoutubeCaptionBridgeResponse', () => {
  it('accepts a well-formed reply and echoes the request id', () => {
    const response = readYoutubeCaptionBridgeResponse(envelope(), 'lexi-request')

    expect(response).toEqual({
      channel: youtubeCaptionBridgeChannel,
      version: youtubeCaptionBridgeVersion,
      type: 'tracklist',
      requestId: 'lexi-request',
      videoId,
      tracks: [track()],
    })
  })

  it('checks the reply against the expected video when one is supplied', () => {
    expect(readYoutubeCaptionBridgeResponse(envelope(), 'lexi-request', videoId)).toBeDefined()
    expect(readYoutubeCaptionBridgeResponse(envelope(), 'lexi-request', 'otherVideo')).toBeUndefined()
  })

  it.each([
    ['a foreign channel', envelope({ channel: 'other-channel' })],
    ['a different version', envelope({ version: 2 })],
    ['a different message type', envelope({ type: 'request-tracklist' })],
    ['a mismatched request id', envelope({ requestId: 'lexi-other' })],
    ['a non-string video id', envelope({ videoId: 42 })],
    ['a malformed video id', envelope({ videoId: 'short' })],
    ['a missing tracks array', envelope({ tracks: 'nope' })],
    ['an empty tracks array', envelope({ tracks: [] })],
    ['a non-object payload', 'nope'],
    ['a null payload', null],
  ])('rejects %s', (_name, value) => {
    expect(readYoutubeCaptionBridgeResponse(value, 'lexi-request')).toBeUndefined()
  })

  it('drops tracks whose address is not an allowed YouTube caption URL', () => {
    const response = readYoutubeCaptionBridgeResponse(envelope({
      tracks: [
        track({ baseUrl: 'https://evil.example/api/timedtext?v=dQw4w9WgXcQ' }),
        track({ baseUrl: `http://www.youtube.com/api/timedtext?v=${videoId}` }),
        track({ baseUrl: `https://www.youtube.com/api/other?v=${videoId}` }),
        track(),
      ],
    }), 'lexi-request')

    expect(response?.tracks).toEqual([track()])
  })

  it('drops tracks with an unusable language, label or kind', () => {
    const response = readYoutubeCaptionBridgeResponse(envelope({
      tracks: [
        track({ languageCode: 'x' }),
        track({ label: '' }),
        track({ label: 'L'.repeat(121) }),
        track({ languageCode: 'en', kind: 'asr' as 'native' }),
        track(),
      ],
    }), 'lexi-request')

    expect(response?.tracks).toEqual([track()])
  })

  it('declines a reply whose only track is invalid', () => {
    expect(readYoutubeCaptionBridgeResponse(envelope({ tracks: [track({ baseUrl: 'https://evil.example/x' })] }), 'r')).toBeUndefined()
  })

  it('caps the track list so a hostile reply cannot flood the reader', () => {
    const tracks = Array.from({ length: 33 }, (_value, index) => track({ languageCode: `en-${index}`, label: `Track ${index}` }))

    const response = readYoutubeCaptionBridgeResponse(envelope({ tracks }), 'lexi-request')

    expect(response?.tracks).toHaveLength(32)
    expect(response?.tracks[0]?.label).toBe('Track 0')
    expect(response?.tracks[31]?.label).toBe('Track 31')
    expect(response?.tracks.some(entry => entry.label === 'Track 32')).toBe(false)
  })
})
