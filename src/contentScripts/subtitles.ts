import { isExtensionContextInvalidated } from '~/contentScripts/extensionContext'
import { createListenerGroup } from '~/contentScripts/ui/listenerGroup'
import { startRouteWatcher } from '~/contentScripts/ui/routeWatcher'
import { sendRuntimeMessage } from '~/logic/runtimeMessaging'
import { alignBilingualCues } from '~/logic/subtitles/alignment'
import type { BilingualSubtitleCue } from '~/logic/subtitles/alignment'
import { createAppleEventsSubtitleProvider, isAppleEventsPage, isAslAppleEventsLink } from '~/logic/subtitles/appleEvents'
import { resolveHlsUrl } from '~/logic/subtitles/hls'
import { isAllowedSubtitleResourceUrl } from '~/logic/subtitles/resourcePolicy'

const lexiBilingualTrackLabel = 'Lexi 双语'
/** How many mutation-triggered passes may wait for the modal player before giving up. */
const maxPlayerWaitAttempts = 24

/** Shape of the worker's reply to `lexi-fetch-subtitle-resource` (kept local: no background import). */
type SubtitleResourceResponse = { ok: true, text: string } | { ok: false, error?: string }

/**
 * A Lexi session must release the media element when it is removed or the page swaps in a
 * different player — even when no replacement video is visible yet. Exported so that
 * decision is exercisable without a browser navigation.
 */
export function shouldReleaseSubtitleSession(
  activeMedia: HTMLVideoElement | undefined,
  currentMedia: HTMLVideoElement | undefined,
): boolean {
  return Boolean(activeMedia && (activeMedia !== currentMedia || !activeMedia.isConnected))
}

export interface AttachedBilingualTrack {
  track: TextTrack
  /** Every cue Lexi added, so cleanup removes exactly its own and nothing else. */
  cues: VTTCue[]
  detach: () => void
}

/**
 * The only DOM writer in the subtitle path. It appends one HTML `TextTrack` to the video
 * so the cues survive fullscreen (a DOM overlay would not), and it keeps a handle to the
 * track and every cue it inserted. Detaching disables that track and removes those cues —
 * it never touches tracks the page owns.
 */
export function attachBilingualTextTrack(
  media: HTMLVideoElement,
  cues: BilingualSubtitleCue[],
): AttachedBilingualTrack | undefined {
  const Cue = typeof VTTCue === 'function' ? VTTCue : undefined
  if (!Cue || typeof media.addTextTrack !== 'function' || !cues.length)
    return undefined

  const track = media.addTextTrack('subtitles', lexiBilingualTrackLabel, 'zh-Hans')
  if (typeof track.addCue !== 'function' || typeof track.removeCue !== 'function')
    return undefined

  track.mode = 'showing'

  const added: VTTCue[] = []
  try {
    for (const cue of cues) {
      const text = cue.translation ? `${cue.source}\n${cue.translation}` : cue.source
      const vttCue = new Cue(cue.start, cue.end, text)
      track.addCue(vttCue)
      added.push(vttCue)
    }
  }
  catch {
    // A rejected cue must not leave a half-populated Lexi track behind.
    for (const inserted of added)
      track.removeCue(inserted)
    added.length = 0
    track.mode = 'disabled'
    return undefined
  }

  let detached = false
  return {
    track,
    cues: added,
    detach: () => {
      if (detached)
        return

      detached = true
      for (const cue of added)
        track.removeCue(cue)
      added.length = 0
      track.mode = 'disabled'
    },
  }
}

interface ActiveSession {
  media: HTMLVideoElement
  masterUrl: string
  detachTrack: () => void
  disposeListeners: () => void
}

function isVisibleVideo(video: HTMLVideoElement) {
  if (!video.isConnected)
    return false

  const rect = video.getBoundingClientRect()
  if (rect.width < 32 || rect.height < 32)
    return false

  const style = window.getComputedStyle(video)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

/** The Watch modal creates its player late; the largest visible video is the one it built. */
function findAppleEventsVideo(): HTMLVideoElement | undefined {
  return Array.from(document.querySelectorAll('video'))
    .filter(isVisibleVideo)
    .sort((a, b) => {
      const areaA = a.getBoundingClientRect().width * a.getBoundingClientRect().height
      const areaB = b.getBoundingClientRect().width * b.getBoundingClientRect().height
      return areaB - areaA
    })[0]
}

function masterUrlFromVideo(video: HTMLVideoElement, baseUrl: string): string | undefined {
  const candidates = [
    video.currentSrc,
    video.src,
    video.getAttribute('src') ?? '',
    ...Array.from(video.querySelectorAll('source[src]')).map(source => source.getAttribute('src') ?? ''),
  ]

  for (const candidate of candidates) {
    if (!candidate || !candidate.includes('.m3u8'))
      continue

    const resolved = resolveHlsUrl(baseUrl, candidate)
    if (isAllowedSubtitleResourceUrl(resolved))
      return resolved
  }

  return undefined
}

function runtimeSubtitleFetcher(url: string, options?: { signal?: AbortSignal }): Promise<string> {
  return sendRuntimeMessage<SubtitleResourceResponse>('lexi-fetch-subtitle-resource', { url })
    .then((result) => {
      if (options?.signal?.aborted)
        throw new Error('字幕资源请求已取消')

      if (!result?.ok)
        throw new Error(result?.error ?? '字幕资源获取失败')

      return result.text
    })
}

/**
 * Watches Apple Events pages for the official bilingual track. It only recognises the
 * `films-modal` Watch links (ASL links are excluded), and when both official languages
 * are present it renders them directly — no translation engine is ever invoked here.
 */
export interface SubtitleEnhancerOptions {
  /**
   * Page identity/base-URL source. Defaults to `location.href`; injectable so the real
   * lifecycle can run where the location object cannot be replaced.
   */
  readPageUrl?: () => string
}

export function startSubtitleEnhancer(options: SubtitleEnhancerOptions = {}): () => void {
  const readPageUrl = options.readPageUrl ?? (() => location.href)

  if (window.top !== window || !isAppleEventsPage(readPageUrl()))
    return () => {}

  let active: ActiveSession | undefined
  let activating: Promise<void> | undefined
  let abortController: AbortController | undefined
  let pendingMasterUrl: string | undefined
  let pageUrl = readPageUrl()
  let waitAttempts = 0
  let retryTimer: number | undefined
  let stopWatcher: (() => void) | undefined
  let disposed = false
  const listeners = createListenerGroup()

  const stopActive = () => {
    abortController?.abort()
    abortController = undefined
    if (!active)
      return

    active.disposeListeners()
    active.detachTrack()
    active = undefined
  }

  const teardown = () => {
    if (disposed)
      return

    disposed = true
    stopActive()
    window.clearTimeout(retryTimer)
    retryTimer = undefined
    pendingMasterUrl = undefined
    listeners.removeAll()
    stopWatcher?.()
  }

  const scheduleSync = (delay: number) => {
    window.clearTimeout(retryTimer)
    retryTimer = window.setTimeout(() => {
      void sync()
    }, delay)
  }

  async function sync() {
    if (disposed)
      return

    if (!isAppleEventsPage(readPageUrl())) {
      teardown()
      return
    }

    // A new URL means a different event: the previous cues and captured link no longer apply.
    if (readPageUrl() !== pageUrl) {
      pageUrl = readPageUrl()
      pendingMasterUrl = undefined
      stopActive()
    }

    const media = findAppleEventsVideo()
    // The modal can close (or swap players) with nothing in its place; the Lexi cues and
    // listeners must still go, which the no-media return below would otherwise skip.
    if (shouldReleaseSubtitleSession(active?.media, media))
      stopActive()

    const masterUrl = pendingMasterUrl ?? (media ? masterUrlFromVideo(media, readPageUrl()) : undefined)

    if (!media || !masterUrl) {
      // The player mounts after the click; keep looking for a bounded number of passes.
      if (waitAttempts > 0) {
        waitAttempts -= 1
        scheduleSync(500)
      }
      return
    }

    if (active && active.media === media && active.masterUrl === masterUrl && media.isConnected)
      return

    await activate(media, masterUrl)
  }

  async function activate(media: HTMLVideoElement, masterUrl: string) {
    if (activating)
      return activating

    // Clear any previous Lexi track before starting; the old controller is aborted here,
    // never the new one.
    stopActive()
    waitAttempts = 0
    const controller = new AbortController()
    abortController = controller

    activating = (async () => {
      const provider = createAppleEventsSubtitleProvider({
        fetchResource: runtimeSubtitleFetcher,
        getMedia: () => media,
        getMasterUrl: () => masterUrl,
        mediaId: `apple-events:${masterUrl}`,
      })

      const source = await provider.resolve(new URL(readPageUrl()), controller.signal)
      if (!source || controller.signal.aborted)
        return

      const tracks = await source.listTracks(controller.signal)
      const sourceTrack = tracks.find(track => track.language.toLowerCase().startsWith('en'))
      const translationTrack = tracks.find(track => track.language.toLowerCase().startsWith('zh'))
      if (!sourceTrack || !translationTrack || controller.signal.aborted)
        return

      const [sourceCues, translationCues] = await Promise.all([
        sourceTrack.load({ signal: controller.signal }),
        translationTrack.load({ signal: controller.signal }),
      ])
      if (controller.signal.aborted)
        return

      const attached = attachBilingualTextTrack(media, alignBilingualCues(sourceCues, translationCues))
      if (!attached || controller.signal.aborted)
        return

      const mediaListeners = createListenerGroup()
      const onMediaReset = () => {
        stopActive()
        waitAttempts = maxPlayerWaitAttempts
        scheduleSync(300)
      }
      mediaListeners.add(media, 'emptied', onMediaReset)
      mediaListeners.add(media, 'loadstart', onMediaReset)

      active = {
        media,
        masterUrl,
        detachTrack: attached.detach,
        disposeListeners: mediaListeners.removeAll,
      }
    })()
      .catch((error) => {
        if (!isExtensionContextInvalidated(error))
          console.warn('[Lexi] 字幕加载失败', error)
      })
      .finally(() => {
        activating = undefined
      })

    return activating
  }

  listeners.add(document, 'click', (event) => {
    const target = event.target
    if (!(target instanceof Element))
      return

    const anchor = target.closest('a[films-modal][href]')
    const href = anchor?.getAttribute('href')
    if (!anchor || !href || !href.includes('.m3u8') || isAslAppleEventsLink(anchor))
      return

    const resolved = resolveHlsUrl(readPageUrl(), href)
    if (!isAllowedSubtitleResourceUrl(resolved))
      return

    pendingMasterUrl = resolved
    waitAttempts = maxPlayerWaitAttempts
    scheduleSync(300)
  }, true)

  const watcher = startRouteWatcher({
    label: 'Subtitles',
    refresh: sync,
    onDispose: teardown,
  })
  stopWatcher = watcher.stop

  return () => watcher.stop()
}
