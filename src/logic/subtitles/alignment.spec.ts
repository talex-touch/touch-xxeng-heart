import { describe, expect, it } from 'vitest'
import { alignBilingualCues } from './alignment'
import type { SubtitleCue } from './types'

function cue(start: number, end: number, text: string): SubtitleCue {
  return { start, end, text }
}

describe('alignBilingualCues', () => {
  it('pairs by timeline overlap, never by cue index', () => {
    const source = [cue(0, 2, 'Hello'), cue(2, 4, 'Goodbye')]
    const translation = [cue(0.2, 1.8, '你好'), cue(2.1, 2.9, '再见'), cue(2.95, 3.9, '朋友')]

    // Index pairing would hand the second source cue the second translation cue and drop
    // the third one entirely: the two languages are cut independently.
    expect(alignBilingualCues(source, translation)).toEqual([
      { start: 0, end: 2, source: 'Hello', translation: '你好' },
      { start: 2, end: 4, source: 'Goodbye', translation: '再见\n朋友' },
    ])
  })

  it('shares one translation cue across every source cue it spans', () => {
    const pairs = alignBilingualCues([cue(0, 1, 'A'), cue(1, 2, 'B')], [cue(0.1, 1.9, '甲乙')])

    expect(pairs.map(pair => pair.translation)).toEqual(['甲乙', '甲乙'])
  })

  it('counts a translation cue that only partly overlaps', () => {
    expect(alignBilingualCues([cue(2, 4, 'x')], [cue(1, 3, 'y')])[0]!.translation).toBe('y')
  })

  it('falls back to the nearest cue only when it is within tolerance', () => {
    const source = [cue(10, 11, 'x')]
    const translation = [cue(12, 13, 'far'), cue(11.2, 11.8, 'near')]

    expect(alignBilingualCues(source, translation)[0]!.translation).toBe('near')
  })

  it('honours a custom tolerance', () => {
    const source = [cue(0, 1, 'x')]
    const translation = [cue(1.6, 2.0, 'y')]

    expect(alignBilingualCues(source, translation)[0]!.translation).toBe('y')
    expect(alignBilingualCues(source, translation, { toleranceSeconds: 0.5 })[0]!.translation).toBe('')
  })

  it('leaves the translation empty when nothing is near enough', () => {
    expect(alignBilingualCues([cue(0, 1, 'x')], [cue(3, 4, 'y')])[0]!.translation).toBe('')
  })

  it('mirrors the source interval and exposes the source text', () => {
    const [pair] = alignBilingualCues([cue(3.5, 6.25, 'Hello')], [cue(3.6, 6.0, '你好')])

    expect(pair).toEqual({ start: 3.5, end: 6.25, source: 'Hello', translation: '你好' })
  })

  it('emits one pair per source cue, in timeline order', () => {
    const pairs = alignBilingualCues([cue(4, 5, 'late'), cue(0, 1, 'early')], [])

    expect(pairs).toEqual([
      { start: 0, end: 1, source: 'early', translation: '' },
      { start: 4, end: 5, source: 'late', translation: '' },
    ])
  })

  it('returns empty translations when a language has no cues at all', () => {
    const pairs = alignBilingualCues([cue(0, 1, 'a'), cue(1, 2, 'b')], [])

    expect(pairs.map(pair => pair.translation)).toEqual(['', ''])
  })
})
