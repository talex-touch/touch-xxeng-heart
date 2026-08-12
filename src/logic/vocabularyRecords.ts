import { getDailyRecommendations } from './vocabularyBank'
import type { RecordVocabularyRequest, VocabularyCandidate, VocabularyRecord } from './types'

const day = 24 * 60 * 60 * 1000
const maxTextLength = 600
const maxContextLength = 1200
const maxTagLength = 32
const maxTags = 12
const productVocabularyTags = new Set(['product', 'product-name', 'brand', 'tool', 'platform', 'service'])
const minute = 60 * 1000
const reviewIntervals = [day, 2 * day, 4 * day, 7 * day, 14 * day, 30 * day, 60 * day, 120 * day, 240 * day] as const

export type VocabularyReviewResult = 'forgot' | 'hard' | 'remembered'

function hasVocabularyTag(candidate: Pick<VocabularyCandidate, 'tags'>, tags: Iterable<string>) {
  const normalizedTags = new Set(candidate.tags.map(tag => tag.trim().toLowerCase()))
  for (const tag of tags) {
    if (normalizedTags.has(tag.trim().toLowerCase()))
      return true
  }

  return false
}

export function isProductVocabularyCandidate(candidate: Pick<VocabularyCandidate, 'tags'>) {
  return hasVocabularyTag(candidate, productVocabularyTags)
}

export function getVocabularyId(original: string, replacement: string) {
  return `${original.trim()}:${replacement.trim().toLowerCase()}`
}

function createRecord(request: RecordVocabularyRequest, now = Date.now()): VocabularyRecord {
  const { candidate } = request
  return {
    ...candidate,
    id: getVocabularyId(candidate.original, candidate.replacement),
    source: request.source,
    pageUrl: request.pageUrl,
    pageTitle: request.pageTitle,
    context: request.context,
    seenCount: request.source === 'auto' ? 1 : 0,
    selectedCount: request.source === 'manual' ? 1 : 0,
    learnedLevel: 0,
    reviewCount: 0,
    createdAt: now,
    updatedAt: now,
    nextReviewAt: now + day,
  }
}

export function upsertVocabularyRecord(
  records: VocabularyRecord[],
  request: RecordVocabularyRequest,
  now = Date.now(),
) {
  const id = getVocabularyId(request.candidate.original, request.candidate.replacement)
  const current = records.find(record => record.id === id)

  if (!current)
    return [createRecord(request, now), ...records]

  return records.map((record) => {
    if (record.id !== id)
      return record

    const manual = request.source === 'manual'
    const selectedCount = record.selectedCount + (manual ? 1 : 0)
    const seenCount = record.seenCount + (request.source === 'auto' ? 1 : 0)
    const learnedLevel = Math.min(8, record.learnedLevel + (manual ? 1 : 0))

    return {
      ...record,
      ...request.candidate,
      source: manual ? 'manual' : record.source,
      pageUrl: request.pageUrl ?? record.pageUrl,
      pageTitle: request.pageTitle ?? record.pageTitle,
      context: request.context ?? record.context,
      selectedCount,
      seenCount,
      learnedLevel,
      // Re-selecting an archived word is an explicit "I want to learn this again".
      archivedAt: manual ? undefined : record.archivedAt,
      updatedAt: now,
      // Passive auto exposure must not push reviews out; only manual learning reschedules.
      nextReviewAt: manual ? now + Math.max(1, learnedLevel + 1) * day : record.nextReviewAt,
    }
  })
}

const exposureGraceCount = 6
const exposureCooldownStepMs = 12 * 60 * 60 * 1000
const exposureCooldownMaxMs = 3 * day

/**
 * Rest time before a word may be auto-replaced again. The first few exposures are
 * free; after that every extra exposure (and every review level) lengthens the
 * cooldown, so well-seen words gradually fade from pages instead of repeating.
 */
export function getReplacementCooldownMs(record: Pick<VocabularyRecord, 'seenCount' | 'learnedLevel'>) {
  const over = record.seenCount - exposureGraceCount + record.learnedLevel * 2
  if (over <= 0)
    return 0

  return Math.min(exposureCooldownMaxMs, over * exposureCooldownStepMs)
}

export function isReplacementSuppressed(
  record: Pick<VocabularyRecord, 'seenCount' | 'learnedLevel' | 'updatedAt' | 'archivedAt'>,
  now = Date.now(),
) {
  if (record.archivedAt)
    return true

  return now - record.updatedAt < getReplacementCooldownMs(record)
}

export function setVocabularyArchived(records: VocabularyRecord[], id: string, archived: boolean, now = Date.now()) {
  return records.map((record) => {
    if (record.id !== id || Boolean(record.archivedAt) === archived)
      return record

    return { ...record, archivedAt: archived ? now : undefined, updatedAt: now }
  })
}

export function normalizeImportedRecord(value: unknown, now = Date.now()): VocabularyRecord | undefined {
  if (!isRecordLike(value))
    return undefined

  const original = sanitizeRequiredText(value.original, 120)
  const replacement = sanitizeRequiredText(value.replacement, 120)
  if (!original || !replacement)
    return undefined

  const createdAt = sanitizeTimestamp(value.createdAt, now)
  const updatedAt = sanitizeTimestamp(value.updatedAt, createdAt)

  return {
    id: getVocabularyId(original, replacement),
    original,
    replacement,
    pronunciation: sanitizeOptionalText(value.pronunciation, 120),
    meaning: sanitizeOptionalText(value.meaning, maxTextLength) ?? '',
    example: sanitizeOptionalText(value.example, maxTextLength) ?? '',
    tags: sanitizeTags(value.tags),
    difficulty: clampInteger(value.difficulty, 1, 5, 2),
    source: value.source === 'manual' || value.source === 'daily' || value.source === 'auto'
      ? value.source
      : 'manual',
    pageUrl: sanitizeOptionalText(value.pageUrl, 500),
    pageTitle: sanitizeOptionalText(value.pageTitle, 200),
    context: sanitizeOptionalText(value.context, maxContextLength),
    seenCount: clampInteger(value.seenCount, 0, 9999, 0),
    selectedCount: clampInteger(value.selectedCount, 0, 9999, 0),
    learnedLevel: clampInteger(value.learnedLevel, 0, 8, 0),
    reviewCount: clampInteger(value.reviewCount, 0, 9999, 0),
    lastReviewedAt: sanitizeOptionalTimestamp(value.lastReviewedAt),
    archivedAt: sanitizeOptionalTimestamp(value.archivedAt),
    createdAt,
    updatedAt,
    nextReviewAt: sanitizeTimestamp(value.nextReviewAt, updatedAt + day),
  }
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null
}

function sanitizeRequiredText(value: unknown, maxLength: number) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : ''
}

function sanitizeOptionalText(value: unknown, maxLength: number) {
  const text = sanitizeRequiredText(value, maxLength)
  return text || undefined
}

function sanitizeTags(value: unknown) {
  if (!Array.isArray(value))
    return []

  return [...new Set(value
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim().replace(/\s+/g, '-').toLowerCase().slice(0, maxTagLength))
    .filter(Boolean))]
    .slice(0, maxTags)
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const numberValue = typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback

  return Math.min(max, Math.max(min, numberValue))
}

function sanitizeTimestamp(value: unknown, fallback: number) {
  const timestamp = typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback

  return timestamp > 0 ? timestamp : fallback
}

function sanitizeOptionalTimestamp(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return undefined

  const timestamp = Math.trunc(value)
  return timestamp > 0 ? timestamp : undefined
}

export function getProgressDifficulty(records: VocabularyRecord[], baseDifficulty: number) {
  const reviewed = records.filter(record => record.selectedCount > 0 || record.learnedLevel > 0).length
  const levelBonus = Math.min(3, Math.floor(reviewed / 12))
  return Math.min(5, baseDifficulty + levelBonus)
}

export function getDueRecords(records: VocabularyRecord[], now = Date.now()) {
  return records
    .filter(record => !record.archivedAt && record.nextReviewAt <= now)
    .sort((a, b) => a.nextReviewAt - b.nextReviewAt)
}

export function getTodayReviewCount(records: VocabularyRecord[], now = Date.now()) {
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  return records.filter(record => (record.lastReviewedAt ?? 0) >= startOfDay.getTime()).length
}

export function reviewVocabularyRecord(
  records: VocabularyRecord[],
  id: string,
  result: VocabularyReviewResult,
  now = Date.now(),
) {
  const index = records.findIndex(record => record.id === id)
  if (index < 0)
    return records

  const record = records[index]
  const currentLevel = clampInteger(record.learnedLevel, 0, 8, 0)
  let learnedLevel = currentLevel
  let reviewDelay = reviewIntervals[currentLevel]

  if (result === 'forgot') {
    learnedLevel = Math.max(0, currentLevel - 1)
    reviewDelay = 10 * minute
  }
  else if (result === 'hard') {
    reviewDelay = Math.max(day, Math.round(reviewIntervals[currentLevel] / 2))
  }
  else {
    learnedLevel = Math.min(8, currentLevel + 1)
    reviewDelay = reviewIntervals[learnedLevel]
  }

  const nextRecords = [...records]
  nextRecords[index] = {
    ...record,
    learnedLevel,
    reviewCount: (record.reviewCount ?? 0) + 1,
    lastReviewedAt: now,
    updatedAt: now,
    nextReviewAt: now + reviewDelay,
  }
  return nextRecords
}

export function getTodayRecommendations(records: VocabularyRecord[], dailyGoal: number, maxDifficulty: number) {
  const learnedIds = new Set(records.map(record => record.id))
  return getDailyRecommendations(dailyGoal, learnedIds, maxDifficulty)
}
