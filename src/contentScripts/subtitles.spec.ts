// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachBilingualTextTrack, startSubtitleEnhancer } from './subtitles'

// Importing the controller pulls in the runtime-messaging module, which expects a real
// extension context; the DOM primitives it writes to are stubbed below.
const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }))

vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendMessage: mocks.sendMessage } },
}))

class FakeVTTCue {
  startTime: number
  endTime: number
  text: string

  constructor(startTime: number, endTime: number, text: string) {
    this.startTime = startTime
    this.endTime = endTime
    this.text = text
  }
}

interface FakeTextTrack {
  kind: string
  label: string
  language: string
  mode: string
  cues: FakeVTTCue[]
  addCue: (cue: FakeVTTCue) => void
  removeCue: (cue: FakeVTTCue) => void
}

function createFakeTrack(kind: string, label: string, language: string): FakeTextTrack {
  const track: FakeTextTrack = {
    kind,
    label,
    language,
    mode: 'hidden',
    cues: [],
    addCue(cue) { track.cues.push(cue) },
    removeCue(cue) { track.cues = track.cues.filter(existing => existing !== cue) },
  }

  return track
}

/** jsdom does not implement `addTextTrack`; the returned list mirrors the media element. */
function installMediaStubs(options: { failAtCue?: number } = {}) {
  const created: FakeTextTrack[] = []

  vi.spyOn(window.HTMLMediaElement.prototype, 'addTextTrack').mockImplementation((kind, label, language) => {
    const track = createFakeTrack(kind, label ?? '', language ?? '')
    const { failAtCue } = options
    if (failAtCue) {
      track.addCue = (cue) => {
        if (track.cues.length + 1 === failAtCue)
          throw new Error('cue rejected by the media element')

        track.cues.push(cue)
      }
    }

    created.push(track)
    return track as unknown as TextTrack
  })

  return created
}

beforeEach(() => {
  vi.stubGlobal('VTTCue', FakeVTTCue)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('attachBilingualTextTrack', () => {
  it('attaches exactly one showing track whose cues carry both languages', () => {
    const media = document.createElement('video')
    const created = installMediaStubs()

    const attached = attachBilingualTextTrack(media, [
      { start: 1, end: 2, source: 'Hello', translation: '你好' },
      { start: 2, end: 3, source: 'Bye', translation: '' },
    ])

    expect(created).toHaveLength(1)
    expect(attached).toBeDefined()
    expect(created[0]!.kind).toBe('subtitles')
    expect(created[0]!.language).toBe('zh-Hans')
    expect(created[0]!.mode).toBe('showing')
    expect(created[0]!.cues.map(cue => [cue.startTime, cue.endTime])).toEqual([[1, 2], [2, 3]])
    expect(created[0]!.cues.map(cue => cue.text)).toEqual(['Hello\n你好', 'Bye'])
    expect(attached!.cues).toHaveLength(2)
    expect(attached!.track).toBe(created[0])
  })

  it('detaches by removing exactly the cues it added and disabling its own track', () => {
    const media = document.createElement('video')
    const created = installMediaStubs()

    // A track the page itself owns must survive a Lexi teardown untouched.
    const pageTrack = media.addTextTrack('captions', 'Page', 'en') as unknown as FakeTextTrack
    const pageCue = new FakeVTTCue(0, 1, 'page')
    pageTrack.addCue(pageCue)

    const attached = attachBilingualTextTrack(media, [{ start: 1, end: 2, source: 'Hello', translation: '你好' }])!
    const lexiTrack = created[1]!
    expect(lexiTrack.cues).toHaveLength(1)

    // Media replacement fires both `emptied` and `loadstart`, so teardown can run twice.
    attached.detach()
    attached.detach()

    expect(lexiTrack.cues).toHaveLength(0)
    expect(lexiTrack.mode).toBe('disabled')
    expect(attached.cues).toHaveLength(0)
    expect(pageTrack.cues).toEqual([pageCue])
  })

  it('leaves exactly one live track after a replacement cycle', () => {
    const media = document.createElement('video')
    const created = installMediaStubs()

    const first = attachBilingualTextTrack(media, [{ start: 0, end: 1, source: 'a', translation: 'A' }])!
    first.detach()
    const second = attachBilingualTextTrack(media, [{ start: 1, end: 2, source: 'b', translation: 'B' }])!

    const showing = created.filter(track => track.mode === 'showing')

    expect(showing).toHaveLength(1)
    expect(showing[0]!.cues.map(cue => cue.text)).toEqual(['b\nB'])
    expect(second.cues).toHaveLength(1)
  })

  it('rolls back the cues it already added when the media element rejects one', () => {
    const media = document.createElement('video')
    const created = installMediaStubs({ failAtCue: 2 })

    const attached = attachBilingualTextTrack(media, [
      { start: 1, end: 2, source: 'one', translation: '一' },
      { start: 2, end: 3, source: 'two', translation: '二' },
      { start: 3, end: 4, source: 'three', translation: '三' },
    ])

    expect(attached).toBeUndefined()
    expect(created[0]!.cues).toHaveLength(0)
    expect(created[0]!.mode).toBe('disabled')
  })

  it('does not add an empty track when nothing aligned', () => {
    const media = document.createElement('video')
    const created = installMediaStubs()

    expect(attachBilingualTextTrack(media, [])).toBeUndefined()
    expect(created).toHaveLength(0)
  })
})

const eventsUrl = 'https://www.apple.com/apple-events/'
const watchMasterUrl = 'https://events-delivery.apple.com/2026/keynote/master.m3u8'
const masterPlaylist = `#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="subtitles/en/prog_index.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="简体中文",LANGUAGE="zh-Hans",DEFAULT=NO,URI="subtitles/zh/prog_index.m3u8"
`
const playlistByLanguage: Record<string, string> = {
  en: '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.006,\nen_0.vtt\n#EXT-X-ENDLIST\n',
  zh: '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.006,\nzh_0.vtt\n#EXT-X-ENDLIST\n',
}
const segmentByFile: Record<string, string> = {
  'en_0.vtt': 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello',
  'zh_0.vtt': 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n你好',
}

function subtitleResponseFor(url: string) {
  if (url.endsWith('/master.m3u8'))
    return masterPlaylist
  if (url.endsWith('/en/prog_index.m3u8'))
    return playlistByLanguage.en
  if (url.endsWith('/zh/prog_index.m3u8'))
    return playlistByLanguage.zh

  return segmentByFile[url.slice(url.lastIndexOf('/') + 1)] ?? ''
}

function mountPlayer() {
  const video = document.createElement('video')
  vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({ width: 640, height: 360 } as DOMRect)
  document.body.appendChild(video)
  return video
}

function clickWatchLink(href: string, className: string) {
  const anchor = document.createElement('a')
  anchor.setAttribute('films-modal', '')
  anchor.setAttribute('href', href)
  anchor.className = className
  document.body.appendChild(anchor)

  // jsdom would otherwise follow the href after the event; cancel the default action so
  // the test stays a pure click and the virtual console stays quiet.
  const cancelNavigation = (event: Event) => event.preventDefault()
  document.addEventListener('click', cancelNavigation)
  try {
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }
  finally {
    document.removeEventListener('click', cancelNavigation)
  }
}

/** Let the 300ms click debounce, the route watcher and the async load chain all settle. */
async function settleSubtitleWork() {
  await vi.advanceTimersByTimeAsync(1000)
  for (let tick = 0; tick < 8; tick++)
    await Promise.resolve()
  await vi.advanceTimersByTimeAsync(1000)
}

describe('startSubtitleEnhancer', () => {
  let stopEnhancer: (() => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    mocks.sendMessage.mockReset()
    mocks.sendMessage.mockImplementation(async (message: { data?: { url?: string } }) => ({
      ok: true,
      text: subtitleResponseFor(message?.data?.url ?? ''),
      contentType: 'text/vtt',
    }))
  })

  afterEach(() => {
    stopEnhancer?.()
    stopEnhancer = undefined
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('rejects the real ASL watch link but follows the spoken one', async () => {
    const created = installMediaStubs()
    mountPlayer()
    stopEnhancer = startSubtitleEnhancer({ readPageUrl: () => eventsUrl })

    clickWatchLink('https://events-delivery.apple.com/2026/asl/master.m3u8', 'watch-recent-event-asl')
    await settleSubtitleWork()
    expect(created).toHaveLength(0)
    expect(mocks.sendMessage).not.toHaveBeenCalled()

    clickWatchLink(watchMasterUrl, 'watch-recent-event')
    await settleSubtitleWork()
    expect(created).toHaveLength(1)
    expect(created[0]!.mode).toBe('showing')
    expect(created[0]!.cues.map(cue => cue.text)).toEqual(['Hello\n你好'])
  })

  it('detaches the active cues when the player disappears with no replacement', async () => {
    const created = installMediaStubs()
    const video = mountPlayer()
    stopEnhancer = startSubtitleEnhancer({ readPageUrl: () => eventsUrl })

    clickWatchLink(watchMasterUrl, 'watch-recent-event')
    await settleSubtitleWork()
    expect(created[0]!.cues).toHaveLength(1)

    video.remove()
    await settleSubtitleWork()

    expect(created[0]!.cues).toHaveLength(0)
    expect(created[0]!.mode).toBe('disabled')
  })
})
