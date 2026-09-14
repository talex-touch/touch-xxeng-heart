import { sendRuntimeMessage } from '../runtimeMessaging'
import type { SubtitleCue, SubtitleProvider, SubtitleTrackKind } from './types'

export interface BilibiliSubtitleTrack {
  language: string
  label: string
  kind: SubtitleTrackKind
  cues: SubtitleCue[]
}

export type BilibiliSubtitleResponse
  = | { ok: true, mediaId: string, tracks: BilibiliSubtitleTrack[] }
  | { ok: false, error: string }

export function isBilibiliVideoPage(url: string | URL) {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : url
    return parsed.protocol === 'https:'
      && (parsed.hostname === 'www.bilibili.com' || parsed.hostname === 'm.bilibili.com')
      && /^\/video\/(?:BV[0-9A-Z]+|av\d+)(?:\/|$)/i.test(parsed.pathname)
  }
  catch {
    return false
  }
}

export interface BilibiliSubtitleProviderConfig {
  getMedia: () => HTMLVideoElement | undefined
}

const resolvedTrackCacheMs = 5 * 60 * 1000
const declinedTrackCacheMs = 15 * 1000

export function createBilibiliSubtitleProvider(config: BilibiliSubtitleProviderConfig): SubtitleProvider {
  let cached: { pageUrl: string, expiresAt: number, response: BilibiliSubtitleResponse } | undefined

  return {
    id: 'bilibili-subtitles',
    label: 'Bilibili 字幕',
    priority: 30,
    billable: false,
    match: isBilibiliVideoPage,
    resolve: async (url, signal) => {
      const media = config.getMedia()
      if (!media || signal?.aborted)
        return undefined

      let response = cached?.pageUrl === url.href && cached.expiresAt > Date.now()
        ? cached.response
        : undefined
      if (!response) {
        response = await sendRuntimeMessage<BilibiliSubtitleResponse, { pageUrl: string }>(
          'lexi-resolve-bilibili-subtitles',
          { pageUrl: url.href },
        )
        cached = {
          pageUrl: url.href,
          expiresAt: Date.now() + (response.ok && response.tracks.length ? resolvedTrackCacheMs : declinedTrackCacheMs),
          response,
        }
      }
      if (!response?.ok || !response.tracks.length || signal?.aborted)
        return undefined

      return {
        mediaId: response.mediaId,
        media,
        listTracks: async currentSignal => currentSignal?.aborted
          ? []
          : response.tracks.map(track => ({
            language: track.language,
            label: track.label,
            kind: track.kind,
            load: async options => options?.signal?.aborted ? [] : track.cues,
          })),
      }
    },
  }
}
