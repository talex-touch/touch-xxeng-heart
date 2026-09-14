import { isRecord } from '../providers/protocol'
import { sendRuntimeMessage } from '../runtimeMessaging'
import { normalizeSubtitleCues } from './webvtt'
import {
  isYoutubeVideoPage,
  readYoutubeCaptionBridgeResponse,
  youtubeCaptionBridgeChannel,
  youtubeCaptionBridgeVersion,
  youtubeVideoIdFromUrl,
} from './youtubeBridge'
import type { SubtitleCue, SubtitleProvider } from './types'
import type { YoutubeCaptionBridgeRequest, YoutubeCaptionTrackList } from './youtubeBridge'

const bridgeTimeoutMs = 1500
const resolvedTrackCacheMs = 5 * 60 * 1000
const declinedTrackCacheMs = 5000
const maxYoutubeCaptionCues = 20_000
const maxYoutubeCueTextLength = 1000

type YoutubeCaptionFetchResponse = { ok: true, text: string } | { ok: false, error: string }

function requestId() {
  if (typeof crypto.randomUUID === 'function')
    return `lexi-${crypto.randomUUID()}`

  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return `lexi-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export function parseYoutubeJson3(text: string): SubtitleCue[] {
  let payload: unknown
  try {
    payload = JSON.parse(text) as unknown
  }
  catch {
    return []
  }
  if (!isRecord(payload) || !Array.isArray(payload.events))
    return []

  const parsed: Array<{ start: number, duration?: number, text: string }> = []
  for (const event of payload.events.slice(0, maxYoutubeCaptionCues)) {
    if (!isRecord(event) || !Array.isArray(event.segs))
      continue

    const startMs = typeof event.tStartMs === 'number' ? event.tStartMs : Number(event.tStartMs)
    const durationMs = typeof event.dDurationMs === 'number' ? event.dDurationMs : Number(event.dDurationMs)
    const cueText = event.segs
      .flatMap((segment): string[] => isRecord(segment) && typeof segment.utf8 === 'string' ? [segment.utf8] : [])
      .join('')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxYoutubeCueTextLength)
    if (!Number.isFinite(startMs) || startMs < 0 || !cueText)
      continue

    parsed.push({
      start: startMs / 1000,
      duration: Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : undefined,
      text: cueText,
    })
  }

  return normalizeSubtitleCues(parsed.map((cue, index) => {
    const nextStart = parsed[index + 1]?.start
    const end = cue.duration
      ? cue.start + cue.duration
      : nextStart && nextStart > cue.start
        ? nextStart
        : cue.start + 2
    return { start: cue.start, end, text: cue.text }
  }))
}

async function requestTrackList(url: URL, signal?: AbortSignal): Promise<YoutubeCaptionTrackList | undefined> {
  const expectedVideoId = youtubeVideoIdFromUrl(url)
  if (!expectedVideoId || signal?.aborted)
    return undefined

  const id = requestId()
  const request: YoutubeCaptionBridgeRequest = {
    channel: youtubeCaptionBridgeChannel,
    version: youtubeCaptionBridgeVersion,
    type: 'request-tracklist',
    requestId: id,
  }

  // The extension supports Chrome 114, before Promise.withResolvers shipped.
  return new Promise<YoutubeCaptionTrackList | undefined>((resolve) => {
    let settled = false
    let timer: number | undefined
    let onMessage: (event: MessageEvent) => void
    let onAbort: () => void
    const finish = (result?: YoutubeCaptionTrackList) => {
      if (settled)
        return
      settled = true
      if (timer !== undefined)
        window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }
    onAbort = () => finish()
    onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== url.origin)
        return

      const response = readYoutubeCaptionBridgeResponse(event.data, id, expectedVideoId)
      if (response)
        finish({ videoId: response.videoId, tracks: response.tracks })
    }
    timer = window.setTimeout(() => finish(), bridgeTimeoutMs)
    window.addEventListener('message', onMessage)
    signal?.addEventListener('abort', onAbort, { once: true })
    window.postMessage(request, url.origin)
  })
}

async function loadCaptionTrack(baseUrl: string, signal?: AbortSignal) {
  const response = await sendRuntimeMessage<YoutubeCaptionFetchResponse, { url: string }>(
    'lexi-fetch-youtube-caption-track',
    { url: baseUrl },
  )
  if (signal?.aborted || !response?.ok)
    return []
  return parseYoutubeJson3(response.text)
}

export interface YoutubeSubtitleProviderConfig {
  getMedia: () => HTMLVideoElement | undefined
}

export function createYoutubeSubtitleProvider(config: YoutubeSubtitleProviderConfig): SubtitleProvider {
  let cached: { pageUrl: string, expiresAt: number, trackList?: YoutubeCaptionTrackList } | undefined

  return {
    id: 'youtube-captions',
    label: 'YouTube 字幕',
    priority: 20,
    billable: false,
    match: isYoutubeVideoPage,
    resolve: async (url, signal) => {
      const media = config.getMedia()
      if (!media || signal?.aborted)
        return undefined

      const cacheHit = cached?.pageUrl === url.href && cached.expiresAt > Date.now()
      if (!cacheHit) {
        const nextTrackList = await requestTrackList(url, signal)
        cached = {
          pageUrl: url.href,
          expiresAt: Date.now() + (nextTrackList ? resolvedTrackCacheMs : declinedTrackCacheMs),
          trackList: nextTrackList,
        }
      }
      const trackList = cached?.trackList
      if (!trackList?.tracks.length || signal?.aborted)
        return undefined

      return {
        mediaId: `youtube:${trackList.videoId}`,
        media,
        listTracks: async currentSignal => currentSignal?.aborted
          ? []
          : trackList.tracks.map(track => ({
            language: track.languageCode,
            label: track.label,
            kind: track.kind,
            load: options => loadCaptionTrack(track.baseUrl, options?.signal),
          })),
      }
    },
  }
}
