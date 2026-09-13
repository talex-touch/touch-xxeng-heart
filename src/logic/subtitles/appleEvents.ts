import { isAllowedSubtitleResourceUrl } from './resourcePolicy'
import { parseHlsMasterPlaylist, parseHlsMediaPlaylist, resolveHlsUrl } from './hls'
import type { HlsSubtitleRendition } from './hls'
import { normalizeSubtitleCues, parseWebVtt } from './webvtt'
import type { SubtitleCue, SubtitleProvider, SubtitleSource, SubtitleTrackHandle } from './types'

/** Fetches one allowed resource as text. Supplied by the caller so the provider is testable. */
export type SubtitleResourceFetcher = (url: string, options?: { signal?: AbortSignal }) => Promise<string>

/**
 * Localized Events landing pages, e.g. `apple.com/apple-events/` and
 * `www.apple.com/cn/apple-events/`. A Watch link is only meaningful on one of these.
 */
export function isAppleEventsPage(url: string | URL): boolean {
  let parsed: URL
  try {
    parsed = typeof url === 'string' ? new URL(url) : url
  }
  catch {
    return false
  }

  if (parsed.protocol !== 'https:')
    return false

  if (parsed.hostname !== 'apple.com' && parsed.hostname !== 'www.apple.com')
    return false

  return /\/apple-events(?:\/|$)/i.test(parsed.pathname)
}

/**
 * Apple ships a sign-language rendition whose link carries the same `films-modal` marker
 * and `.m3u8` href as the spoken one. It is a different video with its own subtitles, so
 * it must be identified by its own identity attributes rather than by URL shape.
 */
export function isAslAppleEventsLink(anchor: Element): boolean {
  const haystack = [
    anchor.id,
    anchor.getAttribute('class') ?? '',
    anchor.getAttribute('aria-label') ?? '',
    anchor.getAttribute('title') ?? '',
  ].join(' ').toLowerCase()

  return /(?:^|[^a-z])asl(?:[^a-z]|$)/.test(haystack) || haystack.includes('sign language')
}

/**
 * The Watch button carries the HLS master URL directly. ASL links are a separate sign
 * language rendition and are deliberately not matched.
 */
export function findAppleEventsMasterUrl(root: ParentNode, baseUrl: string = location.href): string | undefined {
  for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[films-modal][href]'))) {
    const href = anchor.getAttribute('href')
    if (!href || !href.includes('.m3u8') || isAslAppleEventsLink(anchor))
      continue

    const resolved = resolveHlsUrl(baseUrl, href)
    if (isAllowedSubtitleResourceUrl(resolved))
      return resolved
  }

  return undefined
}

/**
 * A subtitle rendition playlist normally lists WebVTT segments; each carries absolute
 * media timestamps. A playlist that stored zero-based times is shifted onto the segment's
 * cumulative start so both shapes land on the same clock.
 */
function placeRelativeCues(cues: SubtitleCue[], segmentStart: number): SubtitleCue[] {
  if (segmentStart <= 1 || cues.some(cue => cue.end > segmentStart))
    return cues

  return cues.map(cue => ({
    start: cue.start + segmentStart,
    end: cue.end + segmentStart,
    text: cue.text,
  }))
}

async function loadRenditionCues(
  rendition: HlsSubtitleRendition,
  fetchResource: SubtitleResourceFetcher,
  signal?: AbortSignal,
): Promise<SubtitleCue[]> {
  const playlistText = await fetchResource(rendition.uri, { signal })

  // Defensive: a rendition URI that already points at a single VTT document.
  if (/^\s*WEBVTT/.test(playlistText))
    return parseWebVtt(playlistText)

  const playlist = parseHlsMediaPlaylist(playlistText, rendition.uri)
  const cues: SubtitleCue[] = []

  for (const segment of playlist.segments) {
    if (signal?.aborted)
      break

    const segmentText = await fetchResource(segment.url, { signal })
    cues.push(...placeRelativeCues(parseWebVtt(segmentText), segment.start))
  }

  return normalizeSubtitleCues(cues)
}

export interface AppleEventsSubtitleSourceOptions {
  masterUrl: string
  media: HTMLVideoElement
  mediaId?: string
  fetchResource: SubtitleResourceFetcher
  signal?: AbortSignal
}

/**
 * Reads a master playlist and exposes its official subtitle renditions as native tracks.
 * Nothing here translates: the tracks are already bilingual when Apple ships both.
 */
export async function createAppleEventsSubtitleSource(
  options: AppleEventsSubtitleSourceOptions,
): Promise<SubtitleSource | undefined> {
  if (!isAllowedSubtitleResourceUrl(options.masterUrl))
    return undefined

  const masterText = await options.fetchResource(options.masterUrl, { signal: options.signal })
  if (options.signal?.aborted)
    return undefined

  const master = parseHlsMasterPlaylist(masterText, options.masterUrl)
  if (!master.subtitleRenditions.length)
    return undefined

  const tracks: SubtitleTrackHandle[] = master.subtitleRenditions.map(rendition => ({
    language: rendition.language || 'und',
    label: rendition.name || rendition.language || 'Subtitles',
    kind: 'native',
    load: loadOptions => loadRenditionCues(
      rendition,
      options.fetchResource,
      loadOptions?.signal ?? options.signal,
    ),
  }))

  return {
    mediaId: options.mediaId ?? `apple-events:${options.masterUrl}`,
    media: options.media,
    listTracks: async (signal) => {
      if (signal?.aborted)
        return []

      return tracks
    },
  }
}

export interface AppleEventsSubtitleProviderConfig {
  fetchResource: SubtitleResourceFetcher
  /** The currently mounted Apple Events player, or undefined before it appears. */
  getMedia?: () => HTMLVideoElement | undefined
  /** Master URL captured from the clicked Watch link or the live `<video>`. */
  getMasterUrl?: (url: URL) => string | undefined
  mediaId?: string
}

export function createAppleEventsSubtitleProvider(
  config: AppleEventsSubtitleProviderConfig,
): SubtitleProvider {
  return {
    id: 'apple-events-hls',
    label: 'Apple Events 官方字幕',
    priority: 10,
    billable: false,
    match: isAppleEventsPage,
    resolve: async (url, signal) => {
      const masterUrl = config.getMasterUrl?.(url)
        ?? (isAllowedSubtitleResourceUrl(url.href) && url.pathname.toLowerCase().endsWith('.m3u8') ? url.href : undefined)
      const media = config.getMedia?.()
      if (!masterUrl || !media)
        return undefined

      return createAppleEventsSubtitleSource({
        masterUrl,
        media,
        mediaId: config.mediaId,
        fetchResource: config.fetchResource,
        signal,
      })
    },
  }
}
