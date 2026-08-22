import browser from 'webextension-polyfill'
import { onMessage } from 'webext-bridge/background'
import { startAiService } from './aiService'
import { isAnalyticsLogPayload, persistAnalyticsLog } from './analyticsStore'
import { startSettingsSync } from './settingsSync'
import { setAnalyticsSink } from '~/logic/analytics'
import { listenRuntimeMessage, sendTabRuntimeMessage } from '~/logic/runtimeMessaging'
import { createSerializedTaskQueue } from '~/logic/asyncQueue'
import { readLocalSettings } from '~/logic/settingsSync'
import { normalizeTranslationEngines, translateWithEngines } from '~/logic/translationEngines'
import { enqueueTranslation, reserveTranslationQuota } from '~/logic/translationQuota'
import type { PageTranslationCache, TranslationDirection, TranslationEngineConfig } from '~/logic/types'
import { mergeDigestCacheEntry, pruneDigestCacheBySize } from '~/logic/digestCache'
import { readJsonValue } from '~/logic/storageJson'
import { contentDigestLeaseStorageKey, contentDigestStorageKey, forumDigestStorageKey, githubDigestStorageKey, pageTranslationsStorageKey } from '~/logic/storageKeys'

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

// Registered at the top level so a storage change can wake the service worker.
startSettingsSync()

// Every AI call runs here: credentials and endpoints never enter a page's world, and a
// worker request is exempt from the CORS check that blocks content scripts.
setAnalyticsSink(persistAnalyticsLog)
startAiService()

function isTranslationDirection(value: unknown): value is TranslationDirection {
  return value === 'auto' || value === 'zh-to-en' || value === 'en-to-zh'
}

function isTranslationEngineConfig(value: unknown): value is TranslationEngineConfig {
  return Boolean(value && typeof value === 'object' && 'id' in value && 'kind' in value)
}

listenRuntimeMessage<{ text?: unknown, direction?: unknown }>('lexi-translate-text', async (payload) => {
  const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
  const direction = payload?.direction
  if (!text || !isTranslationDirection(direction))
    throw new Error('翻译参数无效。')

  return enqueueTranslation(async () => {
    const settings = await readLocalSettings()
    return translateWithEngines(
      settings.translation.engines,
      { text, direction },
      fetch,
      engine => reserveTranslationQuota(settings.translation.rateLimit, engine),
    )
  })
})

listenRuntimeMessage<unknown>('lexi-test-translation-engine', async (payload) => {
  if (!isTranslationEngineConfig(payload))
    throw new Error('翻译引擎参数无效。')

  return enqueueTranslation(() => translateWithEngines(
    normalizeTranslationEngines([payload]),
    { text: 'Translation connection test.', direction: 'en-to-zh' },
  ))
})

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

const pageTranslationCacheWrite = createSerializedTaskQueue()

listenRuntimeMessage<unknown>('lexi-record-analytics', async (payload) => {
  if (!isAnalyticsLogPayload(payload))
    return { ok: false, error: '日志参数无效' }

  await persistAnalyticsLog(payload)
  return { ok: true }
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

const digestStorageKeys = new Set([githubDigestStorageKey, forumDigestStorageKey, contentDigestStorageKey])
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
  const payload = data as { storageKey?: string, cacheKey?: string, entry?: string, maxEntries?: number, maxBytes?: number }
  const { storageKey, cacheKey } = payload
  const parsed = readJsonValue<DigestCache[string] | undefined>(payload.entry, undefined)

  if (!storageKey
    || !digestStorageKeys.has(storageKey)
    || !cacheKey
    || cacheKey.length > 4096
    || !payload.entry
    || payload.entry.length > 128 * 1024
    || !parsed?.sourceHash
    || !Number.isFinite(parsed.updatedAt)) {
    return { ok: false, error: '摘要缓存更新参数无效' }
  }

  const entry = parsed
  const requested = Number(payload.maxEntries)
  const maxEntries = Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : 80
  const requestedBytes = Number(payload.maxBytes)
  const maxBytes = Number.isFinite(requestedBytes) ? Math.max(1024, Math.floor(requestedBytes)) : 8 * 1024 * 1024

  return enqueueDigestCacheWrite(async () => {
    try {
      const stored = await browser.storage.local.get(storageKey)
      const cache = readDigestCache(stored[storageKey])
      cache[cacheKey] = mergeDigestCacheEntry(cache[cacheKey], entry)
      await browser.storage.local.set({
        [storageKey]: JSON.stringify(pruneDigestCacheBySize(cache, maxEntries, maxBytes)),
      })
      return { ok: true }
    }
    catch (error) {
      console.warn('[Lexi] digest cache write failed', error)
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
})

interface DigestLease {
  owner: string
  expiresAt: number
}

type DigestLeases = Record<string, DigestLease>

const digestLeaseQueue = createSerializedTaskQueue()

function readDigestLeases(value: unknown, now: number) {
  const parsed = readJsonValue<DigestLeases>(value, {})
  return Object.fromEntries(Object.entries(parsed).filter(([, lease]) =>
    typeof lease?.owner === 'string' && Number.isFinite(lease.expiresAt) && lease.expiresAt > now,
  )) as DigestLeases
}

listenRuntimeMessage<{ key?: unknown, owner?: unknown, leaseMs?: unknown }>('lexi-acquire-digest-lease', (payload) => {
  const key = typeof payload?.key === 'string' ? payload.key : ''
  const owner = typeof payload?.owner === 'string' ? payload.owner : ''
  const leaseMs = Math.min(120_000, Math.max(5_000, Number(payload?.leaseMs) || 45_000))
  if (!/^[a-z0-9-]{8,80}$/i.test(key) || !/^[a-z0-9-]{8,80}$/i.test(owner))
    return { ok: false, error: '摘要请求锁参数无效' }

  return digestLeaseQueue(async () => {
    const now = Date.now()
    const stored = await browser.storage.local.get(contentDigestLeaseStorageKey)
    const leases = readDigestLeases(stored[contentDigestLeaseStorageKey], now)
    const current = leases[key]
    if (current && current.owner !== owner) {
      return {
        ok: false,
        busy: true,
        retryAfterMs: Math.max(500, current.expiresAt - now),
      }
    }

    leases[key] = { owner, expiresAt: now + leaseMs }
    await browser.storage.local.set({ [contentDigestLeaseStorageKey]: JSON.stringify(leases) })
    return { ok: true, expiresAt: leases[key].expiresAt }
  })
})

listenRuntimeMessage<{ key?: unknown, owner?: unknown }>('lexi-release-digest-lease', (payload) => {
  const key = typeof payload?.key === 'string' ? payload.key : ''
  const owner = typeof payload?.owner === 'string' ? payload.owner : ''
  if (!key || !owner)
    return { ok: false }

  return digestLeaseQueue(async () => {
    const stored = await browser.storage.local.get(contentDigestLeaseStorageKey)
    const leases = readDigestLeases(stored[contentDigestLeaseStorageKey], Date.now())
    if (leases[key]?.owner === owner)
      delete leases[key]

    if (Object.keys(leases).length)
      await browser.storage.local.set({ [contentDigestLeaseStorageKey]: JSON.stringify(leases) })
    else
      await browser.storage.local.remove(contentDigestLeaseStorageKey)
    return { ok: true }
  })
})
