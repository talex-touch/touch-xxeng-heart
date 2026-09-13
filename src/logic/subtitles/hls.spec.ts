import { describe, expect, it } from 'vitest'
import { parseHlsMasterPlaylist, parseHlsMediaPlaylist, resolveHlsUrl } from './hls'

const masterBase = 'https://events-delivery.apple.com/2026/keynote/master.m3u8'
const renditionBase = 'https://events-delivery.apple.com/2026/keynote/subtitles/en/prog_index.m3u8'

describe('resolveHlsUrl', () => {
  it.each([
    ['subtitles/en/prog_index.m3u8', 'https://events-delivery.apple.com/2026/keynote/subtitles/en/prog_index.m3u8'],
    ['../shared/en.vtt', 'https://events-delivery.apple.com/2026/shared/en.vtt'],
    ['seg.vtt?token=abc', 'https://events-delivery.apple.com/2026/keynote/seg.vtt?token=abc'],
    ['/live/master.m3u8', 'https://events-delivery.apple.com/live/master.m3u8'],
    ['https://cdn.example.com/x.vtt?a=1', 'https://cdn.example.com/x.vtt?a=1'],
  ])('resolves %s against the playlist url', (reference, expected) => {
    expect(resolveHlsUrl(masterBase, reference)).toBe(expected)
  })
})

describe('parseHlsMasterPlaylist', () => {
  const master = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English, Stereo",LANGUAGE="en",DEFAULT=YES,URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,URI="subtitles/en/prog_index.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="简体中文, 大陆",LANGUAGE="zh-Hans",DEFAULT=NO,AUTOSELECT=YES,FORCED=NO,CHARACTERISTICS="public.accessibility.transcribes-spoken-dialog,public.accessibility.describes-music-and-sound",URI="subtitles/zh/prog_index.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="No uri",LANGUAGE="fr"
#EXT-X-STREAM-INF:BANDWIDTH=2000000,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=1920x1080,SUBTITLES="subs"
video/1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720
video/720p.m3u8
`

  it('keeps quoted attribute values that contain commas', () => {
    // A naive split(',') truncates this name and mangles CHARACTERISTICS lists.
    const { subtitleRenditions } = parseHlsMasterPlaylist(master, masterBase)

    expect(subtitleRenditions.map(rendition => rendition.name)).toEqual(['English', '简体中文, 大陆'])
  })

  it('exposes only loadable SUBTITLES renditions with their language flags', () => {
    const { subtitleRenditions } = parseHlsMasterPlaylist(master, masterBase)

    expect(subtitleRenditions).toEqual([
      {
        groupId: 'subs',
        name: 'English',
        language: 'en',
        uri: 'https://events-delivery.apple.com/2026/keynote/subtitles/en/prog_index.m3u8',
        isDefault: true,
        forced: false,
      },
      {
        groupId: 'subs',
        name: '简体中文, 大陆',
        language: 'zh-Hans',
        uri: 'https://events-delivery.apple.com/2026/keynote/subtitles/zh/prog_index.m3u8',
        isDefault: false,
        forced: false,
      },
    ])
  })

  it('reads variants with bandwidth, resolution and a resolved uri', () => {
    const { variants } = parseHlsMasterPlaylist(master, masterBase)

    expect(variants).toEqual([
      { uri: 'https://events-delivery.apple.com/2026/keynote/video/1080p.m3u8', bandwidth: 2000000, resolution: '1920x1080' },
      { uri: 'https://events-delivery.apple.com/2026/keynote/video/720p.m3u8', bandwidth: 800000, resolution: '1280x720' },
    ])
  })
})

describe('parseHlsMediaPlaylist', () => {
  const playlistText = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:42
#EXT-X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000
#EXTINF:6.006,
seg_42.vtt
#EXTINF:6.006,Some, title with commas
seg_43.vtt
#EXTINF:5,
sub/seg_44.vtt
#EXT-X-ENDLIST
`

  it('resolves segments and accumulates their start from EXTINF durations', () => {
    const playlist = parseHlsMediaPlaylist(playlistText, renditionBase)

    expect(playlist.segments.map(segment => segment.url)).toEqual([
      'https://events-delivery.apple.com/2026/keynote/subtitles/en/seg_42.vtt',
      'https://events-delivery.apple.com/2026/keynote/subtitles/en/seg_43.vtt',
      'https://events-delivery.apple.com/2026/keynote/subtitles/en/sub/seg_44.vtt',
    ])
    expect(playlist.segments.map(segment => segment.duration)).toEqual([6.006, 6.006, 5])
    expect(playlist.segments[0]!.start).toBeCloseTo(0, 6)
    expect(playlist.segments[1]!.start).toBeCloseTo(6.006, 6)
    expect(playlist.segments[2]!.start).toBeCloseTo(12.012, 6)
  })

  it('reads playlist-level state including the timestamp map', () => {
    const playlist = parseHlsMediaPlaylist(playlistText, renditionBase)

    expect(playlist.targetDuration).toBe(6)
    expect(playlist.mediaSequence).toBe(42)
    expect(playlist.endList).toBe(true)
    expect(playlist.timestampOffset).toBeCloseTo(10, 6)
  })

  it('marks a growing playlist as unfinished', () => {
    const playlist = parseHlsMediaPlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.006,\nseg.vtt\n', renditionBase)

    expect(playlist.endList).toBe(false)
    expect(playlist.segments).toHaveLength(1)
  })
})
