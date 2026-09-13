/**
 * The slice of HLS this feature needs: read a master playlist, find its subtitle
 * renditions, then read each rendition's media playlist of WebVTT segments. Variants,
 * audio groups and DRM are parsed only far enough to stay out of the way.
 */

export interface HlsVariant {
  uri: string
  bandwidth?: number
  resolution?: string
}

export interface HlsSubtitleRendition {
  groupId: string
  name: string
  /** BCP-47-ish value from the `LANGUAGE` attribute, e.g. `en`, `zh-Hans`. */
  language: string
  /** Absolute, resolved against the playlist URL. */
  uri: string
  isDefault: boolean
  forced: boolean
}

export interface HlsMasterPlaylist {
  variants: HlsVariant[]
  subtitleRenditions: HlsSubtitleRendition[]
}

export interface HlsMediaSegment {
  url: string
  duration: number
  /** Cumulative start on the media timeline, in seconds. */
  start: number
}

export interface HlsMediaPlaylist {
  targetDuration: number
  mediaSequence: number
  endList: boolean
  /** Seconds from `#EXT-X-TIMESTAMP-MAP`; zero when absent. */
  timestampOffset: number
  segments: HlsMediaSegment[]
}

/** `new URL(reference, base)` with a plain string contract for callers that already resolved the base. */
export function resolveHlsUrl(baseUrl: string, reference: string): string {
  try {
    return new URL(reference.trim(), baseUrl).href
  }
  catch {
    return reference.trim()
  }
}

/**
 * `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="..."`.
 * Attribute values are quoted, comma-separated, and may themselves contain commas, so a
 * naive `split(',')` corrupts `CHARACTERISTICS` and similar lists.
 */
function parseAttributeList(value: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  let index = 0

  while (index < value.length) {
    const equals = value.indexOf('=', index)
    if (equals < 0)
      break

    const key = value.slice(index, equals).trim().toUpperCase()
    index = equals + 1
    let parsed = ''

    if (value[index] === '"') {
      const close = value.indexOf('"', index + 1)
      if (close < 0) {
        parsed = value.slice(index + 1)
        index = value.length
      }
      else {
        parsed = value.slice(index + 1, close)
        index = close + 1
      }
    }
    else {
      const comma = value.indexOf(',', index)
      const end = comma < 0 ? value.length : comma
      parsed = value.slice(index, end).trim()
      index = end
    }

    if (key)
      attributes[key] = parsed

    if (value[index] === ',')
      index += 1
  }

  return attributes
}

function readTagLines(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

export function parseHlsMasterPlaylist(text: string, baseUrl: string): HlsMasterPlaylist {
  const variants: HlsVariant[] = []
  const subtitleRenditions: HlsSubtitleRendition[] = []
  let pendingVariant: { bandwidth?: number, resolution?: string } | undefined

  for (const line of readTagLines(text)) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attributes = parseAttributeList(line.slice('#EXT-X-STREAM-INF:'.length))
      const bandwidth = Number(attributes.BANDWIDTH)
      pendingVariant = {
        bandwidth: Number.isFinite(bandwidth) ? bandwidth : undefined,
        resolution: attributes.RESOLUTION,
      }
      continue
    }

    if (line.startsWith('#EXT-X-MEDIA:')) {
      const attributes = parseAttributeList(line.slice('#EXT-X-MEDIA:'.length))
      if (attributes.TYPE?.toUpperCase() !== 'SUBTITLES' || !attributes.URI)
        continue

      subtitleRenditions.push({
        groupId: attributes['GROUP-ID'] ?? '',
        name: attributes.NAME ?? attributes.LANGUAGE ?? '',
        language: attributes.LANGUAGE ?? '',
        uri: resolveHlsUrl(baseUrl, attributes.URI),
        isDefault: attributes.DEFAULT?.toUpperCase() === 'YES',
        forced: attributes.FORCED?.toUpperCase() === 'YES',
      })
      continue
    }

    if (!line.startsWith('#') && pendingVariant) {
      variants.push({ uri: resolveHlsUrl(baseUrl, line), ...pendingVariant })
      pendingVariant = undefined
    }
  }

  return { variants, subtitleRenditions }
}

/**
 * Subtitle renditions are delivered as media playlists whose entries are `.vtt`
 * segments. `start` is the cumulative timeline position so a segment that stored local
 * (zero-based) timestamps can still be placed on the media clock.
 */
export function parseHlsMediaPlaylist(text: string, baseUrl: string): HlsMediaPlaylist {
  const lines = readTagLines(text)
  const segments: HlsMediaSegment[] = []
  let targetDuration = 0
  let mediaSequence = 0
  let endList = false
  let timestampOffset = 0
  let pendingDuration: number | undefined
  let cursor = 0

  for (const line of lines) {
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      const value = Number(line.slice('#EXT-X-TARGETDURATION:'.length))
      if (Number.isFinite(value))
        targetDuration = value
      continue
    }

    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      const value = Number(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length))
      if (Number.isFinite(value))
        mediaSequence = value
      continue
    }

    if (line === '#EXT-X-ENDLIST') {
      endList = true
      continue
    }

    if (line.startsWith('#EXT-X-TIMESTAMP-MAP=')) {
      for (const part of line.slice('#EXT-X-TIMESTAMP-MAP='.length).split(',')) {
        const separator = part.indexOf(':')
        if (separator < 0)
          continue

        const key = part.slice(0, separator).trim().toUpperCase()
        const value = part.slice(separator + 1).trim()
        if (key === 'MPEGTS')
          timestampOffset += (Number(value) || 0) / 90_000
        else if (key === 'LOCAL')
          timestampOffset -= parsePlaylistTime(value)
      }
      continue
    }

    if (line.startsWith('#EXTINF:')) {
      const value = Number(line.slice('#EXTINF:'.length).split(',')[0])
      pendingDuration = Number.isFinite(value) ? value : undefined
      continue
    }

    if (!line.startsWith('#') && pendingDuration !== undefined) {
      segments.push({ url: resolveHlsUrl(baseUrl, line), duration: pendingDuration, start: cursor })
      cursor += pendingDuration
      pendingDuration = undefined
    }
  }

  return { targetDuration, mediaSequence, endList, timestampOffset, segments }
}

/** `00:00:00.000` on the `LOCAL` side of a timestamp map. */
function parsePlaylistTime(value: string): number {
  const parts = value.split(':')
  if (parts.length < 2)
    return Number(value) || 0

  const seconds = Number(parts.pop()) || 0
  const minutes = Number(parts.pop()) || 0
  const hours = parts.length ? Number(parts[0]) || 0 : 0
  return hours * 3600 + minutes * 60 + seconds
}
