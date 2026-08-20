import browser from 'webextension-polyfill'
import { createSerializedTaskQueue } from './asyncQueue'
import { readJsonValue } from './storageJson'
import { translationUsageStorageKey } from './storageKeys'
import type { TranslationEngineConfig, TranslationRateLimitSettings } from './types'

interface TranslationUsageEntry {
  at: number
  engineId: string
}

type TranslationQuotaChannel = Pick<TranslationEngineConfig, 'id' | 'label' | 'dailyLimit'>

const usageWrite = createSerializedTaskQueue()
const maxStoredUsageEntries = 5000

function startOfLocalDay(now: number) {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function normalizedLimit(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0
}

function normalizedHour(value: number | undefined) {
  return Number.isFinite(value) ? Math.min(23, Math.max(0, Math.floor(value ?? 0))) : 0
}

function isWithinAllowedHours(settings: TranslationRateLimitSettings, now: number) {
  if (!settings.scheduleEnabled)
    return true

  const start = normalizedHour(settings.allowedStartHour)
  const end = normalizedHour(settings.allowedEndHour)
  if (start === end)
    return true

  const hour = new Date(now).getHours()
  return start < end ? hour >= start && hour < end : hour >= start || hour < end
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`
}

function parseUsageEntries(value: unknown): TranslationUsageEntry[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is TranslationUsageEntry => Boolean(
      entry && typeof entry === 'object'
      && Number.isFinite((entry as TranslationUsageEntry).at)
      && typeof (entry as TranslationUsageEntry).engineId === 'string',
    ))
    : []
}

function prune(entries: TranslationUsageEntry[], now: number, rollingWindowHours: number) {
  const oldest = Math.min(
    startOfLocalDay(now),
    rollingWindowHours > 0 ? now - rollingWindowHours * 60 * 60 * 1000 : startOfLocalDay(now),
  )
  return entries
    .filter(entry => Number.isFinite(entry.at) && entry.at >= oldest && typeof entry.engineId === 'string')
    .slice(-maxStoredUsageEntries)
}

/**
 * Reserves one request before a translation engine is called. The single background
 * worker serializes reservations, so simultaneous recovered tabs cannot overshoot a cap.
 */
export async function reserveTranslationQuota(settings: TranslationRateLimitSettings, engine: TranslationQuotaChannel) {
  return usageWrite(async () => {
    const now = Date.now()
    if (!isWithinAllowedHours(settings, now)) {
      const start = normalizedHour(settings.allowedStartHour)
      const end = normalizedHour(settings.allowedEndHour)
      throw new Error(`翻译仅允许在 ${formatHour(start)}–${formatHour(end)} 运行。`)
    }

    const stored = await browser.storage.local.get(translationUsageStorageKey)
    const entries = prune(
      parseUsageEntries(readJsonValue<unknown>(stored[translationUsageStorageKey], [])),
      now,
      normalizedLimit(settings.rollingWindowHours),
    )
    const today = entries.filter(entry => entry.at >= startOfLocalDay(now))
    const dailyLimit = normalizedLimit(settings.dailyLimit)
    if (dailyLimit && today.length >= dailyLimit)
      throw new Error(`今日翻译已达上限（${dailyLimit} 次）。`)

    const channelDailyLimit = normalizedLimit(engine.dailyLimit)
    if (channelDailyLimit && today.filter(entry => entry.engineId === engine.id).length >= channelDailyLimit)
      throw new Error(`${engine.label} 今日已达渠道上限（${channelDailyLimit} 次）。`)

    const rollingWindowHours = normalizedLimit(settings.rollingWindowHours)
    const rollingWindowLimit = normalizedLimit(settings.rollingWindowLimit)
    if (rollingWindowHours && rollingWindowLimit) {
      const windowStart = now - rollingWindowHours * 60 * 60 * 1000
      if (entries.filter(entry => entry.at >= windowStart).length >= rollingWindowLimit)
        throw new Error(`过去 ${rollingWindowHours} 小时已达翻译上限（${rollingWindowLimit} 次）。`)
    }

    entries.push({ at: now, engineId: engine.id })
    await browser.storage.local.set({ [translationUsageStorageKey]: JSON.stringify(entries.slice(-maxStoredUsageEntries)) })
  })
}
