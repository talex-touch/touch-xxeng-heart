import browser from 'webextension-polyfill'
import { aiCallLogsStorageKey, pageVisitLogsStorageKey } from './storageKeys'
import { readJsonValue, toStoredJson } from './storageJson'
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

export function summarizeByDay(logs: Array<{ createdAt: number }>, days = 7) {
  const result = new Map<string, number>()
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })

  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date()
    date.setDate(date.getDate() - index)
    result.set(formatter.format(date), 0)
  }

  for (const log of logs) {
    const key = formatter.format(new Date(log.createdAt))
    if (result.has(key))
      result.set(key, (result.get(key) ?? 0) + 1)
  }

  return Array.from(result.entries()).map(([label, value]) => ({ label, value }))
}
