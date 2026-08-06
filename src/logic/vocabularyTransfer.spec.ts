import { describe, expect, it } from 'vitest'
import { mergeImportedRecords } from './vocabularyTransfer'
import { normalizeImportedRecord } from './vocabularyRecords'
import type { VocabularyRecord } from './types'

function createRecord(original: string, updatedAt: number, replacement = original.toUpperCase()) {
  return normalizeImportedRecord({ original, replacement, updatedAt, createdAt: updatedAt }) as VocabularyRecord
}

describe('vocabulary import', () => {
  it('rejects a file that is not a record array', () => {
    expect(() => mergeImportedRecords([], { records: [] }, 100)).toThrow(/词库数组/)
  })

  it('updates a known term in place and counts skipped rows', () => {
    const current = [createRecord('缓存', 1000, 'cache')]
    const result = mergeImportedRecords(current, [
      { original: '缓存', replacement: 'cache', meaning: '存储副本', updatedAt: 2000 },
      { original: '', replacement: 'broken' },
    ], 100)

    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.records).toHaveLength(1)
    expect(result.records[0].meaning).toBe('存储副本')
  })

  it('keeps the newest records when the merge passes the ceiling', () => {
    const current = [createRecord('旧词', 1000)]
    const result = mergeImportedRecords(current, [
      { original: '新词', replacement: 'new', updatedAt: 3000 },
      { original: '中词', replacement: 'mid', updatedAt: 2000 },
    ], 2)

    expect(result.records.map(record => record.original)).toEqual(['新词', '中词'])
  })
})
