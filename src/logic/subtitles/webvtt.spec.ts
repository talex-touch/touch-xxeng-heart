import { describe, expect, it } from 'vitest'
import { normalizeSubtitleCues, parseVttTimestamp, parseWebVtt } from './webvtt'

describe('parseVttTimestamp', () => {
  it.each([
    ['00:01.000', 1],
    ['02:03', 123],
    ['02:03.250', 123.25],
    ['01:02:03.500', 3723.5],
    ['00:00:00.005', 0.005],
    ['00:00.5', 0.5],
  ])('reads %s as %s seconds', (value, expected) => {
    expect(parseVttTimestamp(value)).toBeCloseTo(expected, 6)
  })

  it.each([[''], ['nope'], ['00:00:00,500']])('rejects %j', (value) => {
    expect(parseVttTimestamp(value)).toBeUndefined()
  })
})

describe('parseWebVtt', () => {
  it('reads cue ids, settings and multi-line text without leaking markup', () => {
    const text = `WEBVTT

intro
00:00:01.000 --> 00:00:03.500 align:start position:10%
<i>Hello</i>
world

00:00:04.000 --> 00:00:05.250
Second &amp; third
`

    expect(parseWebVtt(text)).toEqual([
      { start: 1, end: 3.5, text: 'Hello\nworld' },
      { start: 4, end: 5.25, text: 'Second & third' },
    ])
  })

  it('ignores NOTE and STYLE blocks instead of reading them as cues', () => {
    const text = `WEBVTT

NOTE this is a comment

STYLE
::cue { color: red }

00:00:01.000 --> 00:00:02.000
Real cue
`

    expect(parseWebVtt(text)).toEqual([{ start: 1, end: 2, text: 'Real cue' }])
  })

  it('returns nothing for documents that carry no cues', () => {
    expect(parseWebVtt('not a vtt file')).toEqual([])
    expect(parseWebVtt('WEBVTT\n\nNOTE nothing to show')).toEqual([])
  })
})

describe('parseWebVtt timestamp maps', () => {
  it('places segment-local cues on the media clock', () => {
    const text = `WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000

00:00:01.000 --> 00:00:02.000
Shifted
`

    expect(parseWebVtt(text)).toEqual([{ start: 11, end: 12, text: 'Shifted' }])
  })

  it('accounts for a non-zero local anchor', () => {
    const text = `WEBVTT
X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:05.000

00:00:01.000 --> 00:00:02.000
Shifted
`

    expect(parseWebVtt(text)).toEqual([{ start: 6, end: 7, text: 'Shifted' }])
  })

  it('lets an explicit offset win so the header map is never applied twice', () => {
    const text = `WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000

00:00:01.000 --> 00:00:02.000
Shifted
`

    expect(parseWebVtt(text, { offsetSeconds: 2 })).toEqual([{ start: 3, end: 4, text: 'Shifted' }])
  })
})

describe('normalizeSubtitleCues', () => {
  it('sorts by timeline and drops only exact duplicates', () => {
    expect(normalizeSubtitleCues([
      { start: 2, end: 3, text: 'b' },
      { start: 1, end: 2, text: 'a' },
      { start: 2, end: 3, text: 'b' },
      { start: 2, end: 3, text: 'b2' },
    ])).toEqual([
      { start: 1, end: 2, text: 'a' },
      { start: 2, end: 3, text: 'b' },
      { start: 2, end: 3, text: 'b2' },
    ])
  })

  it('drops intervals that cannot be displayed', () => {
    expect(normalizeSubtitleCues([
      { start: 5, end: 5, text: 'zero length' },
      { start: 3, end: 2, text: 'backwards' },
      { start: Number.NaN, end: 4, text: 'not a number' },
      { start: 1, end: 2, text: 'valid' },
    ])).toEqual([{ start: 1, end: 2, text: 'valid' }])
  })
})
