import browser from 'webextension-polyfill'
import { aiCallLogsStorageKey, pageVisitLogsStorageKey } from './storageKeys'
import { readJsonValue, toStoredJson } from './storageJson'
import { formatDay } from './format'
import type { AiCallLog, PageVisitLog } from './types'

const maxLogs = 80

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function readList<T>(key: string) {
  const stored = await browser.storage.local.get(key)
  return readJsonValue<T[]>(stored[key], [])
}

async function prependLog<T>(key: string, item: T) {
  const current = await readList<T>(key)
  await browser.storage.local.set({
    [key]: toStoredJson([item, ...current].slice(0, maxLogs)),
  })
}

export async function recordAiCall(log: Omit<AiCallLog, 'id' | 'createdAt'>) {
  await prependLog<AiCallLog>(aiCallLogsStorageKey, {
    ...log,
    id: createId('ai'),
    createdAt: Date.now(),
  })
}

export async function recordPageVisit(log: Omit<PageVisitLog, 'id' | 'createdAt'>) {
  await prependLog<PageVisitLog>(pageVisitLogsStorageKey, {
    ...log,
    id: createId('page'),
    createdAt: Date.now(),
  })
}

/**
 * Buckets logs into the last `days` days.
 *
 * `weight` decides what each log contributes: the default counts calls, and passing
 * `log => log.totalTokens ?? 0` sums tokens — which is what the options page's
 * separate `summarizeTokensByDay` copy did.
 */
export function summarizeByDay<T extends { createdAt: number }>(
  logs: T[],
  days = 7,
  weight: (log: T) => number = () => 1,
) {
  const result = new Map<string, number>()

  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date()
    date.setDate(date.getDate() - index)
    result.set(formatDay(date.getTime()), 0)
  }

  for (const log of logs) {
    const key = formatDay(log.createdAt)
    if (result.has(key))
      result.set(key, (result.get(key) ?? 0) + weight(log))
  }

  return Array.from(result.entries()).map(([label, value]) => ({ label, value }))
}
