import { normalizeImportedRecord } from './vocabularyRecords'
import type { VocabularyRecord } from './types'

export const maxImportBytes = 8 * 1024 * 1024

export interface VocabularyImportResult {
  records: VocabularyRecord[]
  imported: number
  skipped: number
}

/**
 * Merges an exported file into the current list, newest first, capped at the configured
 * vocabulary ceiling. Records are keyed by term, so re-importing a backup updates in place
 * instead of duplicating.
 */
export function mergeImportedRecords(current: VocabularyRecord[], value: unknown, limit: number): VocabularyImportResult {
  if (!Array.isArray(value))
    throw new Error('导入文件不是词库数组')

  const normalized = value
    .map(record => normalizeImportedRecord(record))
    .filter((record): record is VocabularyRecord => Boolean(record))

  const merged = new Map(current.map(record => [record.id, record]))
  for (const record of normalized)
    merged.set(record.id, record)

  return {
    records: [...merged.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, Math.max(1, limit)),
    imported: normalized.length,
    skipped: value.length - normalized.length,
  }
}

export function exportVocabularyRecords(records: VocabularyRecord[], fileName = `lexi-vocabulary-${new Date().toISOString().slice(0, 10)}.json`) {
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export async function importVocabularyRecords(file: File, current: VocabularyRecord[], limit: number) {
  if (file.size > maxImportBytes)
    throw new Error('导入文件过大，请控制在 8 MB 以内')

  return mergeImportedRecords(current, JSON.parse(await file.text()), limit)
}
