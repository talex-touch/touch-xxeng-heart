import { getDailyRecommendations } from './vocabularyBank'
import type { RecordVocabularyRequest, VocabularyCandidate, VocabularyRecord } from './types'

const day = 24 * 60 * 60 * 1000
const maxTextLength = 600
const maxContextLength = 1200
const maxTagLength = 32
const maxTags = 12
const productVocabularyTags = new Set(['product', 'product-name', 'brand', 'tool', 'platform', 'service'])

export function hasVocabularyTag(candidate: Pick<VocabularyCandidate, 'tags'>, tags: Iterable<string>) {
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

export function createRecord(request: RecordVocabularyRequest, now = Date.now()): VocabularyRecord {
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

    const selectedCount = record.selectedCount + (request.source === 'manual' ? 1 : 0)
    const seenCount = record.seenCount + (request.source === 'auto' ? 1 : 0)
    const learnedLevel = Math.min(8, record.learnedLevel + (request.source === 'manual' ? 1 : 0))

    return {
      ...record,
      ...request.candidate,
      source: request.source === 'manual' ? 'manual' : record.source,
      pageUrl: request.pageUrl ?? record.pageUrl,
      pageTitle: request.pageTitle ?? record.pageTitle,
      context: request.context ?? record.context,
      selectedCount,
      seenCount,
      learnedLevel,
      updatedAt: now,
      nextReviewAt: now + Math.max(1, learnedLevel + 1) * day,
    }
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

export function getProgressDifficulty(records: VocabularyRecord[], baseDifficulty: number) {
  const reviewed = records.filter(record => record.selectedCount > 0 || record.learnedLevel > 0).length
  const levelBonus = Math.min(3, Math.floor(reviewed / 12))
  return Math.min(5, baseDifficulty + levelBonus)
}

export function getDueRecords(records: VocabularyRecord[], now = Date.now()) {
  return records
    .filter(record => record.nextReviewAt <= now)
    .sort((a, b) => a.nextReviewAt - b.nextReviewAt)
}

export function getTodayRecommendations(records: VocabularyRecord[], dailyGoal: number, maxDifficulty: number) {
  const learnedIds = new Set(records.map(record => record.id))
  return getDailyRecommendations(dailyGoal, learnedIds, maxDifficulty)
}
