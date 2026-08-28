/**
 * Subtitle sourcing contract.
 *
 * Everything downstream — segmentation, translation, caching, rendering — works against
 * these types and never learns where cues came from. That is what lets speech recognition
 * arrive later as one more provider rather than as a second pipeline: it is simply the
 * lowest-priority provider, and the only one that has to ask before it costs money.
 */

export interface SubtitleCue {
  /** Seconds on the media timeline, aligned to `HTMLMediaElement.currentTime`. */
  start: number
  end: number
  text: string
}

/** How the cues were produced. Surfaced to the reader so machine output reads as such. */
export type SubtitleTrackKind = 'native' | 'auto' | 'asr'

export interface SubtitleLoadOptions {
  signal?: AbortSignal
  /** Cues as they land. A track that transcribes while the video plays needs this. */
  onPartial?: (cues: SubtitleCue[]) => void
  onProgress?: (progress: { capturedMs: number, totalMs?: number, estimatedCostUsd?: number }) => void
}

export interface SubtitleTrackHandle {
  /** BCP-47. */
  language: string
  label: string
  kind: SubtitleTrackKind
  load: (options?: SubtitleLoadOptions) => Promise<SubtitleCue[]>
}

export interface SubtitleSource {
  /** Stable per video — `youtube:dQw4w9WgXcQ`. Forms the cache key. */
  mediaId: string
  media: HTMLVideoElement
  listTracks: (signal?: AbortSignal) => Promise<SubtitleTrackHandle[]>
}

export interface SubtitleProvider {
  id: string
  label: string
  /** Lower wins. Native tracks come first; anything that transcribes comes last. */
  priority: number
  /**
   * Spends real money per use, so the caller must confirm with an estimate before
   * `load()`. Only transcription sets this today.
   */
  billable?: boolean
  /** Cheap and synchronous: no network, no capture. */
  match: (url: URL) => boolean
  /** `undefined` means this provider cannot serve the page; try the next one. */
  resolve: (url: URL, signal?: AbortSignal) => Promise<SubtitleSource | undefined>
}
