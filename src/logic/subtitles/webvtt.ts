import type { SubtitleCue } from './types'

export interface WebVttParseOptions {
  /**
   * Seconds added to every cue after parsing. Used when a container-level timeline
   * (an HLS `#EXT-X-TIMESTAMP-MAP`) carries the offset instead of the VTT header.
   * When set it wins over the header's own map so the two can never be applied twice.
   */
  offsetSeconds?: number
}

const timestampPattern = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/

/** `HH:MM:SS.mmm`, `MM:SS.mmm` and `MM:SS` all appear in the wild. */
export function parseVttTimestamp(value: string): number | undefined {
  const match = timestampPattern.exec(value.trim())
  if (!match)
    return undefined

  const [, hours, minutes, seconds, millis] = match
  const totalSeconds = Number(seconds) + Number(minutes) * 60 + Number(hours ?? 0) * 3600
  const fraction = millis ? Number(`0.${millis}`) : 0
  return totalSeconds + fraction
}

/**
 * `X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000` describes where a segment's local
 * clock sits on the media timeline. Apple ships absolute times, so the offset is often
 * zero there, but a general HLS reader cannot assume that.
 */
function readTimestampMapOffset(text: string): number {
  const line = /^X-TIMESTAMP-MAP[ \t]*=[ \t]*(\S.*)$/im.exec(text)
  if (!line)
    return 0

  let local = 0
  let mpegts = 0
  for (const part of line[1].split(',')) {
    const separator = part.indexOf(':')
    if (separator < 0)
      continue

    const key = part.slice(0, separator).trim().toUpperCase()
    const value = part.slice(separator + 1).trim()
    if (key === 'LOCAL')
      local = parseVttTimestamp(value) ?? 0
    else if (key === 'MPEGTS')
      mpegts = Number(value) || 0
  }

  return mpegts / 90_000 - local
}

function decodeEntities(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
}

/**
 * WebVTT cue text is a mini-markup language. The reader wants words, not styling, so
 * voice/class/italic spans are unwrapped and their tags dropped.
 */
function cleanCueText(lines: string[]): string {
  return lines
    .map(line => decodeEntities(line.replace(/<[^>]*>/g, '')).trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
}

function parseTimingLine(line: string): { start: number, end: number } | undefined {
  const arrow = line.indexOf('-->')
  if (arrow < 0)
    return undefined

  const start = parseVttTimestamp(line.slice(0, arrow))
  // Everything after the end timestamp is cue settings (`align:start position:10%`).
  const end = parseVttTimestamp(line.slice(arrow + 3).trim().split(/\s+/)[0] ?? '')
  if (start === undefined || end === undefined || end <= start)
    return undefined

  return { start, end }
}

/**
 * Parses one WebVTT document (a full file or a single HLS segment). Cue identifiers,
 * settings and multi-line payloads are all optional; blocks that carry no timing line
 * (NOTE/STYLE/REGION) are skipped rather than mistaken for cues.
 */
export function parseWebVtt(text: string, options: WebVttParseOptions = {}): SubtitleCue[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!/^\s*WEBVTT/.test(normalized) && !normalized.includes('-->'))
    return []

  const offset = options.offsetSeconds ?? readTimestampMapOffset(normalized)
  const cues: SubtitleCue[] = []

  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split('\n').map(line => line.trimEnd())
    const timingIndex = lines.findIndex(line => line.includes('-->'))
    if (timingIndex < 0)
      continue

    // A cue identifier, when present, is exactly one line above the timing line.
    if (timingIndex > 1)
      continue

    const timing = parseTimingLine(lines[timingIndex])
    if (!timing)
      continue

    const cueText = cleanCueText(lines.slice(timingIndex + 1))
    if (!cueText)
      continue

    cues.push({
      start: timing.start + offset,
      end: timing.end + offset,
      text: cueText,
    })
  }

  return normalizeSubtitleCues(cues)
}

/**
 * Cue order and identity. Segments can repeat a cue at a boundary, and different
 * playlists can declare the same interval twice; downstream alignment needs a stable
 * input, so sort by timeline and drop exact duplicates.
 */
export function normalizeSubtitleCues(cues: SubtitleCue[]): SubtitleCue[] {
  const seen = new Set<string>()
  const result: SubtitleCue[] = []

  for (const cue of [...cues].sort((a, b) => a.start - b.start || a.end - b.end || a.text.localeCompare(b.text))) {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end <= cue.start)
      continue

    const key = `${cue.start}|${cue.end}|${cue.text}`
    if (seen.has(key))
      continue

    seen.add(key)
    result.push(cue)
  }

  return result
}
