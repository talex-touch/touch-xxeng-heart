import { describe, expect, it } from 'vitest'
import { programmerVocabulary } from './vocabularyBank'
import { getDueRecords, getProgressDifficulty, getTodayRecommendations, getTodayReviewCount, isProductVocabularyCandidate, normalizeImportedRecord, reviewVocabularyRecord, upsertVocabularyRecord } from './vocabularyRecords'

describe('vocabulary records', () => {
  it('creates and updates records by original and replacement', () => {
    const candidate = programmerVocabulary[0]
    const records = upsertVocabularyRecord([], {
      candidate,
      source: 'auto',
      pageUrl: 'https://example.com',
      pageTitle: 'Example',
      context: '上下文信息',
    }, 100)

    expect(records).toHaveLength(1)
    expect(records[0].seenCount).toBe(1)

    const updated = upsertVocabularyRecord(records, {
      candidate,
      source: 'manual',
    }, 200)

    expect(updated).toHaveLength(1)
    expect(updated[0].selectedCount).toBe(1)
    expect(updated[0].learnedLevel).toBe(1)
  })

  it('raises effective difficulty with learning history', () => {
    const records = programmerVocabulary.slice(0, 12).map((candidate, index) => ({
      ...upsertVocabularyRecord([], { candidate, source: 'manual' }, index)[0],
      selectedCount: 1,
    }))

    expect(getProgressDifficulty(records, 2)).toBe(3)
  })

  it('prefers unseen daily recommendations', () => {
    const learned = upsertVocabularyRecord([], {
      candidate: programmerVocabulary[0],
      source: 'manual',
    })

    const recommendations = getTodayRecommendations(learned, 4, 2)

    expect(recommendations).toHaveLength(4)
    expect(recommendations[0].original).not.toBe(programmerVocabulary[0].original)
  })

  it('normalizes imported records and rejects invalid rows', () => {
    expect(normalizeImportedRecord(null)).toBeUndefined()
    expect(normalizeImportedRecord({ original: '', replacement: 'context' })).toBeUndefined()

    const record = normalizeImportedRecord({
      original: '  上下文  ',
      replacement: ' Context ',
      meaning: 'A'.repeat(800),
      tags: [' Technical Term ', 'Technical Term', 123],
      difficulty: 99,
      source: 'unknown',
      seenCount: -1,
      selectedCount: 2.8,
      learnedLevel: 99,
      createdAt: -1,
    }, 1000)

    expect(record).toMatchObject({
      id: '上下文:context',
      original: '上下文',
      replacement: 'Context',
      tags: ['technical-term'],
      difficulty: 5,
      source: 'manual',
      seenCount: 0,
      selectedCount: 2,
      learnedLevel: 8,
      createdAt: 1000,
    })
    expect(record?.meaning).toHaveLength(600)
  })

  it('detects product vocabulary tags', () => {
    expect(isProductVocabularyCandidate({ tags: ['ai', 'Product'] })).toBe(true)
    expect(isProductVocabularyCandidate({ tags: ['technical'] })).toBe(false)
  })
})

describe('vocabulary review', () => {
  const minute = 60 * 1000
  const day = 24 * 60 * minute
  const now = new Date(2026, 6, 18, 14, 0, 0).getTime()

  function reviewableRecord(index: number, learnedLevel = 3, reviewCount = 0) {
    const record = upsertVocabularyRecord([], {
      candidate: programmerVocabulary[index],
      source: 'manual',
    }, now - day)[0]

    return { ...record, learnedLevel, reviewCount }
  }

  it('maps forgot, hard, and remembered feedback to distinct progression and review intervals', () => {
    const record = reviewableRecord(0, 3, 4)
    const forgot = reviewVocabularyRecord([record], record.id, 'forgot', now)[0]
    const hard = reviewVocabularyRecord([record], record.id, 'hard', now)[0]
    const remembered = reviewVocabularyRecord([record], record.id, 'remembered', now)[0]

    expect(forgot).toMatchObject({ learnedLevel: 2, reviewCount: 5, lastReviewedAt: now })
    expect(forgot.nextReviewAt).toBe(now + 10 * minute)
    expect(hard).toMatchObject({ learnedLevel: 3, reviewCount: 5, lastReviewedAt: now })
    expect(hard.nextReviewAt).toBeGreaterThanOrEqual(now + day)
    expect(remembered).toMatchObject({ learnedLevel: 4, reviewCount: 5, lastReviewedAt: now })
    expect(remembered.nextReviewAt).toBeGreaterThan(hard.nextReviewAt)
  })

  it('keeps review levels within the supported range', () => {
    const lowest = reviewableRecord(0, 0)
    const highest = reviewableRecord(1, 8)

    const afterForgot = reviewVocabularyRecord([lowest], lowest.id, 'forgot', now)[0]
    const afterRemembered = reviewVocabularyRecord([highest], highest.id, 'remembered', now)[0]

    expect(afterForgot.learnedLevel).toBe(0)
    expect(afterForgot.nextReviewAt).toBe(now + 10 * minute)
    expect(afterRemembered.learnedLevel).toBe(8)
    expect(afterRemembered.nextReviewAt).toBeGreaterThan(now + day)
  })

  it('makes a forgotten record due exactly after its retry interval', () => {
    const record = reviewableRecord(0)
    const reviewed = reviewVocabularyRecord([record], record.id, 'forgot', now)

    expect(getDueRecords(reviewed, now + 10 * minute - 1)).toEqual([])
    expect(getDueRecords(reviewed, now + 10 * minute)).toEqual([reviewed[0]])
  })

  it('counts each vocabulary record once when it was reviewed today', () => {
    const repeated = reviewableRecord(0)
    const reviewedTwice = reviewVocabularyRecord(
      reviewVocabularyRecord([repeated], repeated.id, 'hard', now - minute),
      repeated.id,
      'remembered',
      now,
    )[0]
    const todayRecord = reviewableRecord(1)
    const yesterdayRecord = reviewableRecord(2)
    const reviewedToday = reviewVocabularyRecord([todayRecord], todayRecord.id, 'hard', now)[0]
    const reviewedYesterday = reviewVocabularyRecord([yesterdayRecord], yesterdayRecord.id, 'hard', now - day)[0]

    expect(reviewedTwice.reviewCount).toBe(2)
    expect(getTodayReviewCount([reviewedTwice, reviewedToday, reviewedYesterday], now)).toBe(2)
  })

  it('returns the original array for an unknown vocabulary id', () => {
    const records = [reviewableRecord(0)]

    expect(reviewVocabularyRecord(records, 'missing:id', 'remembered', now)).toBe(records)
  })
})
