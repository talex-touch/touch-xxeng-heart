import { normalizeSubtitleCues } from './webvtt'
import type { SubtitleCue, SubtitleProvider, SubtitleSource, SubtitleTrackHandle } from './types'
import { simpleHash } from '~/logic/text'

const nativeTrackLoadTimeoutMs = 2000
const nativeTrackPollMs = 50

function decodeCueEntities(value: string) {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#39;/g, '\'')
    .replace(/&quot;/gi, '"')
}

function cueText(cue: TextTrackCue) {
  const raw = 'text' in cue && typeof cue.text === 'string' ? cue.text : ''
  return decodeCueEntities(raw.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

function copyTrackCues(track: TextTrack): SubtitleCue[] {
  const cues = track.cues
  if (!cues)
    return []

  const result: SubtitleCue[] = []
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index]
    if (!cue)
      continue

    const text = cueText(cue)
    if (text) {
      result.push({
        start: cue.startTime,
        end: cue.endTime,
        text,
      })
    }
  }

  return normalizeSubtitleCues(result)
}

async function loadNativeTrack(track: TextTrack, signal?: AbortSignal): Promise<SubtitleCue[]> {
  const previousMode = track.mode
  if (track.mode === 'disabled')
    track.mode = 'hidden'

  const startedAt = Date.now()
  try {
    while (!signal?.aborted && Date.now() - startedAt < nativeTrackLoadTimeoutMs) {
      const cues = copyTrackCues(track)
      if (cues.length)
        return cues

      await new Promise<void>(resolve => window.setTimeout(resolve, nativeTrackPollMs))
    }

    return copyTrackCues(track)
  }
  finally {
    if (previousMode === 'disabled')
      track.mode = 'disabled'
  }
}

function listNativeTracks(media: HTMLVideoElement): SubtitleTrackHandle[] {
  const tracks: SubtitleTrackHandle[] = []
  for (let index = 0; index < media.textTracks.length; index += 1) {
    const track = media.textTracks[index]
    if (!track
      || (track.kind !== 'subtitles' && track.kind !== 'captions')
      || track.label === 'Lexi 双语') {
      continue
    }

    tracks.push({
      language: track.language || 'und',
      label: track.label || track.language || `字幕 ${index + 1}`,
      kind: 'native',
      load: options => loadNativeTrack(track, options?.signal),
    })
  }
  return tracks
}

export interface Html5SubtitleProviderConfig {
  getMedia: () => HTMLVideoElement | undefined
  getMediaId?: (media: HTMLVideoElement, url: URL) => string
}

export function createHtml5SubtitleProvider(config: Html5SubtitleProviderConfig): SubtitleProvider {
  return {
    id: 'html5-track',
    label: 'HTML5 原生字幕',
    priority: 90,
    billable: false,
    match: () => true,
    resolve: async (url): Promise<SubtitleSource | undefined> => {
      const media = config.getMedia()
      if (!media || !media.textTracks.length)
        return undefined

      const tracks = listNativeTracks(media)
      if (!tracks.length)
        return undefined

      return {
        mediaId: config.getMediaId?.(media, url) ?? `html5:${simpleHash(media.currentSrc || media.src || url.href)}`,
        media,
        listTracks: async signal => signal?.aborted ? [] : tracks,
      }
    },
  }
}
