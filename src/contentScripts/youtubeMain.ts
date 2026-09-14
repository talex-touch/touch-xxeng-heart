import { isRecord } from '~/logic/providers/protocol'
import {
  isAllowedYoutubeCaptionUrl,
  maxYoutubeCaptionTracks,
  youtubeCaptionBridgeChannel,
  youtubeCaptionBridgeVersion,
  youtubeVideoIdFromUrl,
} from '~/logic/subtitles/youtubeBridge'
import type { YoutubeCaptionBridgeResponse, YoutubeCaptionTrackDescriptor } from '~/logic/subtitles/youtubeBridge'

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
    if (!baseUrl || !isAllowedYoutubeCaptionUrl(baseUrl) || !/^[\w-]{2,35}$/.test(languageCode) || !label)
      return []

    const automatic = item.kind === 'asr'
      || (typeof item.vssId === 'string' && /^(?:a\.|\.a\.)/.test(item.vssId))
    return [{
      baseUrl,
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
