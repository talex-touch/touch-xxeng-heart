import browser from 'webextension-polyfill'
import { mergeSettings } from './defaults'
import { readJsonValue } from './storageJson'
import { settingsStorageKey, vocabularyStorageKey } from './storageKeys'
import type { LexiSettings, VocabularyRecord } from './types'

export interface StoredState {
  settings: LexiSettings
  records: VocabularyRecord[]
}

let cached: StoredState | undefined
let inflight: Promise<StoredState> | undefined
let subscribed = false

async function read(): Promise<StoredState> {
  const stored = await browser.storage.local.get([settingsStorageKey, vocabularyStorageKey])
  return {
    settings: mergeSettings(readJsonValue<Partial<LexiSettings> | undefined>(stored[settingsStorageKey], undefined)),
    records: readJsonValue<VocabularyRecord[]>(stored[vocabularyStorageKey], []),
  }
}

function onStorageChanged(changes: Record<string, unknown>) {
  if (settingsStorageKey in changes || vocabularyStorageKey in changes)
    invalidateStoredState()
}

function subscribe() {
  if (subscribed || !browser.storage?.onChanged)
    return

  subscribed = true
  browser.storage.onChanged.addListener(onStorageChanged)
}

/**
 * Settings and vocabulary, cached until storage actually changes.
 *
 * These were re-read, re-parsed and re-merged on every scroll frame, keystroke, hover and
 * selection — two `JSON.parse` calls over the full vocabulary array per interaction.
 * `browser.storage.onChanged` already told us when the data moved; now we listen to it.
 */
export async function getStoredState(): Promise<StoredState> {
  subscribe()

  if (cached)
    return cached

  // Collapse concurrent callers onto one read instead of racing several.
  inflight ??= read()
    .then((state) => {
      cached = state
      return state
    })
    .finally(() => {
      inflight = undefined
    })

  return inflight
}

/** Drop the cache; the next read goes back to storage. */
export function invalidateStoredState() {
  cached = undefined
}

/** Cached value if one is present, without touching storage. Never triggers a read. */
export function peekStoredState() {
  return cached
}

/** Reflect a local write immediately so callers don't wait for the storage event. */
export function primeStoredRecords(records: VocabularyRecord[]) {
  if (cached)
    cached = { ...cached, records }
}
