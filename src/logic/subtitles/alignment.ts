import type { SubtitleCue } from './types'
import { normalizeSubtitleCues } from './webvtt'

export interface BilingualSubtitleCue {
  start: number
  end: number
  source: string
  translation: string
}

export interface BilingualAlignOptions {
  /**
   * How far apart two cues may be and still be paired. Segments drift by a few hundred
   * milliseconds between languages, so exact interval equality would leave holes.
   */
  toleranceSeconds?: number
}

function overlapSeconds(a: SubtitleCue, b: SubtitleCue) {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start)
}

function gapSeconds(a: SubtitleCue, b: SubtitleCue) {
  if (a.end < b.start)
    return b.start - a.end

  if (b.end < a.start)
    return a.start - b.end

  return 0
}

/**
 * Pairs official tracks by timeline, never by cue index.
 *
 * The two languages are cut independently: one English cue may cover two Chinese cues
 * (split) or two English cues may share one Chinese cue (merged), and their boundaries
 * are only approximately equal. Every source cue therefore collects *all* translation
 * cues that overlap it, in time order, and the pair keeps the source cue's interval so
 * subtitles appear and disappear with the language the viewer is reading.
 */
export function alignBilingualCues(
  source: SubtitleCue[],
  translation: SubtitleCue[],
  options: BilingualAlignOptions = {},
): BilingualSubtitleCue[] {
  const tolerance = Math.max(0, options.toleranceSeconds ?? 1.5)
  const sourceCues = normalizeSubtitleCues(source)
  const translationCues = normalizeSubtitleCues(translation)

  return sourceCues.map((cue) => {
    const overlapping = translationCues
      .filter(candidate => overlapSeconds(candidate, cue) > 0)

    let partners = overlapping
    if (!partners.length && tolerance > 0) {
      // Nothing overlaps — fall back to the closest cue only if it is near enough that a
      // human would still read it as the translation of this line.
      const nearest = translationCues
        .map(candidate => ({ candidate, gap: gapSeconds(candidate, cue) }))
        .filter(entry => entry.gap <= tolerance)
        .sort((a, b) => a.gap - b.gap || a.candidate.start - b.candidate.start)[0]
      partners = nearest ? [nearest.candidate] : []
    }

    return {
      start: cue.start,
      end: cue.end,
      source: cue.text,
      translation: partners.map(partner => partner.text).join('\n').trim(),
    }
  })
}
