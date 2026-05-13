import { describe, expect, it } from 'vitest'
import { programmerVocabulary } from './vocabularyBank'
import { getProgressDifficulty, getTodayRecommendations, isProductVocabularyCandidate, normalizeImportedRecord, upsertVocabularyRecord } from './vocabularyRecords'

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
