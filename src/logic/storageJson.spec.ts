import { describe, expect, it } from 'vitest'
import { readJsonValue, toStoredJson } from './storageJson'

describe('storage JSON compatibility', () => {
  const fallback = { enabled: false }

  it('reads values stored as JSON strings', () => {
    expect(readJsonValue('{"enabled":true}', fallback)).toEqual({ enabled: true })
  })

  it('reads values stored as structured browser storage objects', () => {
    const stored = { enabled: true }
    expect(readJsonValue(stored, fallback)).toBe(stored)
  })

  it('uses the fallback for missing or invalid JSON values', () => {
    expect(readJsonValue(undefined, fallback)).toBe(fallback)
    expect(readJsonValue('{invalid', fallback)).toBe(fallback)
  })

  it('keeps the existing serialized storage format', () => {
    expect(toStoredJson({ enabled: true })).toBe('{"enabled":true}')
  })
})
