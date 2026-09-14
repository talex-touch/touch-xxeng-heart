// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAppleEventsSubtitleProvider,
  createAppleEventsSubtitleSource,
  findAppleEventsMasterUrl,
  isAppleEventsPage,
  isAslAppleEventsLink,
} from './appleEvents'
import { resolveSubtitleSource } from './registry'
import { simpleHash } from '~/logic/text'

const masterUrl = 'https://events-delivery.apple.com/2026/keynote/master.m3u8'
const masterWithSubtitles = `#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="subtitles/en/prog_index.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="简体中文",LANGUAGE="zh-Hans",DEFAULT=NO,URI="subtitles/zh/prog_index.m3u8"
`

afterEach(() => {
  document.body.innerHTML = ''
})

describe('isAppleEventsPage', () => {
  it.each([
    'https://www.apple.com/apple-events/',
    'https://www.apple.com/cn/apple-events/',
    'https://apple.com/apple-events/stream/',
  ])('matches the localized events page %s', (url) => {
    expect(isAppleEventsPage(url)).toBe(true)
    expect(isAppleEventsPage(new URL(url))).toBe(true)
  })

  it.each([
    ['an unrelated apple.com page', 'https://www.apple.com/mac/'],
    ['an events lookalike path', 'https://www.apple.com/apple-events-archive/'],
    ['plain http', 'http://www.apple.com/apple-events/'],
    ['the media host itself', 'https://events-delivery.apple.com/apple-events/'],
    ['a lookalike host', 'https://apple.com.evil.example/apple-events/'],
    ['a non-url', 'not a url'],
  ])('rejects %s', (_name, url) => {
    expect(isAppleEventsPage(url)).toBe(false)
  })
})

describe('isAslAppleEventsLink', () => {
  it.each([
    ['an id token', 'id="apple-event-june-2026-asl"'],
    ['a class token', 'class="watch-recent-event-asl"'],
    ['an ASL aria label', 'aria-label="Watch in ASL"'],
    ['an American Sign Language aria label', 'aria-label="Watch with American Sign Language"'],
    ['a sign-language title', 'title="American Sign Language"'],
  ])('detects %s', (_name, attributes) => {
    document.body.innerHTML = `<a ${attributes} href="${masterUrl}">Watch</a>`

    expect(isAslAppleEventsLink(document.querySelector('a')!)).toBe(true)
  })

  it.each([
    ['a plain watch link', 'class="watch-recent-event"'],
    ['a word that merely contains the letters', 'class="nasal-layout"'],
  ])('leaves %s alone', (_name, attributes) => {
    document.body.innerHTML = `<a ${attributes} href="${masterUrl}">Watch</a>`

    expect(isAslAppleEventsLink(document.querySelector('a')!)).toBe(false)
  })
})

describe('findAppleEventsMasterUrl', () => {
  it('returns the modal HLS link and skips links that cannot be read', () => {
    document.body.innerHTML = `
      <a films-modal href="https://www.apple.com/apple-events/stream/">Watch online</a>
      <a films-modal href="${masterUrl}">Watch</a>
    `

    expect(findAppleEventsMasterUrl(document, 'https://www.apple.com/apple-events/')).toBe(masterUrl)
  })

  it.each([
    ['a sign-language link without the modal attribute', '<a href="https://events-delivery.apple.com/2026/asl/master.m3u8">Sign language</a>'],
    ['a modal link that is not a playlist', '<a films-modal href="https://www.apple.com/apple-events/stream/">Watch online</a>'],
    ['a lookalike media host', '<a films-modal href="https://events-delivery.apple.com.evil.example/2026/master.m3u8">Watch</a>'],
    ['a non-https playlist', '<a films-modal href="ftp://events-delivery.apple.com/2026/master.m3u8">Watch</a>'],
  ])('ignores %s', (_name, html) => {
    document.body.innerHTML = html

    expect(findAppleEventsMasterUrl(document, 'https://www.apple.com/apple-events/')).toBeUndefined()
  })
})

describe('apple events subtitle provider', () => {
  it('matches Apple Events pages only', () => {
    const provider = createAppleEventsSubtitleProvider({ fetchResource: async () => masterWithSubtitles })

    expect(provider.match(new URL('https://www.apple.com/apple-events/'))).toBe(true)
    expect(provider.match(new URL('https://www.apple.com/mac/'))).toBe(false)
  })

  it('declines until a player and a master url are both available', async () => {
    const noPlayer = createAppleEventsSubtitleProvider({
      fetchResource: async () => masterWithSubtitles,
      getMedia: () => undefined,
      getMasterUrl: () => masterUrl,
    })
    expect(await noPlayer.resolve(new URL('https://www.apple.com/apple-events/'))).toBeUndefined()

    const noMaster = createAppleEventsSubtitleProvider({
      fetchResource: async () => masterWithSubtitles,
      getMedia: () => document.createElement('video'),
    })
    expect(await noMaster.resolve(new URL('https://www.apple.com/apple-events/'))).toBeUndefined()
  })

  it('exposes the official en and zh renditions as native tracks', async () => {
    const media = document.createElement('video')
    const provider = createAppleEventsSubtitleProvider({
      fetchResource: async () => masterWithSubtitles,
      getMedia: () => media,
      getMasterUrl: () => masterUrl,
    })

    const source = await provider.resolve(new URL('https://www.apple.com/cn/apple-events/'))

    expect(source?.media).toBe(media)
    // The unified subtitle cache must never persist a media URL, so the id is a hash.
    expect(source?.mediaId).toBe(`apple-events:${simpleHash(masterUrl)}`)
    expect(source?.mediaId).not.toContain(masterUrl)

    const tracks = await source!.listTracks()
    expect(tracks.map(track => ({ language: track.language, label: track.label, kind: track.kind }))).toEqual([
      { language: 'en', label: 'English', kind: 'native' },
      { language: 'zh-Hans', label: '简体中文', kind: 'native' },
    ])
  })

  it('never reads media from outside the Apple delivery host', async () => {
    const media = document.createElement('video')
    const fetchResource = vi.fn(async () => masterWithSubtitles)

    const spoofedHref = createAppleEventsSubtitleProvider({
      fetchResource,
      getMedia: () => media,
      getMasterUrl: () => 'https://events-delivery.apple.com.evil.example/master.m3u8',
    })
    expect(await spoofedHref.resolve(new URL('https://www.apple.com/apple-events/'))).toBeUndefined()

    const bareMaster = createAppleEventsSubtitleProvider({ fetchResource, getMedia: () => media })
    expect(await bareMaster.resolve(new URL('https://evil.example/master.m3u8'))).toBeUndefined()

    expect(fetchResource).not.toHaveBeenCalled()
  })

  it('resolves without enabling billable providers', async () => {
    const media = document.createElement('video')
    const provider = createAppleEventsSubtitleProvider({
      fetchResource: async () => masterWithSubtitles,
      getMedia: () => media,
      getMasterUrl: () => masterUrl,
    })

    const resolved = await resolveSubtitleSource([provider], new URL('https://www.apple.com/apple-events/'), { allowBillable: false })

    expect(resolved?.provider.id).toBe('apple-events-hls')
    expect(resolved?.source.media).toBe(media)
  })
})

describe('createAppleEventsSubtitleSource', () => {
  it('refuses a master outside the Apple host without fetching', async () => {
    const fetchResource = vi.fn(async () => masterWithSubtitles)

    const source = await createAppleEventsSubtitleSource({
      masterUrl: 'https://evil.example/master.m3u8',
      media: document.createElement('video'),
      fetchResource,
    })

    expect(source).toBeUndefined()
    expect(fetchResource).not.toHaveBeenCalled()
  })

  it('declines a master that carries no subtitle renditions', async () => {
    const source = await createAppleEventsSubtitleSource({
      masterUrl,
      media: document.createElement('video'),
      fetchResource: async () => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nvideo.m3u8\n',
    })

    expect(source).toBeUndefined()
  })

  it('places rendition segments on the media timeline', async () => {
    const media = document.createElement('video')
    const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.006,
seg_0.vtt
#EXTINF:6.006,
seg_1.vtt
#EXTINF:6.006,
seg_2.vtt
#EXT-X-ENDLIST
`
    const segments: Record<string, string> = {
      'seg_0.vtt': 'WEBVTT\n\n00:00:00.500 --> 00:00:01.500\nZero based',
      'seg_1.vtt': 'WEBVTT\n\n00:00:12.100 --> 00:00:13.000\nAbsolute',
      'seg_2.vtt': 'WEBVTT\n\n00:00:00.400 --> 00:00:01.200\nLater local',
    }
    const fetchResource = vi.fn(async (url: string) => {
      if (url.endsWith('/master.m3u8'))
        return masterWithSubtitles
      if (url.endsWith('/prog_index.m3u8'))
        return playlist

      return segments[url.slice(url.lastIndexOf('/') + 1)] ?? ''
    })

    const source = await createAppleEventsSubtitleSource({ masterUrl, media, fetchResource })
    const [track] = await source!.listTracks()
    const cues = await track!.load()

    // A segment that stores zero-based times is shifted onto its cumulative start; a
    // segment that already carries absolute times is left alone.
    const round = (value: number) => Math.round(value * 1000) / 1000
    expect(cues.map(cue => [round(cue.start), round(cue.end), cue.text])).toEqual([
      [0.5, 1.5, 'Zero based'],
      [12.1, 13, 'Absolute'],
      [12.412, 13.212, 'Later local'],
    ])
  })
})
