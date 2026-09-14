import { isRecord } from '~/logic/providers/protocol'
import {
  isAllowedYoutubeCaptionUrl,
  maxYoutubeCaptionTracks,
  youtubeCaptionBridgeChannel,
  youtubeCaptionBridgeVersion,
  youtubeVideoIdFromUrl,
} from '~/logic/subtitles/youtubeBridge'
import type { YoutubeCaptionBridgeResponse, YoutubeCaptionTrackDescriptor } from '~/logic/subtitles/youtubeBridge'

/**
 * Caption selectors the player varies per track. Everything else in an authorized request
 * — signature, expiry, client identity and the attestation token — is copied verbatim,
 * because those are what the endpoint actually checks.
 */
const captionSelectorParams = ['lang', 'kind', 'name', 'tlang']

/**
 * The tracklist's own `baseUrl` is unusable on its own: YouTube answers it with HTTP 200
 * and an empty body unless the request also carries the player's attestation token
 * (`pot`), which is minted by YouTube's own runtime and appears in no page data. The token
 * is not forgeable and must not be forged; the only honest source is a request the player
 * already made for this video, which the page performs whenever captions are on.
 *
 * That request is reused as an authorization envelope: its signature covers the video, not
 * the language, so swapping the caption selectors yields any listed track. Verified live —
 * a zh-CN envelope returned 286 English cues, while the raw tracklist URL returned zero
 * bytes for every format.
 */
let authorizedRequest: URL | undefined

function rememberAuthorizedRequest(candidate: string) {
  if (!isAllowedYoutubeCaptionUrl(candidate))
    return

  const url = new URL(candidate)
  // Without the token the request is exactly the one already known to return nothing.
  if (!url.searchParams.get('pot'))
    return

  // A stale envelope names a different video; its signature would not cover this one.
  if (url.searchParams.get('v') !== youtubeVideoIdFromUrl(location.href))
    return

  authorizedRequest = url
}

/** Re-points an authorized request at one listed track, or declines when none is known. */
function authorizeTrackUrl(baseUrl: string) {
  if (!authorizedRequest || !isAllowedYoutubeCaptionUrl(baseUrl))
    return undefined

  const track = new URL(baseUrl)
  if (track.searchParams.get('v') !== authorizedRequest.searchParams.get('v'))
    return undefined

  const authorized = new URL(authorizedRequest.href)
  for (const param of captionSelectorParams) {
    const value = track.searchParams.get(param)
    if (value === null)
      authorized.searchParams.delete(param)
    else
      authorized.searchParams.set(param, value)
  }
  // The worker picks the response format; a stale one here would be overwritten anyway.
  authorized.searchParams.delete('fmt')

  return isAllowedYoutubeCaptionUrl(authorized.href) ? authorized.href : undefined
}

function watchAuthorizedRequests() {
  for (const entry of performance.getEntriesByType('resource'))
    rememberAuthorizedRequest(entry.name)

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        rememberAuthorizedRequest(entry.name)
    }).observe({ type: 'resource', buffered: true })
  }
  catch {
    // Without the observer the initial scan still covers captions enabled before Lexi ran.
  }
}

function readLabel(value: unknown) {
  if (!isRecord(value))
    return ''
  if (typeof value.simpleText === 'string')
    return value.simpleText.trim()
  if (!Array.isArray(value.runs))
    return ''

  return value.runs
    .flatMap((run): string[] => isRecord(run) && typeof run.text === 'string' ? [run.text] : [])
    .join('')
    .trim()
}

function readCaptionTracks(value: unknown): YoutubeCaptionTrackDescriptor[] {
  if (!Array.isArray(value))
    return []

  return value.slice(0, maxYoutubeCaptionTracks).flatMap((item): YoutubeCaptionTrackDescriptor[] => {
    if (!isRecord(item))
      return []

    const baseUrl = typeof item.baseUrl === 'string' ? item.baseUrl.trim() : ''
    const languageCode = typeof item.languageCode === 'string' ? item.languageCode.trim() : ''
    const label = readLabel(item.name) || languageCode
    const authorizedUrl = authorizeTrackUrl(baseUrl)
    if (!authorizedUrl || !/^[\w-]{2,35}$/.test(languageCode) || !label)
      return []

    const automatic = item.kind === 'asr'
      || (typeof item.vssId === 'string' && /^(?:a\.|\.a\.)/.test(item.vssId))
    return [{
      baseUrl: authorizedUrl,
      languageCode,
      label: label.slice(0, 120),
      kind: automatic ? 'auto' : 'native',
    }]
  })
}

function trackListFromPlayerResponse(value: unknown) {
  if (!isRecord(value) || !isRecord(value.captions))
    return undefined
  const renderer = value.captions.playerCaptionsTracklistRenderer
  if (!isRecord(renderer))
    return undefined

  const tracks = readCaptionTracks(renderer.captionTracks)
  if (!tracks.length)
    return undefined

  const details = isRecord(value.videoDetails) ? value.videoDetails : undefined
  const videoId = typeof details?.videoId === 'string' ? details.videoId : youtubeVideoIdFromUrl(location.href)
  return videoId && /^[\w-]{6,20}$/.test(videoId) ? { videoId, tracks } : undefined
}

function readCurrentTrackList() {
  const initial = trackListFromPlayerResponse(Reflect.get(window, 'ytInitialPlayerResponse'))
  if (initial)
    return initial

  const player = document.getElementById('movie_player')
  if (!player)
    return undefined

  const getPlayerResponse = Reflect.get(player, 'getPlayerResponse')
  if (typeof getPlayerResponse === 'function') {
    try {
      const response = trackListFromPlayerResponse(getPlayerResponse.call(player))
      if (response)
        return response
    }
    catch {}
  }

  const getOption = Reflect.get(player, 'getOption')
  if (typeof getOption !== 'function')
    return undefined

  try {
    const trackList = getOption.call(player, 'captions', 'tracklist')
    if (!isRecord(trackList))
      return undefined

    const tracks = readCaptionTracks(trackList.captionTracks)
    const videoId = youtubeVideoIdFromUrl(location.href)
    return tracks.length && videoId ? { videoId, tracks } : undefined
  }
  catch {
    return undefined
  }
}

watchAuthorizedRequests()

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin || !isRecord(event.data))
    return

  const message = event.data
  if (message.channel !== youtubeCaptionBridgeChannel
    || message.version !== youtubeCaptionBridgeVersion
    || message.type !== 'request-tracklist'
    || typeof message.requestId !== 'string'
    || !/^[\w-]{8,80}$/.test(message.requestId)) {
    return
  }

  const trackList = readCurrentTrackList()
  if (!trackList)
    return

  const response: YoutubeCaptionBridgeResponse = {
    channel: youtubeCaptionBridgeChannel,
    version: youtubeCaptionBridgeVersion,
    type: 'tracklist',
    requestId: message.requestId,
    videoId: trackList.videoId,
    tracks: trackList.tracks,
  }
  window.postMessage(response, location.origin)
})
