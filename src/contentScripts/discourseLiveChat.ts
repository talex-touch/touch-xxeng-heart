/**
 * Bilingual support for Discourse Livestream / Chat.
 *
 * A livestream topic is not a thread of posts — it is a channel whose messages stream in
 * continuously, get edited, deleted and recycled by core Chat. Reusing the page-translation
 * collector here was never an option: it hashes whole block text into `pageTranslations`,
 * requires 24+ characters and rebuilds on every scroll, which on a chat would both re-pay
 * for the same message and collide translations across virtualised nodes.
 *
 * So this adapter owns one job: watch the chat roots, and for each *persisted, visible,
 * English* message mount a projected translation next to it. Everything downstream of the
 * decision — provider, engines, quotas, batching envelope — is the shared page-translation
 * path (`requestPageTranslationBatch`); this module adds no second translation engine and
 * no MessageBus/API access.
 *
 * Identity is `channel + message id + source hash + target language`, so a recycled DOM
 * node re-attaches its own translation and a real edit re-translates exactly once.
 */

import { ensurePageStyles } from './pageEnhancerStyles'
import { isExtensionContextInvalidated } from '~/contentScripts/extensionContext'
import { startRouteWatcher } from '~/contentScripts/ui/routeWatcher'
import { requestPageTranslationBatch } from '~/logic/aiClient'
import { blockIsTranslationTarget } from '~/logic/pageTranslationLanguage'
import { getStoredState } from '~/logic/settingsCache'
import { discourseChatTranslationsStorageKey } from '~/logic/storageKeys'
import { readJsonValue } from '~/logic/storageJson'
import { normalizeText, simpleHash } from '~/logic/text'
import type { LexiSettings } from '~/logic/types'

/** Roots a Discourse livestream or core Chat channel renders messages into. */
const chatRootSelector = [
  '#custom-chat-container',
  '.chat-channel',
  '.chat-channel-panel',
  '.full-page-chat',
  '.chat-drawer',
  '.chat-messages-scroller',
  '[data-chat-channel-id]',
].join(',')
const chatMessageSelector = '.chat-message-container[data-id]'
const chatMessageBodySelector = '.chat-message-text'
const chatTranslationAttribute = 'data-lexi-chat-translation'
/** The reader-facing marker the styling and teardown both key off. */
const chatTranslationClassName = 'lexi-chat-translation'

const chatTargetLanguage = 'zh'
/** The adapter only ever runs for the fixed English → Chinese direction it is gated on. */
const chatTranslationDirection = 'en-to-zh' as const

/** A message must stay on screen this long before it is worth a request. */
const chatVisibilityDebounceMs = 180
const chatBatchSize = 6
/** Scan/admission ceiling: a chat can hold thousands of nodes, none of which we may pre-pay. */
const maxPendingChatMessages = 24
const maxChatScanMessages = 400
const maxChatCacheEntries = 240
/** A failed message is not retried until this passes; without it a dead provider loops. */
const chatFailureCooldownMs = 60_000
const chatMutationDelayMs = 400
const chatNavigationDelayMs = 700

// Core Chat marks these states as modifier classes; older builds and the livestream
// connector have shipped both the single- and double-hyphen form, so both are matched.
const deletedChatMessageSelector = '[data-deleted], [data-deleted-at], .-deleted, .--deleted, .chat-message--deleted'
const hiddenChatMessageSelector = '[data-hidden="true"], .-hidden, .--hidden, .chat-message--hidden'
const streamingChatMessageSelector = '[data-streaming="true"], .-streaming, .--streaming, .chat-message--streaming'
const stagedChatMessageSelector = '[data-staged="true"], .-staged, .--staged'
const persistedChatMessageIdPattern = /^\d+$/

type ChatMessageState = 'translatable' | 'deleted' | 'hidden' | 'streaming' | 'staged'

interface ChatMessageView {
  channelId: string
  messageId: string
  body: HTMLElement
  source: string
  hash: string
}

interface ChatTranslationCacheEntry {
  /** channel + message id + source hash + target language: the full revision identity. */
  identity: string
  channelId: string
  messageId: string
  targetLanguage: string
  sourceHash: string
  translation: string
  updatedAt: number
}

function chatCacheLookupKey(channelId: string, messageId: string, targetLanguage: string) {
  return `${channelId}::${messageId}::${targetLanguage}`
}

function isChatCacheEntry(value: unknown): value is ChatTranslationCacheEntry {
  if (!value || typeof value !== 'object')
    return false

  const entry = value as Partial<Record<keyof ChatTranslationCacheEntry, unknown>>
  return typeof entry.identity === 'string'
    && typeof entry.channelId === 'string'
    && typeof entry.messageId === 'string'
    && typeof entry.targetLanguage === 'string'
    && typeof entry.sourceHash === 'string'
    && typeof entry.translation === 'string'
    && typeof entry.updatedAt === 'number'
}

function loadChatCache() {
  const cache = new Map<string, ChatTranslationCacheEntry>()
  try {
    const parsed = readJsonValue<unknown>(sessionStorage.getItem(discourseChatTranslationsStorageKey), undefined)
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (isChatCacheEntry(item))
          cache.set(chatCacheLookupKey(item.channelId, item.messageId, item.targetLanguage), item)
      }
    }
  }
  catch {
    // sessionStorage can be unavailable (private mode, blocked storage); the in-memory
    // mirror still serves this document.
  }

  return cache
}

/** Persisted non-deleted, non-hidden, non-streaming, non-staged chat messages only. */
function chatMessageState(container: Element): ChatMessageState {
  if (container.matches(deletedChatMessageSelector) || container.querySelector(deletedChatMessageSelector))
    return 'deleted'
  if (container.matches(hiddenChatMessageSelector) || container.querySelector(hiddenChatMessageSelector))
    return 'hidden'
  if (container.matches(streamingChatMessageSelector) || container.querySelector(streamingChatMessageSelector))
    return 'streaming'

  const messageId = container.getAttribute('data-id')?.trim() ?? ''
  if (!persistedChatMessageIdPattern.test(messageId) || Number(messageId) <= 0)
    return 'staged'
  if (container.matches(stagedChatMessageSelector) || container.querySelector(stagedChatMessageSelector))
    return 'staged'

  return 'translatable'
}

/**
 * Core Chat tags the channel on an ancestor; the livestream connector only gives the root
 * an id. Falling back to the pathname keeps two channels on one page from sharing a cache.
 */
function chatChannelId(container: Element) {
  const scoped = container.closest('[data-chat-channel-id]')?.getAttribute('data-chat-channel-id')?.trim()
  if (scoped)
    return scoped

  const root = container.closest(chatRootSelector)
  if (root instanceof HTMLElement) {
    const rooted = root.getAttribute('data-chat-channel-id')?.trim() || root.id.trim()
    if (rooted)
      return rooted
  }

  return normalizeText(location.pathname) || '/'
}

function chatSourceHash(body: HTMLElement) {
  return simpleHash(normalizeText(body.textContent))
}

function readChatMessage(container: Element): ChatMessageView | undefined {
  const messageId = container.getAttribute('data-id')?.trim() ?? ''
  if (!messageId || chatMessageState(container) !== 'translatable')
    return undefined

  const body = container.querySelector<HTMLElement>(chatMessageBodySelector)
  if (!body)
    return undefined

  const source = normalizeText(body.textContent)
  // Chat is full of "666", emoji and bare links; there is nothing there to translate and
  // each one would still cost a batch slot.
  if (!source || !/[a-z]/i.test(source))
    return undefined
  if (blockIsTranslationTarget(source, chatTargetLanguage))
    return undefined

  return {
    channelId: chatChannelId(container),
    messageId,
    body,
    source,
    hash: chatSourceHash(body),
  }
}

function findChatTranslation(body: HTMLElement) {
  const sibling = body.nextElementSibling
  if (sibling instanceof HTMLElement && sibling.hasAttribute(chatTranslationAttribute))
    return sibling

  return body.closest(chatMessageSelector)?.querySelector<HTMLElement>(`[${chatTranslationAttribute}]`) ?? undefined
}

function removeChatTranslation(body: HTMLElement) {
  findChatTranslation(body)?.remove()
}

function removeChatTranslationForContainer(container: Element) {
  const body = container.querySelector<HTMLElement>(chatMessageBodySelector)
  if (body)
    removeChatTranslation(body)
}

/**
 * The message node may have been recycled or replaced between the request and its reply.
 * This re-resolves the *identity*, never the element we captured, so a translation lands
 * on the message it belongs to — or waits in the cache until that message returns.
 */
function resolveChatBody(view: ChatMessageView) {
  if (view.body.isConnected) {
    const container = view.body.closest(chatMessageSelector)
    if (container
      && container.getAttribute('data-id')?.trim() === view.messageId
      && chatChannelId(container) === view.channelId
      && chatSourceHash(view.body) === view.hash) {
      return view.body
    }
  }

  for (const container of Array.from(document.querySelectorAll<HTMLElement>(chatMessageSelector))) {
    if (container.getAttribute('data-id')?.trim() !== view.messageId)
      continue
    if (chatChannelId(container) !== view.channelId || chatMessageState(container) !== 'translatable')
      continue

    const body = container.querySelector<HTMLElement>(chatMessageBodySelector)
    // The container may already carry an edit; a translation for the old revision must
    // never land on it, not even for one frame.
    if (body && chatSourceHash(body) === view.hash)
      return body
  }

  return undefined
}

/**
 * Just before a request goes out, the message must still be the same live, persisted
 * message it was when it was admitted — chat can delete, hide or recycle it in the
 * debounce window, and translating a node that is gone is pure waste.
 */
function isChatViewStillEligible(view: ChatMessageView) {
  if (!view.body.isConnected)
    return false

  const container = view.body.closest(chatMessageSelector)
  if (!container)
    return false

  return container.getAttribute('data-id')?.trim() === view.messageId
    && chatMessageState(container) === 'translatable'
    && chatSourceHash(view.body) === view.hash
}

function attachChatTranslation(view: ChatMessageView, translation: string) {
  const body = resolveChatBody(view)
  if (!body)
    return

  const existing = findChatTranslation(body)
  const node = existing ?? document.createElement('div')
  node.setAttribute(chatTranslationAttribute, 'true')
  node.setAttribute(`${chatTranslationAttribute}-id`, `${view.channelId}:${view.messageId}`)
  node.className = chatTranslationClassName
  if (node.textContent !== translation)
    node.textContent = translation
  if (!existing || existing.previousElementSibling !== body)
    body.insertAdjacentElement('afterend', node)
}

/**
 * Whether this adapter should run on the current page at all.
 *
 * It follows the existing Discourse page-translation setting rather than inventing one:
 * the reader asked for English → Chinese prose on Discourse, and a livestream channel is
 * that prose arriving live. A different direction, a disabled selection feature, or a
 * different platform leaves the page untouched.
 */
function chatTranslationEnabled(settings: LexiSettings) {
  const pageTranslation = settings.selection.pageTranslation
  return settings.selection.enabled
    && pageTranslation.direction === chatTranslationDirection
    && pageTranslation.autoSites.discourse === true
}

function chatRootsPresent() {
  return Boolean(document.querySelector(chatRootSelector))
}

export function startDiscourseLiveChat(): () => void {
  if (window.top !== window)
    return () => {}

  let disposed = false
  let active = false
  let settings: LexiSettings | undefined
  let stopWatcher: (() => void) | undefined
  let observer: IntersectionObserver | undefined
  let drainTimer: number | undefined
  let drainRunning = false
  let requestController: AbortController | undefined

  const cache = loadChatCache()
  /** Current revision per channel+message, rebuilt on every sync. */
  const views = new Map<string, ChatMessageView>()
  const observedByKey = new Map<string, HTMLElement>()
  const keyByElement = new Map<HTMLElement, string>()
  const visibleKeys = new Set<string>()
  const pending = new Map<string, ChatMessageView>()
  /** channel+message → source hash currently being requested. One request per revision. */
  const inFlight = new Map<string, string>()
  const failures = new Map<string, number>()
  const visibilityTimers = new Map<string, number>()

  const keyOf = (view: ChatMessageView) => chatCacheLookupKey(view.channelId, view.messageId, chatTargetLanguage)
  const requestIdOf = (view: ChatMessageView) => `${view.channelId}:${view.messageId}`
  // Cooldown follows the revision, not the message: an edit is new work and may be tried
  // immediately, while the exact revision that failed stays parked for the full window.
  const revisionKeyOf = (view: ChatMessageView) => `${keyOf(view)}::${view.hash}`

  function markChatFailure(view: ChatMessageView) {
    failures.set(revisionKeyOf(view), Date.now() + chatFailureCooldownMs)
  }

  function isCoolingDown(key: string) {
    const until = failures.get(key)
    if (until === undefined)
      return false
    if (until <= Date.now()) {
      failures.delete(key)
      return false
    }

    return true
  }

  function flushChatCache() {
    const entries = [...cache.values()].sort((a, b) => b.updatedAt - a.updatedAt)
    const kept = entries.slice(0, maxChatCacheEntries)
    if (kept.length !== entries.length) {
      cache.clear()
      for (const entry of kept)
        cache.set(chatCacheLookupKey(entry.channelId, entry.messageId, entry.targetLanguage), entry)
    }

    try {
      sessionStorage.setItem(discourseChatTranslationsStorageKey, JSON.stringify(kept))
    }
    catch {
      // Storage unavailable; the in-memory mirror still holds this session's translations.
    }
  }

  function cacheChatTranslation(view: ChatMessageView, translation: string) {
    cache.set(keyOf(view), {
      // channel + message id + source hash + target language: the full revision identity.
      identity: `${keyOf(view)}::${view.hash}`,
      channelId: view.channelId,
      messageId: view.messageId,
      targetLanguage: chatTargetLanguage,
      sourceHash: view.hash,
      translation,
      updatedAt: Date.now(),
    })
  }

  function enqueue(view: ChatMessageView) {
    const key = keyOf(view)
    const cached = cache.get(key)
    if (cached?.sourceHash === view.hash || inFlight.has(key) || isCoolingDown(revisionKeyOf(view)))
      return false
    if (!pending.has(key) && pending.size >= maxPendingChatMessages)
      return false

    pending.set(key, view)
    return true
  }

  /** Re-admit everything currently on screen; the bound defers work, it never cancels it. */
  function fillPendingFromVisible() {
    for (const key of visibleKeys) {
      const view = views.get(key)
      if (view)
        enqueue(view)
    }
  }

  function scheduleDrain() {
    if (drainTimer != null || drainRunning || disposed || !active)
      return

    drainTimer = window.setTimeout(() => {
      drainTimer = undefined
      void drain()
    }, 0)
  }

  function buildChatContext(batch: ChatMessageView[]) {
    const channel = batch[0]?.channelId ?? ''
    const samples = batch.slice(0, 3).map(view => view.source).join('\n')
    return normalizeText(`Discourse live chat ${channel} ${document.title} ${samples}`).slice(0, 600)
  }

  async function drain() {
    if (disposed || !active || drainRunning || !settings)
      return

    const batch: ChatMessageView[] = []
    for (const [key, view] of pending) {
      if (batch.length >= chatBatchSize)
        break
      pending.delete(key)
      if (isChatViewStillEligible(view))
        batch.push(view)
    }
    if (!batch.length)
      return

    drainRunning = true
    const currentSettings = settings
    const controller = new AbortController()
    requestController = controller
    batch.forEach(view => inFlight.set(keyOf(view), view.hash))

    try {
      const results = await requestPageTranslationBatch(
        currentSettings,
        batch.map(view => ({ id: requestIdOf(view), text: view.source })),
        buildChatContext(batch),
        controller.signal,
        chatTranslationDirection,
      )
      const byId = new Map(results.map(item => [item.id, item.translation]))

      for (const view of batch) {
        if (disposed || !active || controller.signal.aborted)
          break

        const translation = byId.get(requestIdOf(view))?.trim()
        if (!translation) {
          // The provider answered but skipped this revision: terminal until the cooldown.
          markChatFailure(view)
          continue
        }

        failures.delete(revisionKeyOf(view))
        cacheChatTranslation(view, translation)
        attachChatTranslation(view, translation)
      }
    }
    catch (error) {
      // An abort is the adapter shutting down, not the provider failing: cooling those
      // messages down would punish them for a settings toggle.
      if (!controller.signal.aborted && !disposed)
        batch.forEach(view => markChatFailure(view))
      if (isExtensionContextInvalidated(error))
        dispose()
      else if (!controller.signal.aborted)
        console.warn('[Lexi] Discourse chat translation failed', error)
    }
    finally {
      drainRunning = false
      if (requestController === controller)
        requestController = undefined

      batch.forEach((view) => {
        const key = keyOf(view)
        if (inFlight.get(key) === view.hash)
          inFlight.delete(key)
      })

      if (!disposed && active) {
        flushChatCache()
        // A revision that changed under an in-flight request, and messages deferred by the
        // pending bound, both catch up on the next pass.
        fillPendingFromVisible()
        scheduleDrain()
      }
    }
  }

  function clearVisibility(key: string, element?: HTMLElement) {
    const timer = visibilityTimers.get(key)
    if (timer != null) {
      window.clearTimeout(timer)
      visibilityTimers.delete(key)
    }
    visibleKeys.delete(key)
    pending.delete(key)
    if (element)
      keyByElement.delete(element)
  }

  function isElementVisible(element: HTMLElement) {
    // With an observer, intersection is the authority: jsdom reports zero rects and a
    // rect check would refuse to translate anything in tests.
    if (observer)
      return true

    const rect = element.getBoundingClientRect()
    const viewportWidth = window.innerWidth || 0
    const viewportHeight = window.innerHeight || 0
    if (rect.width === 0 && rect.height === 0)
      return false

    return rect.bottom > 0 && rect.top < viewportHeight && rect.right > 0 && rect.left < viewportWidth
  }

  function scheduleVisibility(key: string, element: HTMLElement) {
    const timer = visibilityTimers.get(key)
    if (timer != null)
      window.clearTimeout(timer)

    visibilityTimers.set(key, window.setTimeout(() => {
      visibilityTimers.delete(key)
      if (disposed || !active || !element.isConnected)
        return

      const view = views.get(key)
      if (!view || view.body !== element || !isElementVisible(element))
        return

      visibleKeys.add(key)
      if (enqueue(view))
        scheduleDrain()
    }, chatVisibilityDebounceMs))
  }

  function onIntersect(entries: IntersectionObserverEntry[]) {
    if (disposed || !active)
      return

    for (const entry of entries) {
      const element = entry.target
      if (!(element instanceof HTMLElement))
        continue

      const key = keyByElement.get(element)
      if (!key)
        continue

      if (!entry.isIntersecting) {
        clearVisibility(key)
        continue
      }

      scheduleVisibility(key, element)
    }
  }

  function ensureObserver() {
    if (observer || typeof IntersectionObserver !== 'function')
      return observer

    observer = new IntersectionObserver(onIntersect, { root: null, rootMargin: '0px', threshold: 0 })
    return observer
  }

  function syncMessages() {
    const activeObserver = ensureObserver()
    const nextViews = new Map<string, ChatMessageView>()
    let scanned = 0

    for (const root of Array.from(document.querySelectorAll<HTMLElement>(chatRootSelector))) {
      for (const container of Array.from(root.querySelectorAll<HTMLElement>(chatMessageSelector))) {
        if (scanned >= maxChatScanMessages)
          break

        scanned += 1
        const view = readChatMessage(container)
        if (!view) {
          // Deleted, hidden, streaming, staged or already translated: no orphan may stay.
          removeChatTranslationForContainer(container)
          continue
        }

        nextViews.set(keyOf(view), view)
      }

      if (scanned >= maxChatScanMessages)
        break
    }

    for (const key of views.keys()) {
      if (nextViews.has(key))
        continue

      const tracked = observedByKey.get(key)
      if (tracked) {
        activeObserver?.unobserve(tracked)
        observedByKey.delete(key)
        keyByElement.delete(tracked)
      }
      clearVisibility(key)
    }

    views.clear()
    for (const [key, view] of nextViews)
      views.set(key, view)

    for (const [key, view] of nextViews) {
      const tracked = observedByKey.get(key)
      if (tracked && tracked !== view.body) {
        activeObserver?.unobserve(tracked)
        keyByElement.delete(tracked)
        clearVisibility(key)
      }

      if (tracked !== view.body) {
        observedByKey.set(key, view.body)
        keyByElement.set(view.body, key)
        activeObserver?.observe(view.body)
      }

      const cached = cache.get(key)
      if (cached?.sourceHash === view.hash)
        attachChatTranslation(view, cached.translation)
      else
        removeChatTranslation(view.body)
    }

    // Without IntersectionObserver there is no callback to learn visibility from, so the
    // scan itself is the visibility pass (jsdom rects are zero and admit nothing).
    if (!activeObserver) {
      for (const [key, view] of nextViews) {
        if (isElementVisible(view.body)) {
          visibleKeys.add(key)
          enqueue(view)
        }
        else {
          visibleKeys.delete(key)
        }
      }
    }
  }

  function activate() {
    active = true
    ensureObserver()
  }

  function deactivate() {
    active = false
    requestController?.abort()
    requestController = undefined
    observer?.disconnect()
    observer = undefined

    for (const timer of visibilityTimers.values())
      window.clearTimeout(timer)
    visibilityTimers.clear()
    observedByKey.clear()
    keyByElement.clear()
    views.clear()
    visibleKeys.clear()
    pending.clear()
    document.querySelectorAll(`[${chatTranslationAttribute}]`).forEach(node => node.remove())
    flushChatCache()
  }

  function dispose() {
    if (disposed)
      return

    disposed = true
    window.clearTimeout(drainTimer)
    drainTimer = undefined
    deactivate()
    stopWatcher?.()
  }

  async function refresh() {
    if (disposed)
      return

    const { settings: nextSettings } = await getStoredState()
    if (disposed)
      return

    settings = nextSettings
    // Without a chat root this page is an ordinary topic; leave it alone entirely.
    const enabled = chatTranslationEnabled(nextSettings) && chatRootsPresent()
    if (!enabled) {
      if (active)
        deactivate()
      return
    }

    if (!active)
      activate()

    ensurePageStyles(nextSettings.ui.customCss)
    syncMessages()
    fillPendingFromVisible()
    scheduleDrain()
  }

  const watcher = startRouteWatcher({
    label: 'Discourse Live Chat',
    refresh,
    onDispose: dispose,
    // A Discourse page without a chat root does not pay for chat scans on every mutation;
    // the 1s route poll still notices the container when the livestream mounts it.
    shouldRefreshMutation: chatRootsPresent,
    onVisible: () => {
      void refresh()
    },
    mutationDelayMs: chatMutationDelayMs,
    navigationDelayMs: chatNavigationDelayMs,
  })
  stopWatcher = watcher.stop

  return () => watcher.stop()
}
