// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createHtml5SubtitleProvider } from './html5'

interface FakeCue {
  startTime: number
  endTime: number
  text: string
}

interface FakeTrackOptions {
  kind: string
  label: string
  language?: string
  mode?: string
  cues?: FakeCue[]
}

interface FakeTrack {
  kind: string
  label: string
  language: string
  mode: string
  modeLog: string[]
  readonly cues: FakeCue[]
}

/**
 * A native track that mirrors the browser contract the provider depends on: a `disabled`
 * track exposes no cues until its mode changes, so reading one requires enabling it first.
 * `modeLog` makes that round trip observable instead of assumed.
 */
function fakeTrack(options: FakeTrackOptions): FakeTrack {
  const cues = options.cues ?? []
  const modeLog: string[] = []
  let mode = options.mode ?? 'hidden'

  return {
    kind: options.kind,
    label: options.label,
    language: options.language ?? '',
    modeLog,
    get mode() {
      return mode
    },
    set mode(value: string) {
      mode = value
      modeLog.push(value)
    },
    get cues() {
      return mode === 'disabled' ? [] : cues
    },
  }
}

function mediaWithTracks(tracks: FakeTrack[]): HTMLVideoElement {
  const media = document.createElement('video')
  Object.defineProperty(media, 'textTracks', { value: tracks, configurable: true })
  return media
}

const pageUrl = new URL('https://example.com/watch')

describe('createHtml5SubtitleProvider', () => {
  it('lists subtitle and caption tracks only, never its own bilingual track', async () => {
    const media = mediaWithTracks([
      fakeTrack({ kind: 'subtitles', label: 'English', language: 'en', cues: [{ startTime: 0, endTime: 1, text: 'Hello' }] }),
      fakeTrack({ kind: 'captions', label: 'Deutsch', language: 'de', cues: [{ startTime: 0, endTime: 1, text: 'Hallo' }] }),
      fakeTrack({ kind: 'chapters', label: 'Chapters' }),
      fakeTrack({ kind: 'metadata', label: 'Info' }),
      fakeTrack({ kind: 'subtitles', label: 'Lexi 双语', language: 'zh-Hans', cues: [{ startTime: 0, endTime: 1, text: '你好' }] }),
    ])
    const provider = createHtml5SubtitleProvider({ getMedia: () => media })

    const source = await provider.resolve(pageUrl)
    const tracks = await source!.listTracks()

    expect(tracks.map(track => [track.language, track.label, track.kind])).toEqual([
      ['en', 'English', 'native'],
      ['de', 'Deutsch', 'native'],
    ])
  })

  it('declines a page whose only track is its own bilingual track', async () => {
    const onlyOwnTrack = mediaWithTracks([
      fakeTrack({ kind: 'subtitles', label: 'Lexi 双语', language: 'zh-Hans', cues: [{ startTime: 0, endTime: 1, text: '你好' }] }),
    ])

    expect(await createHtml5SubtitleProvider({ getMedia: () => undefined }).resolve(pageUrl)).toBeUndefined()
    expect(await createHtml5SubtitleProvider({ getMedia: () => mediaWithTracks([]) }).resolve(pageUrl)).toBeUndefined()
    expect(await createHtml5SubtitleProvider({ getMedia: () => onlyOwnTrack }).resolve(pageUrl)).toBeUndefined()
  })

  it('temporarily enables a disabled track, then restores it after copying clean cues', async () => {
    const track = fakeTrack({
      kind: 'subtitles',
      label: 'English',
      language: 'en',
      mode: 'disabled',
      cues: [
        { startTime: 0, endTime: 1.5, text: '  <i>Hello</i> &amp; welcome ' },
        { startTime: 1.5, endTime: 2, text: 'multi\nline' },
        { startTime: 2, endTime: 2, text: 'zero length' },
        { startTime: 3, endTime: 2.5, text: 'reversed' },
        { startTime: 4, endTime: 5, text: '<b></b>   ' },
      ],
    })
    const media = mediaWithTracks([track])
    const provider = createHtml5SubtitleProvider({ getMedia: () => media })

    const source = await provider.resolve(pageUrl)
    const [handle] = await source!.listTracks()
    const cues = await handle!.load()

    expect(track.modeLog).toEqual(['hidden', 'disabled'])
    expect(track.mode).toBe('disabled')
    expect(cues).toEqual([
      { start: 0, end: 1.5, text: 'Hello & welcome' },
      { start: 1.5, end: 2, text: 'multi line' },
    ])
  })

  it('reports no tracks once the caller aborts', async () => {
    const media = mediaWithTracks([
      fakeTrack({ kind: 'subtitles', label: 'English', language: 'en', cues: [{ startTime: 0, endTime: 1, text: 'Hello' }] }),
    ])
    const provider = createHtml5SubtitleProvider({ getMedia: () => media })
    const source = await provider.resolve(pageUrl)

    const controller = new AbortController()
    controller.abort()

    expect(await source!.listTracks(controller.signal)).toEqual([])
  })
})
