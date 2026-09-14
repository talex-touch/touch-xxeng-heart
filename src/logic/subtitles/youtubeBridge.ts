import { isRecord } from '../providers/protocol'

export const youtubeCaptionBridgeChannel = 'lexi-youtube-caption-bridge'
export const youtubeCaptionBridgeVersion = 1
export const maxYoutubeCaptionTracks = 32

export interface YoutubeCaptionTrackDescriptor {
  baseUrl: string
  languageCode: string
  label: string
  kind: 'native' | 'auto'
}

export interface YoutubeCaptionTrackList {
  videoId: string
  tracks: YoutubeCaptionTrackDescriptor[]
}

export interface YoutubeCaptionBridgeRequest {
  channel: typeof youtubeCaptionBridgeChannel
  version: typeof youtubeCaptionBridgeVersion
  type: 'request-tracklist'
  requestId: string
}

export interface YoutubeCaptionBridgeResponse extends YoutubeCaptionTrackList {
  channel: typeof youtubeCaptionBridgeChannel
  version: typeof youtubeCaptionBridgeVersion
  type: 'tracklist'
  requestId: string
}

export function isYoutubeVideoPage(url: string | URL) {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : url
    if (parsed.protocol !== 'https:' || (parsed.hostname !== 'youtube.com' && !parsed.hostname.endsWith('.youtube.com')))
      return false

    return (parsed.pathname === '/watch' && /^[\w-]{6,20}$/.test(parsed.searchParams.get('v') ?? ''))
      || /^\/(?:shorts|live)\/[\w-]{6,20}(?:\/|$)/.test(parsed.pathname)
  }
  catch {
    return false
  }
}

export function youtubeVideoIdFromUrl(url: string | URL) {
  if (!isYoutubeVideoPage(url))
    return undefined

  const parsed = typeof url === 'string' ? new URL(url) : url
  if (parsed.pathname === '/watch')
    return parsed.searchParams.get('v') ?? undefined
  return parsed.pathname.split('/').filter(Boolean)[1]
}

export function isAllowedYoutubeCaptionUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && (url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com')
      && url.pathname === '/api/timedtext'
      && /^[\w-]{6,20}$/.test(url.searchParams.get('v') ?? '')
  }
  catch {
    return false
  }
}

function readTrack(value: unknown): YoutubeCaptionTrackDescriptor | undefined {
  if (!isRecord(value))
    return undefined

  const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl.trim() : ''
  const languageCode = typeof value.languageCode === 'string' ? value.languageCode.trim() : ''
  const label = typeof value.label === 'string' ? value.label.trim() : ''
  const kind = value.kind === 'auto' ? 'auto' : value.kind === 'native' ? 'native' : undefined
  if (!baseUrl || baseUrl.length > 8192 || !isAllowedYoutubeCaptionUrl(baseUrl))
    return undefined
  if (!/^[\w-]{2,35}$/.test(languageCode) || !label || label.length > 120 || !kind)
    return undefined

  return { baseUrl, languageCode, label, kind }
}

export function readYoutubeCaptionBridgeResponse(
  value: unknown,
  expectedRequestId: string,
  expectedVideoId?: string,
): YoutubeCaptionBridgeResponse | undefined {
  if (!isRecord(value)
    || value.channel !== youtubeCaptionBridgeChannel
    || value.version !== youtubeCaptionBridgeVersion
    || value.type !== 'tracklist'
    || value.requestId !== expectedRequestId
    || typeof value.videoId !== 'string'
    || !/^[\w-]{6,20}$/.test(value.videoId)
    || (expectedVideoId && value.videoId !== expectedVideoId)
    || !Array.isArray(value.tracks)) {
    return undefined
  }

  const tracks = value.tracks
    .slice(0, maxYoutubeCaptionTracks)
    .flatMap((track): YoutubeCaptionTrackDescriptor[] => {
      const parsed = readTrack(track)
      return parsed ? [parsed] : []
    })
  if (!tracks.length)
    return undefined

  return {
    channel: youtubeCaptionBridgeChannel,
    version: youtubeCaptionBridgeVersion,
    type: 'tracklist',
    requestId: expectedRequestId,
    videoId: value.videoId,
    tracks,
  }
}
