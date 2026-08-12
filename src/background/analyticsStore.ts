import browser from 'webextension-polyfill'
import { appendBoundedLog } from '~/logic/analyticsQueue'
import { createSerializedTaskQueue } from '~/logic/asyncQueue'
import { readJsonValue, toStoredJson } from '~/logic/storageJson'
import { aiCallLogsStorageKey, pageVisitLogsStorageKey } from '~/logic/storageKeys'
import type { AnalyticsLogPayload } from '~/logic/analytics'

const maxAnalyticsLogs = 80
const analyticsWrite = createSerializedTaskQueue()

export function isAnalyticsLogPayload(value: unknown): value is AnalyticsLogPayload {
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

/**
 * Appends one log, serialized against every other writer.
 *
 * Shared by the message handler and the AI runner: the runner executes inside the worker,
 * and a runtime message never comes back to the context that sent it.
 */
export function persistAnalyticsLog(payload: AnalyticsLogPayload) {
  return analyticsWrite(async () => {
    const storageKey = payload.kind === 'ai' ? aiCallLogsStorageKey : pageVisitLogsStorageKey
    const stored = await browser.storage.local.get(storageKey)
    const current = readJsonValue<unknown[]>(stored[storageKey], [])
    await browser.storage.local.set({
      [storageKey]: toStoredJson(appendBoundedLog(current, payload.item, maxAnalyticsLogs)),
    })
  })
}
