import browser from 'webextension-polyfill'
import { onMessage } from 'webext-bridge/background'
import { listenRuntimeMessage, sendTabRuntimeMessage } from '~/logic/runtimeMessaging'
import { pruneDigestCache } from '~/logic/digestCache'
import { readJsonValue } from '~/logic/storageJson'
import { forumDigestStorageKey, githubDigestStorageKey } from '~/logic/storageKeys'

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
