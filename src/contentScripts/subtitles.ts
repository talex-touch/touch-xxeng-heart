import { isExtensionContextInvalidated } from '~/contentScripts/extensionContext'
import { createListenerGroup } from '~/contentScripts/ui/listenerGroup'
import { startRouteWatcher } from '~/contentScripts/ui/routeWatcher'
import { requestPageTranslationBatch } from '~/logic/aiClient'
import { sendRuntimeMessage } from '~/logic/runtimeMessaging'
import { getStoredState } from '~/logic/settingsCache'
import { alignBilingualCues } from '~/logic/subtitles/alignment'
import { createSubtitleCueKey, createSubtitleTranslationCache, hashSubtitleCues } from '~/logic/subtitles/cache'
import type { BilingualSubtitleCue } from '~/logic/subtitles/alignment'
import type { SubtitleCacheIdentity, SubtitleCacheSnapshot, SubtitleTranslationCache } from '~/logic/subtitles/cache'
import { createAppleEventsSubtitleProvider, isAslAppleEventsLink } from '~/logic/subtitles/appleEvents'
import { createBilibiliSubtitleProvider } from '~/logic/subtitles/bilibili'
import { createHtml5SubtitleProvider } from '~/logic/subtitles/html5'
import { resolveHlsUrl } from '~/logic/subtitles/hls'
import { createYoutubeSubtitleProvider } from '~/logic/subtitles/youtube'
import { isAllowedSubtitleResourceUrl } from '~/logic/subtitles/resourcePolicy'
import { resolveSubtitleSource } from '~/logic/subtitles/registry'
import type { ResolvedSubtitleSource } from '~/logic/subtitles/registry'
import type { SubtitleCue, SubtitleProvider, SubtitleTrackHandle } from '~/logic/subtitles/types'
import type { LexiSettings, PageTranslationDirection } from '~/logic/types'

const lexiBilingualTrackLabel = 'Lexi 双语'
const maxPlayerWaitAttempts = 24
const translatedWindowBeforeSeconds = 15
const translatedWindowAfterSeconds = 120
const translatedWindowCueLimit = 36
const retryDeclinedSourceAfterMs = 15_000

type SubtitleResourceResponse = { ok: true, text: string } | { ok: false, error?: string }

export function shouldReleaseSubtitleSession(
  activeMedia: HTMLVideoElement | undefined,
  currentMedia: HTMLVideoElement | undefined,
): boolean {
  return Boolean(activeMedia && (activeMedia !== currentMedia || !activeMedia.isConnected))
}

export interface AttachedBilingualTrack {
  track: TextTrack
  cues: VTTCue[]
  detach: () => void
}

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
    for (const inserted of added)
      track.removeCue(inserted)
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
      for (const inserted of added)
        track.removeCue(inserted)
      added.length = 0
      track.mode = 'disabled'
    },
  }
}

interface ActiveSession {
  media: HTMLVideoElement
  attemptIdentity: string
  detachTrack: () => void
  disposeListeners: () => void
  translatedWindow?: { start: number, end: number }
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

function findVisibleVideo(): HTMLVideoElement | undefined {
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

function baseLanguage(language: string) {
  const normalized = language.toLowerCase().replace(/_/g, '-').replace(/^ai-/, '')
  if (normalized === 'zh' || normalized.startsWith('zh-') || normalized === 'cn')
    return 'zh'
  if (normalized === 'en' || normalized.startsWith('en-'))
    return 'en'
  return normalized.split('-')[0] || 'und'
}
interface SubtitleTranslationPlan {
  source: SubtitleTrackHandle
  translation?: SubtitleTrackHandle
  direction: PageTranslationDirection
}

function preferredTrack(tracks: SubtitleTrackHandle[], language: 'en' | 'zh') {
  return tracks
    .filter(track => baseLanguage(track.language) === language)
    .sort((a, b) => Number(a.kind === 'auto') - Number(b.kind === 'auto'))[0]
}

function translationPlan(tracks: SubtitleTrackHandle[]): SubtitleTranslationPlan | undefined {
  const english = preferredTrack(tracks, 'en')
  const chinese = preferredTrack(tracks, 'zh')
  if (english && chinese)
    return { source: english, translation: chinese, direction: 'en-to-zh' }

  const source = english ?? chinese ?? tracks
    .filter(track => track.kind !== 'asr')
    .sort((a, b) => Number(a.kind === 'auto') - Number(b.kind === 'auto'))[0]
  if (!source)
    return undefined

  return {
    source,
    direction: baseLanguage(source.language) === 'zh' ? 'zh-to-en' : 'en-to-zh',
  }
}

function cuesNearPlayback(media: HTMLVideoElement, cues: SubtitleCue[]) {
  const currentTime = Number.isFinite(media.currentTime) ? media.currentTime : 0
  const start = Math.max(0, currentTime - translatedWindowBeforeSeconds)
  const end = currentTime + translatedWindowAfterSeconds
  const selected = cues
    .filter(cue => cue.end >= start && cue.start <= end)
    .slice(0, translatedWindowCueLimit)
  return { start, end, cues: selected }
}

async function translateSubtitleWindow(
  media: HTMLVideoElement,
  cues: SubtitleCue[],
  settings: LexiSettings,
  direction: PageTranslationDirection,
  signal: AbortSignal,
  cache: SubtitleTranslationCache,
  identity: SubtitleCacheIdentity,
): Promise<{ cues: BilingualSubtitleCue[], start: number, end: number }> {
  const window = cuesNearPlayback(media, cues)
  if (!window.cues.length)
    return { ...window, cues: [] }

  await cache.load()
  const translated = new Map<string, string>()
  const missing: Array<{ id: string, text: string }> = []
  const items = window.cues.map(cue => ({
    id: createSubtitleCueKey(cue),
    text: cue.text,
  }))
  const ttlDays = settings.selection.pageTranslation.cacheDays

  for (const item of items) {
    const cached = cache.lookup(identity, item.id, ttlDays)
    if (cached)
      translated.set(item.id, cached)
    else if (!missing.some(candidate => candidate.id === item.id))
      missing.push(item)
  }

  const batchSize = Math.min(8, Math.max(1, settings.selection.pageTranslation.batchSize))
  const newTranslations: Record<string, string> = {}
  for (let index = 0; index < missing.length; index += batchSize) {
    if (signal.aborted)
      return { ...window, cues: [] }

    const batch = missing.slice(index, index + batchSize)
    const result = await requestPageTranslationBatch(
      settings,
      batch,
      `视频字幕：${document.title}`,
      signal,
      direction,
    )
    for (const item of result) {
      const translation = item.translation.trim()
      if (!translation)
        continue
      translated.set(item.id, translation)
      newTranslations[item.id] = translation
    }
  }

  if (Object.keys(newTranslations).length) {
    cache.merge(identity, newTranslations, ttlDays)
    await cache.flush()
  }

  const bilingual = window.cues.flatMap((cue, index): BilingualSubtitleCue[] => {
    const translation = translated.get(items[index].id)?.trim()
    return translation
      ? [{ start: cue.start, end: cue.end, source: cue.text, translation }]
      : []
  })
  return { ...window, cues: bilingual }
}

export interface SubtitleEnhancerOptions {
  readPageUrl?: () => string
}

function createRuntimeSubtitleCache() {
  return createSubtitleTranslationCache({
    storage: {
      read: () => sendRuntimeMessage<SubtitleCacheSnapshot>('lexi-read-subtitle-cache', undefined),
      write: async (snapshot) => {
        const result = await sendRuntimeMessage<{ ok?: boolean, error?: string }>('lexi-write-subtitle-cache', snapshot)
        if (!result?.ok)
          throw new Error(result?.error || '字幕缓存写入失败')
      },
    },
  })
}

export function startSubtitleEnhancer(options: SubtitleEnhancerOptions = {}): () => void {
  const readPageUrl = options.readPageUrl ?? (() => location.href)
  if (window.top !== window)
    return () => {}

  let active: ActiveSession | undefined
  let activating: Promise<void> | undefined
  let activatingIdentity = ''
  let abortController: AbortController | undefined
  let pendingMasterUrl: string | undefined
  let currentMedia: HTMLVideoElement | undefined
  let pageUrl = readPageUrl()
  let waitAttempts = 0
  let retryTimer: number | undefined
  let stopWatcher: (() => void) | undefined
  let disposed = false
  let declinedIdentity = ''
  let declinedAt = 0
  const listeners = createListenerGroup()
  const subtitleCache = createRuntimeSubtitleCache()

  const providers: SubtitleProvider[] = [
    createAppleEventsSubtitleProvider({
      fetchResource: runtimeSubtitleFetcher,
      getMedia: () => currentMedia,
      getMasterUrl: url => pendingMasterUrl ?? (currentMedia ? masterUrlFromVideo(currentMedia, url.href) : undefined),
    }),
    createYoutubeSubtitleProvider({ getMedia: () => currentMedia }),
    createBilibiliSubtitleProvider({ getMedia: () => currentMedia }),
    createHtml5SubtitleProvider({ getMedia: () => currentMedia }),
  ]

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
    retryTimer = window.setTimeout(() => void sync(), delay)
  }

  async function sync() {
    if (disposed)
      return

    const nextPageUrl = readPageUrl()
    if (nextPageUrl !== pageUrl) {
      pageUrl = nextPageUrl
      pendingMasterUrl = undefined
      declinedIdentity = ''
      stopActive()
    }

    const media = findVisibleVideo()
    if (shouldReleaseSubtitleSession(active?.media, media))
      stopActive()
    currentMedia = media

    if (!media) {
      if (waitAttempts > 0) {
        waitAttempts -= 1
        scheduleSync(500)
      }
      return
    }

    const attemptIdentity = `${pageUrl}|${media.currentSrc || media.src}|${pendingMasterUrl ?? ''}`
    if (active?.media === media && active.media.isConnected && active.attemptIdentity === attemptIdentity)
      return

    if (declinedIdentity === attemptIdentity && Date.now() - declinedAt < retryDeclinedSourceAfterMs)
      return

    if (activating) {
      if (activatingIdentity === attemptIdentity) {
        await activating
        return
      }

      abortController?.abort()
      await activating
      if (disposed)
        return
    }

    await activate(media, new URL(pageUrl), attemptIdentity)
  }

  async function activate(media: HTMLVideoElement, url: URL, attemptIdentity: string) {
    stopActive()
    waitAttempts = 0
    const controller = new AbortController()
    abortController = controller
    activatingIdentity = attemptIdentity

    activating = (async () => {
      const resolved = await resolveSubtitleSource(providers, url, { signal: controller.signal, allowBillable: false })
      if (!resolved || controller.signal.aborted) {
        declinedIdentity = attemptIdentity
        declinedAt = Date.now()
        return
      }

      const tracks = await resolved.source.listTracks(controller.signal)
      const plan = translationPlan(tracks)
      if (!plan || controller.signal.aborted) {
        declinedIdentity = attemptIdentity
        declinedAt = Date.now()
        return
      }

      const result = await loadBilingualResult(resolved, plan, controller.signal, subtitleCache)
      if (!result.cues.length || controller.signal.aborted) {
        declinedIdentity = attemptIdentity
        declinedAt = Date.now()
        return
      }

      const attached = attachBilingualTextTrack(media, result.cues)
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

      const translatedWindow = result.translatedWindow
      if (translatedWindow) {
        const refreshTranslatedWindow = () => {
          const currentTime = media.currentTime
          if (currentTime >= translatedWindow.end - 15 || currentTime < translatedWindow.start) {
            stopActive()
            scheduleSync(0)
          }
        }
        mediaListeners.add(media, 'seeked', refreshTranslatedWindow)
        mediaListeners.add(media, 'timeupdate', refreshTranslatedWindow)
      }

      active = {
        media,
        attemptIdentity,
        detachTrack: attached.detach,
        disposeListeners: mediaListeners.removeAll,
        translatedWindow: result.translatedWindow,
      }
      declinedIdentity = ''
    })()
      .catch((error) => {
        if (!isExtensionContextInvalidated(error))
          console.warn('[Lexi] 字幕加载失败', error)
      })
      .finally(() => {
        activating = undefined
        activatingIdentity = ''
      })

    return activating
  }

  async function loadBilingualResult(
    resolved: ResolvedSubtitleSource,
    plan: SubtitleTranslationPlan,
    signal: AbortSignal,
    cache: SubtitleTranslationCache,
  ): Promise<{ cues: BilingualSubtitleCue[], translatedWindow?: { start: number, end: number } }> {
    const sourceCues = await plan.source.load({ signal })
    if (signal.aborted)
      return { cues: [] }

    if (plan.translation) {
      const translatedCues = await plan.translation.load({ signal })
      return { cues: signal.aborted ? [] : alignBilingualCues(sourceCues, translatedCues) }
    }

    const { settings } = await getStoredState()
    if (!settings.subtitles.autoTranslate)
      return { cues: [] }

    const sourceLang = baseLanguage(plan.source.language)
    const targetLang = plan.direction === 'zh-to-en' ? 'en' : 'zh'
    const identity: SubtitleCacheIdentity = {
      providerId: resolved.provider.id,
      mediaId: resolved.source.mediaId,
      sourceLang,
      targetLang,
      sourceHash: hashSubtitleCues(sourceCues),
    }
    const translated = await translateSubtitleWindow(
      resolved.source.media,
      sourceCues,
      settings,
      plan.direction,
      signal,
      cache,
      identity,
    )
    return {
      cues: translated.cues,
      translatedWindow: { start: translated.start, end: translated.end },
    }
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
    declinedIdentity = ''
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
