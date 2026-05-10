import { getDailyRecommendations } from './vocabularyBank'
import type { RecordVocabularyRequest, VocabularyRecord } from './types'

const day = 24 * 60 * 60 * 1000

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
