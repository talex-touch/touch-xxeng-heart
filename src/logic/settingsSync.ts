import browser from 'webextension-polyfill'
import { mergeSettings } from './defaults'
import { readJsonValue, toStoredJson } from './storageJson'
import { settingsStorageKey, syncDeviceIdStorageKey, syncSettingsChunkPrefix, syncSettingsMetaKey } from './storageKeys'
import type { LexiSettings } from './types'

export const syncPayloadVersion = 1
/** chrome.storage.sync: 100 KB overall, 8 KB per item. */
export const syncQuotaBytes = 102400
const maxPayloadBytes = 92000
/** Worst-case UTF-8 is 3 bytes per BMP character, so 2000 chars stays under 8 KB. */
const maxChunkChars = 2000

interface SyncMeta {
  v: number
  updatedAt: number
  chunks: number
  /** Payload length; chunks replicate independently, so a hole has to be detectable. */
  length: number
  deviceId: string
}

export interface SyncPushResult {
  bytes: number
  chunks: number
  updatedAt: number
}

function isMeta(value: unknown): value is SyncMeta {
  if (typeof value !== 'object' || value == null)
    return false

  const meta = value as Partial<SyncMeta>
  return typeof meta.updatedAt === 'number' && typeof meta.chunks === 'number' && typeof meta.length === 'number'
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).length
}

/** Splits on code-point boundaries; a halved surrogate pair would not survive storage. */
function toChunks(payload: string) {
  const chunks: string[] = []
  let index = 0

  while (index < payload.length) {
    let end = Math.min(payload.length, index + maxChunkChars)
    const code = payload.charCodeAt(end - 1)
    if (end < payload.length && code >= 0xD800 && code <= 0xDBFF)
      end -= 1

    chunks.push(payload.slice(index, end))
    index = end
  }

  return chunks
}

/**
 * The settings that may leave the device.
 *
 * `sync` itself is per-device bookkeeping, and an approved HTTP endpoint is a consent the
 * user gave on one machine — neither travels. API keys travel only when asked for.
 */
export function toSyncPayload(settings: LexiSettings) {
  const { sync, ai, ...rest } = settings

  return {
    ...rest,
    ai: {
      ...ai,
      approvedHttpEndpoints: [],
      providers: ai.providers.map(provider => (
        sync.includeApiKeys ? provider : { ...provider, apiKey: '' }
      )),
    },
  }
}

/**
 * Applies a remote snapshot without losing what stayed local: sync bookkeeping, HTTP
 * approvals, and any API key the remote side chose not to send.
 */
export function mergeRemoteSettings(local: LexiSettings, remote: Partial<LexiSettings>): LexiSettings {
  const localProviders = new Map(local.ai.providers.map(provider => [provider.id, provider]))
  const merged = mergeSettings({ ...remote, sync: local.sync })

  return {
    ...merged,
    ai: {
      ...merged.ai,
      approvedHttpEndpoints: local.ai.approvedHttpEndpoints,
      providers: merged.ai.providers.map(provider => (
        provider.apiKey ? provider : { ...provider, apiKey: localProviders.get(provider.id)?.apiKey ?? '' }
      )),
    },
  }
}

export async function readLocalSettings(): Promise<LexiSettings> {
  const stored = await browser.storage.local.get(settingsStorageKey)
  return mergeSettings(readJsonValue<Partial<LexiSettings> | undefined>(stored[settingsStorageKey], undefined))
}

export async function writeLocalSettings(settings: LexiSettings) {
  await browser.storage.local.set({ [settingsStorageKey]: toStoredJson(settings) })
}

export async function getDeviceId() {
  const stored = await browser.storage.local.get(syncDeviceIdStorageKey)
  const existing = stored[syncDeviceIdStorageKey]
  if (typeof existing === 'string' && existing)
    return existing

  const deviceId = `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  await browser.storage.local.set({ [syncDeviceIdStorageKey]: deviceId })
  return deviceId
}

export async function getSyncQuota() {
  try {
    const used = await browser.storage.sync.getBytesInUse(null)
    return { used, total: syncQuotaBytes }
  }
  catch {
    return { used: 0, total: syncQuotaBytes }
  }
}

async function clearChunksFrom(index: number, previousChunks: number) {
  const stale = Array.from(
    { length: Math.max(0, previousChunks - index) },
    (_, offset) => `${syncSettingsChunkPrefix}${index + offset}`,
  )

  if (stale.length)
    await browser.storage.sync.remove(stale)
}

async function readMeta(): Promise<SyncMeta | undefined> {
  const stored = await browser.storage.sync.get(syncSettingsMetaKey)
  const meta = readJsonValue<unknown>(stored[syncSettingsMetaKey], undefined)
  return isMeta(meta) ? meta : undefined
}

/** Writes the current settings into the sync area. Throws when they exceed the quota. */
export async function pushSettingsToSync(settings: LexiSettings, updatedAt = Date.now()): Promise<SyncPushResult> {
  const payload = JSON.stringify({ v: syncPayloadVersion, settings: toSyncPayload(settings) })
  const bytes = byteLength(payload)
  if (bytes > maxPayloadBytes)
    throw new Error(`设置体积 ${Math.round(bytes / 1024)}KB 超出 Google 同步配额（约 100KB），请精简自定义 CSS、域名列表或提示词。`)

  const chunks = toChunks(payload)
  const previous = await readMeta()
  const meta: SyncMeta = {
    v: syncPayloadVersion,
    updatedAt,
    chunks: chunks.length,
    length: payload.length,
    deviceId: await getDeviceId(),
  }

  const items: Record<string, string> = { [syncSettingsMetaKey]: JSON.stringify(meta) }
  chunks.forEach((chunk, index) => {
    items[`${syncSettingsChunkPrefix}${index}`] = chunk
  })

  await browser.storage.sync.set(items)
  await clearChunksFrom(chunks.length, previous?.chunks ?? 0)

  return { bytes, chunks: chunks.length, updatedAt }
}

export interface SyncSnapshot {
  settings: Partial<LexiSettings>
  updatedAt: number
  deviceId: string
}

export async function readSyncSnapshot(): Promise<SyncSnapshot | undefined> {
  const meta = await readMeta()
  if (!meta || !meta.chunks)
    return undefined

  const keys = Array.from({ length: meta.chunks }, (_, index) => `${syncSettingsChunkPrefix}${index}`)
  const stored = await browser.storage.sync.get(keys)
  if (keys.some(key => typeof stored[key] !== 'string'))
    return undefined

  // A dropped chunk can still leave parseable JSON when it fell inside a long string,
  // so the length recorded at write time is what actually proves the payload is whole.
  const payload = keys.map(key => stored[key] as string).join('')
  if (payload.length !== meta.length)
    return undefined

  try {
    const parsed = JSON.parse(payload) as { v?: number, settings?: Partial<LexiSettings> }
    if (!parsed?.settings)
      return undefined

    return { settings: parsed.settings, updatedAt: meta.updatedAt, deviceId: meta.deviceId }
  }
  catch {
    // A partially replicated set of chunks reads as broken JSON; the next change re-syncs.
    return undefined
  }
}

/** Pulls the remote snapshot into local settings. Returns undefined when there is none. */
export async function pullSettingsFromSync(): Promise<LexiSettings | undefined> {
  const snapshot = await readSyncSnapshot()
  if (!snapshot)
    return undefined

  const local = await readLocalSettings()
  const merged = mergeRemoteSettings(local, snapshot.settings)
  merged.sync = { ...merged.sync, lastPulledAt: snapshot.updatedAt, lastError: '' }
  await writeLocalSettings(merged)
  return merged
}
