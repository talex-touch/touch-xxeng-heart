import { createSerializedTaskQueue } from '../asyncQueue'
import { readJsonValue } from '../storageJson'
import { isRecord } from '../providers/protocol'
import { normalizeText, simpleHash } from '../text'
import { subtitleTranslationCacheStorageKey } from '../storageKeys'
import type { SubtitleCue } from './types'

export const subtitleCacheVersion = 1
export const defaultSubtitleCacheMaxEntries = 120
export const defaultSubtitleCacheMaxTranslations = 48
export const maxSubtitleCacheTranslationLength = 1200
export const maxSubtitleCacheIdentityLength = 512
export const maxSubtitleCacheCueKeyLength = 160
export const maxSubtitleCacheSerializedBytes = 512 * 1024

export interface SubtitleCacheIdentity {
  providerId: string
  mediaId: string
  sourceLang: string
  targetLang: string
  sourceHash: string
}

export interface SubtitleCacheEntry extends SubtitleCacheIdentity {
  /** Hash-keyed translations only; raw cue text and media data never enter this object. */
  translations: Record<string, string>
  updatedAt: number
}

export interface SubtitleCacheSnapshot {
  version: typeof subtitleCacheVersion
  entries: SubtitleCacheEntry[]
}

export interface SubtitleCacheStorage {
  read: () => unknown | Promise<unknown>
  write: (snapshot: SubtitleCacheSnapshot) => void | Promise<void>
  clear?: () => void | Promise<void>
}

export interface SubtitleTranslationCache {
  load: () => Promise<void>
  lookup: (identity: SubtitleCacheIdentity, cueKey: string, ttlDays: number) => string | undefined
  merge: (identity: SubtitleCacheIdentity, translations: Record<string, string>, ttlDays: number) => void
  flush: () => Promise<void>
  clear: () => Promise<void>
  snapshot: () => SubtitleCacheSnapshot
}

export interface SubtitleTranslationCacheOptions {
  storage?: SubtitleCacheStorage
  now?: () => number
  maxEntries?: number
  maxTranslationsPerEntry?: number
}

const storageQueues = new WeakMap<object, ReturnType<typeof createSerializedTaskQueue>>()

const defaultStorage: SubtitleCacheStorage = {
  read: () => {
    try {
      return typeof sessionStorage === 'undefined'
        ? undefined
        : sessionStorage.getItem(subtitleTranslationCacheStorageKey)
    }
    catch {
      return undefined
    }
  },
  write: (snapshot) => {
    if (typeof sessionStorage !== 'undefined')
      sessionStorage.setItem(subtitleTranslationCacheStorageKey, JSON.stringify(snapshot))
  },
  clear: () => {
    if (typeof sessionStorage !== 'undefined')
      sessionStorage.removeItem(subtitleTranslationCacheStorageKey)
  },
}

function normalizeField(value: unknown, maxLength = maxSubtitleCacheIdentityLength) {
  if (typeof value !== 'string')
    return ''

  const normalized = normalizeText(value)
  return normalized.length <= maxLength ? normalized : ''
}

function normalizeIdentity(value: unknown): SubtitleCacheIdentity | undefined {
  if (!isRecord(value) || Array.isArray(value))
    return undefined

  const providerId = normalizeField(value.providerId, 120)
  const mediaId = normalizeField(value.mediaId)
  const sourceLang = normalizeField(value.sourceLang, 64).toLowerCase()
  const targetLang = normalizeField(value.targetLang, 64).toLowerCase()
  const sourceHash = normalizeField(value.sourceHash, 160)
  if (!providerId || !mediaId || /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(mediaId) || !sourceLang || !targetLang || !sourceHash)
    return undefined
  return { providerId, mediaId, sourceLang, targetLang, sourceHash }
}

function identityKey(identity: SubtitleCacheIdentity) {
  return [identity.providerId, identity.mediaId, identity.sourceLang, identity.targetLang, identity.sourceHash].join('\u001F')
}

function normalizeCueKey(value: unknown) {
  if (typeof value !== 'string')
    return ''

  const key = value.trim()
  return key.length > 0 && key.length <= maxSubtitleCacheCueKeyLength ? key : ''
}

function normalizeTranslation(value: unknown) {
  if (typeof value !== 'string')
    return ''

  const translation = normalizeText(value)
  return translation.length > 0 && translation.length <= maxSubtitleCacheTranslationLength ? translation : ''
}

function normalizeUpdatedAt(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function normalizeTranslations(value: unknown, maxTranslations: number) {
  if (!isRecord(value) || Array.isArray(value))
    return {}

  const result: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = normalizeCueKey(rawKey)
    const translation = normalizeTranslation(rawValue)
    if (key && translation)
      result[key] = translation
  }

  return Object.fromEntries(Object.entries(result).slice(-maxTranslations))
}

function normalizeEntry(value: unknown, maxTranslations: number): SubtitleCacheEntry | undefined {
  const identity = normalizeIdentity(value)
  if (!identity || !isRecord(value) || Array.isArray(value))
    return undefined

  const updatedAt = normalizeUpdatedAt(value.updatedAt)
  const translations = normalizeTranslations(value.translations, maxTranslations)
  if (!updatedAt || !Object.keys(translations).length)
    return undefined

  return { ...identity, translations, updatedAt }
}

export function parseSubtitleCacheSnapshot(
  value: unknown,
  maxTranslations = defaultSubtitleCacheMaxTranslations,
  maxEntries = defaultSubtitleCacheMaxEntries,
): SubtitleCacheSnapshot {
  if (!isRecord(value) || Array.isArray(value) || value.version !== subtitleCacheVersion || !Array.isArray(value.entries))
    return { version: subtitleCacheVersion, entries: [] }

  const byIdentity = new Map<string, SubtitleCacheEntry>()
  for (const item of value.entries) {
    const entry = normalizeEntry(item, maxTranslations)
    if (entry)
      byIdentity.set(identityKey(entry), entry)
  }

  return {
    version: subtitleCacheVersion,
    entries: [...byIdentity.values()]
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(-Math.max(1, Math.floor(maxEntries))),
  }
}

function trimTranslations(translations: Record<string, string>, maxTranslations: number) {
  return Object.fromEntries(Object.entries(translations).slice(-maxTranslations))
}

export function boundSubtitleCacheSnapshot(
  snapshot: SubtitleCacheSnapshot,
  maxEntries = defaultSubtitleCacheMaxEntries,
  maxTranslations = defaultSubtitleCacheMaxTranslations,
): SubtitleCacheSnapshot {
  const parsed = parseSubtitleCacheSnapshot(snapshot, maxTranslations, maxEntries)
  const newestFirst = [...parsed.entries].sort((a, b) => b.updatedAt - a.updatedAt)
  const selected: SubtitleCacheEntry[] = []

  for (const entry of newestFirst) {
    const candidate: SubtitleCacheSnapshot = {
      version: subtitleCacheVersion,
      entries: [...selected, entry],
    }
    const bytes = new TextEncoder().encode(JSON.stringify(candidate)).byteLength
    if (bytes <= maxSubtitleCacheSerializedBytes)
      selected.push(entry)
  }

  return {
    version: subtitleCacheVersion,
    entries: selected
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(-Math.max(1, Math.floor(maxEntries)))
      .map(entry => ({
        ...entry,
        translations: trimTranslations(entry.translations, maxTranslations),
      })),
  }
}

export function mergeSubtitleCacheSnapshots(
  current: SubtitleCacheSnapshot,
  incoming: SubtitleCacheSnapshot,
  maxEntries = defaultSubtitleCacheMaxEntries,
  maxTranslations = defaultSubtitleCacheMaxTranslations,
): SubtitleCacheSnapshot {
  const byIdentity = new Map<string, SubtitleCacheEntry>()
  for (const entry of parseSubtitleCacheSnapshot(current, maxTranslations, maxEntries).entries)
    byIdentity.set(identityKey(entry), entry)

  for (const entry of parseSubtitleCacheSnapshot(incoming, maxTranslations, maxEntries).entries) {
    const key = identityKey(entry)
    const previous = byIdentity.get(key)
    if (!previous) {
      byIdentity.set(key, entry)
      continue
    }

    byIdentity.set(key, {
      ...entry,
      updatedAt: Math.max(previous.updatedAt, entry.updatedAt),
      translations: trimTranslations({ ...previous.translations, ...entry.translations }, maxTranslations),
    })
  }

  return boundSubtitleCacheSnapshot({
    version: subtitleCacheVersion,
    entries: [...byIdentity.values()],
  }, maxEntries, maxTranslations)
}

export function createSubtitleCueKey(cue: SubtitleCue) {
  const start = Number.isFinite(cue.start) ? cue.start.toFixed(3) : '0'
  const end = Number.isFinite(cue.end) ? cue.end.toFixed(3) : '0'
  return `cue-${simpleHash(`${start}|${end}|${normalizeText(cue.text)}`)}`
}

export function hashSubtitleCues(cues: SubtitleCue[]) {
  return `source-${simpleHash(cues.map(cue => `${cue.start.toFixed(3)}|${cue.end.toFixed(3)}|${normalizeText(cue.text)}`).join('\n'))}`
}

function ttlMilliseconds(ttlDays: number) {
  return Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays * 24 * 60 * 60 * 1000 : 0
}

function isFresh(updatedAt: number, ttlDays: number, timestamp: number) {
  const ttl = ttlMilliseconds(ttlDays)
  return ttl > 0 && updatedAt > 0 && timestamp - updatedAt <= ttl
}

function storageQueue(storage: SubtitleCacheStorage) {
  const key = storage as object
  let queue = storageQueues.get(key)
  if (!queue) {
    queue = createSerializedTaskQueue()
    storageQueues.set(key, queue)
  }
  return queue
}

export function createSubtitleTranslationCache(
  options: SubtitleTranslationCacheOptions = {},
): SubtitleTranslationCache {
  const storage = options.storage ?? defaultStorage
  const now = options.now ?? (() => Date.now())
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? defaultSubtitleCacheMaxEntries))
  const maxTranslations = Math.max(1, Math.floor(options.maxTranslationsPerEntry ?? defaultSubtitleCacheMaxTranslations))
  const entries = new Map<string, SubtitleCacheEntry>()
  let loaded = false
  let loading: Promise<void> | undefined
  let dirty = false
  let clearRequested = false

  const load = async () => {
    if (loaded)
      return
    if (!loading) {
      loading = Promise.resolve()
        .then(() => storage.read())
        .then((value) => {
          const parsed = parseSubtitleCacheSnapshot(
            readJsonValue<unknown>(value, undefined),
            maxTranslations,
            maxEntries,
          )
          entries.clear()
          for (const entry of parsed.entries)
            entries.set(identityKey(entry), entry)
        })
        .catch(() => {
          entries.clear()
        })
        .finally(() => {
          loaded = true
        })
    }
    await loading
  }

  const snapshot = () => boundSubtitleCacheSnapshot({
    version: subtitleCacheVersion,
    entries: [...entries.values()],
  }, maxEntries, maxTranslations)

  const pruneExpired = (ttlDays: number, timestamp: number) => {
    let changed = false
    for (const [key, entry] of entries) {
      if (!isFresh(entry.updatedAt, ttlDays, timestamp)) {
        entries.delete(key)
        changed = true
      }
    }
    if (changed)
      dirty = true
  }

  return {
    load,
    lookup(identity, cueKey, ttlDays) {
      if (!loaded)
        return undefined

      const normalized = normalizeIdentity(identity)
      const key = normalizeCueKey(cueKey)
      if (!normalized || !key)
        return undefined

      const timestamp = now()
      pruneExpired(ttlDays, timestamp)
      const entry = entries.get(identityKey(normalized))
      if (!entry || !isFresh(entry.updatedAt, ttlDays, timestamp))
        return undefined

      return entry.translations[key]
    },
    merge(identity, translations, ttlDays) {
      if (!loaded)
        return

      const normalized = normalizeIdentity(identity)
      if (!normalized || !ttlMilliseconds(ttlDays))
        return

      const timestamp = now()
      pruneExpired(ttlDays, timestamp)
      const incoming = normalizeTranslations(translations, maxTranslations)
      if (!Object.keys(incoming).length)
        return

      const key = identityKey(normalized)
      const previous = entries.get(key)
      entries.set(key, {
        ...normalized,
        translations: trimTranslations({ ...(previous?.translations ?? {}), ...incoming }, maxTranslations),
        updatedAt: timestamp,
      })
      while (entries.size > maxEntries) {
        const oldest = [...entries.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0]
        if (!oldest)
          break
        entries.delete(oldest[0])
      }
      dirty = true
    },
    async flush() {
      await load()
      if (!dirty)
        return

      const localSnapshot = snapshot()
      try {
        await storageQueue(storage)(async () => {
          let next = localSnapshot
          if (!clearRequested) {
            try {
              next = mergeSubtitleCacheSnapshots(
                parseSubtitleCacheSnapshot(await storage.read(), maxTranslations, maxEntries),
                localSnapshot,
                maxEntries,
                maxTranslations,
              )
            }
            catch {
              // A blocked read should not prevent a best-effort write of the mirror.
            }
          }
          await storage.write(next)
          entries.clear()
          for (const entry of next.entries)
            entries.set(identityKey(entry), entry)
        })
        dirty = false
        clearRequested = false
      }
      catch {
        // Keep the mirror and dirty bit so a later flush can retry.
      }
    },
    async clear() {
      await load()
      entries.clear()
      dirty = true
      clearRequested = true
      try {
        await storageQueue(storage)(async () => {
          if (storage.clear)
            await storage.clear()
          else
            await storage.write({ version: subtitleCacheVersion, entries: [] })
        })
        dirty = false
        clearRequested = false
      }
      catch {
        // Memory is clear; the pending flag makes the next flush write an empty snapshot.
      }
    },
    snapshot,
  }
}
