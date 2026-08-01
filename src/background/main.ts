import browser from 'webextension-polyfill'
import { onMessage } from 'webext-bridge/background'
import { listenRuntimeMessage, sendTabRuntimeMessage } from '~/logic/runtimeMessaging'
import { appendBoundedLog } from '~/logic/analyticsQueue'
import { createSerializedTaskQueue } from '~/logic/asyncQueue'
import { pruneDigestCache } from '~/logic/digestCache'
import { readJsonValue, toStoredJson } from '~/logic/storageJson'
import { aiCallLogsStorageKey, forumDigestStorageKey, githubDigestStorageKey, pageTranslationsStorageKey, pageVisitLogsStorageKey } from '~/logic/storageKeys'
import type { PageTranslationCache } from '~/logic/types'
import type { AnalyticsLogPayload } from '~/logic/analytics'

// only on dev mode
if (import.meta.hot) {
  // @ts-expect-error for background HMR
  import('/@vite/client')
  // load latest content script
  import('./contentScriptHMR')
}

// to toggle the sidepanel with the action button in chromium:
if (!__FIREFOX__) {
  // @ts-expect-error missing types
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error(error))
}

browser.runtime.onInstalled.addListener((): void => {
  // `onInstalled` also fires on update/reload, where the menu id already exists and
  // `create` fails with a duplicate-id error surfaced as an unchecked runtime.lastError.
  browser.contextMenus.removeAll()
    .then(() => {
      browser.contextMenus.create({
        id: 'lexi-translate-selection',
        title: '使用 Lexi 翻译',
        contexts: ['selection'],
      })
    })
    .catch((error: unknown) => console.warn('[Lexi] context menu setup failed', error))
})

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'lexi-translate-selection' || !tab?.id || !info.selectionText)
    return

  sendTabRuntimeMessage(tab.id, 'lexi-context-translate', {
    text: info.selectionText,
    pageUrl: tab.url,
    pageTitle: tab.title,
  }).catch((error: unknown) => console.warn('[Lexi] context translation message failed', error))
})

listenRuntimeMessage<{ url?: unknown, filename?: unknown } | undefined>('lexi-download-media', async (data) => {
  const url = typeof data?.url === 'string' ? data.url : ''
  const filename = typeof data?.filename === 'string' ? data.filename : undefined
  if (!url)
    return { ok: false, error: '缺少媒体 URL' }

  try {
    const id = await browser.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: true,
    })
    return { ok: true, id }
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

type DigestCache = Record<string, { sourceHash: string, updatedAt: number }>

const maxAnalyticsLogs = 80
const analyticsWrite = createSerializedTaskQueue()
const pageTranslationCacheWrite = createSerializedTaskQueue()

function isAnalyticsLogPayload(value: unknown): value is AnalyticsLogPayload {
  if (!value || typeof value !== 'object' || !('kind' in value) || !('item' in value))
    return false

  const payload = value as { kind?: unknown, item?: unknown }
  if (payload.kind !== 'ai' && payload.kind !== 'page')
    return false
  if (!payload.item || typeof payload.item !== 'object')
    return false

  const item = payload.item as { id?: unknown, createdAt?: unknown, scene?: unknown, url?: unknown }
  if (typeof item.id !== 'string' || item.id.length > 160 || !Number.isFinite(item.createdAt))
    return false
  if (payload.kind === 'ai' && typeof item.scene !== 'string')
    return false
  if (payload.kind === 'page' && typeof item.url !== 'string')
    return false

  try {
    return JSON.stringify(payload.item).length <= 32 * 1024
  }
  catch {
    return false
  }
}

listenRuntimeMessage<unknown>('lexi-record-analytics', (payload) => {
  if (!isAnalyticsLogPayload(payload))
    return { ok: false, error: '日志参数无效' }

  return analyticsWrite(async () => {
    const storageKey = payload.kind === 'ai' ? aiCallLogsStorageKey : pageVisitLogsStorageKey
    const stored = await browser.storage.local.get(storageKey)
    const current = readJsonValue<unknown[]>(stored[storageKey], [])
    await browser.storage.local.set({
      [storageKey]: toStoredJson(appendBoundedLog(current, payload.item, maxAnalyticsLogs)),
    })
    return { ok: true }
  })
})

listenRuntimeMessage<{ key?: unknown, cache?: unknown }>('lexi-write-page-translation-cache', (payload) => {
  const key = typeof payload?.key === 'string' ? payload.key : ''
  const incoming = payload?.cache as PageTranslationCache | undefined
  if (!key.startsWith(`${pageTranslationsStorageKey}:`)
    || key.length > 4096
    || !incoming
    || typeof incoming.url !== 'string'
    || !Array.isArray(incoming.blocks)
    || incoming.blocks.length > 300
    || incoming.blocks.some(block => !block || typeof block.id !== 'string' || typeof block.source !== 'string' || typeof block.translation !== 'string')
    || !Number.isFinite(incoming.updatedAt)) {
    return { ok: false, error: '页面翻译缓存参数无效' }
  }

  return pageTranslationCacheWrite(async () => {
    const stored = await browser.storage.local.get(key)
    const current = readJsonValue<PageTranslationCache | undefined>(stored[key], undefined)
    const blocks = new Map<string, PageTranslationCache['blocks'][number]>()
    for (const block of current?.blocks ?? [])
      blocks.set(block.id, block)
    for (const block of incoming.blocks) {
      const previous = blocks.get(block.id)
      if (!previous || (block.updatedAt ?? 0) >= (previous.updatedAt ?? 0))
        blocks.set(block.id, block)
    }

    const newest = !current || incoming.updatedAt >= current.updatedAt ? incoming : current
    const merged: PageTranslationCache = {
      ...newest,
      blocks: [...blocks.values()]
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, 300),
    }
    await browser.storage.local.set({ [key]: JSON.stringify(merged) })
    return { ok: true }
  })
})

const digestStorageKeys = new Set([githubDigestStorageKey, forumDigestStorageKey])
let digestCacheWrite: Promise<void> = Promise.resolve()

function readDigestCache(value: unknown): DigestCache {
  const parsed = readJsonValue<unknown>(value, {})
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as DigestCache
    : {}
}

function enqueueDigestCacheWrite<T>(operation: () => Promise<T>) {
  const task = digestCacheWrite.then(operation)
  digestCacheWrite = task.then(() => undefined, () => undefined)
  return task
}

onMessage('lexi-upsert-digest-cache', async ({ data }) => {
  const payload = data as { storageKey?: string, cacheKey?: string, entry?: string, maxEntries?: number }
  const { storageKey, cacheKey } = payload
  const parsed = readJsonValue<DigestCache[string] | undefined>(payload.entry, undefined)

  if (!storageKey || !digestStorageKeys.has(storageKey) || !cacheKey || !parsed?.sourceHash || !Number.isFinite(parsed.updatedAt))
    return { ok: false, error: '摘要缓存更新参数无效' }

  // Bound to a const so the narrowing survives into the async closure below.
  const entry = parsed
  // A non-numeric maxEntries would otherwise reach pruneDigestCache as NaN.
  const requested = Number(payload.maxEntries)
  const maxEntries = Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : 80

  return enqueueDigestCacheWrite(async () => {
    try {
      const stored = await browser.storage.local.get(storageKey)
      const cache = readDigestCache(stored[storageKey])
      cache[cacheKey] = entry
      await browser.storage.local.set({ [storageKey]: JSON.stringify(pruneDigestCache(cache, maxEntries)) })
      return { ok: true }
    }
    catch (error) {
      // Quota errors previously rejected opaquely, leaving the sender with no reason.
      console.warn('[Lexi] digest cache write failed', error)
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
})
