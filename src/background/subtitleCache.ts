import browser from 'webextension-polyfill'
import { createSerializedTaskQueue } from '~/logic/asyncQueue'
import { readJsonValue } from '~/logic/storageJson'
import {
  defaultSubtitleCacheMaxEntries,
  defaultSubtitleCacheMaxTranslations,
  mergeSubtitleCacheSnapshots,
  parseSubtitleCacheSnapshot,
  subtitleCacheVersion,
} from '~/logic/subtitles/cache'
import { subtitleTranslationCacheStorageKey } from '~/logic/storageKeys'
import type { SubtitleCacheSnapshot } from '~/logic/subtitles/cache'

export type SubtitleCacheWriteResult = { ok: true } | { ok: false, error: string }

const cacheQueue = createSerializedTaskQueue()

async function readStoredSnapshot(): Promise<SubtitleCacheSnapshot> {
  const stored = await browser.storage.local.get(subtitleTranslationCacheStorageKey)
  return parseSubtitleCacheSnapshot(
    readJsonValue<unknown>(stored[subtitleTranslationCacheStorageKey], undefined),
    defaultSubtitleCacheMaxTranslations,
    defaultSubtitleCacheMaxEntries,
  )
}

export async function readSubtitleCacheSnapshot(): Promise<SubtitleCacheSnapshot> {
  try {
    return await cacheQueue(readStoredSnapshot)
  }
  catch {
    return { version: subtitleCacheVersion, entries: [] }
  }
}

export async function mergeSubtitleCacheSnapshot(value: unknown): Promise<SubtitleCacheWriteResult> {
  return cacheQueue(async () => {
    try {
      const current = await readStoredSnapshot()
      const incoming = parseSubtitleCacheSnapshot(
        value,
        defaultSubtitleCacheMaxTranslations,
        defaultSubtitleCacheMaxEntries,
      )
      const next = mergeSubtitleCacheSnapshots(
        current,
        incoming,
        defaultSubtitleCacheMaxEntries,
        defaultSubtitleCacheMaxTranslations,
      )
      await browser.storage.local.set({
        [subtitleTranslationCacheStorageKey]: JSON.stringify(next),
      })
      return { ok: true }
    }
    catch {
      return { ok: false, error: '字幕缓存暂时不可用' }
    }
  })
}

export async function clearSubtitleCache(): Promise<SubtitleCacheWriteResult> {
  return cacheQueue(async () => {
    try {
      await browser.storage.local.remove(subtitleTranslationCacheStorageKey)
      return { ok: true }
    }
    catch {
      return { ok: false, error: '字幕缓存清理失败' }
    }
  })
}
