import { describe, expect, it } from 'vitest'
import { estimateStorageBytes, formatBytes, formatDuration, formatPercent, toPercent } from './format'

describe('formatBytes', () => {
  it('reports sub-kilobyte sizes in bytes', () => {
    // The three copies this replaces printed "0.3 KB" for 300 bytes.
    expect(formatBytes(300)).toBe('300 B')
    expect(formatBytes(0)).toBe('0 B')
  })

  it('switches to KB and MB at the right thresholds', () => {
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB')
  })

  it('does not render NaN for missing values', () => {
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
  })
})

describe('estimateStorageBytes', () => {
  it('measures serialized size', () => {
    expect(estimateStorageBytes({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length)
  })

  it('survives circular structures instead of throwing', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(estimateStorageBytes(circular)).toBe(0)
  })
})

describe('formatPercent / toPercent', () => {
  it('formats ratios', () => {
    expect(formatPercent(0.256)).toBe('26%')
    expect(formatPercent(0.256, 1)).toBe('25.6%')
  })

  it('falls back to zero for non-numbers', () => {
    expect(formatPercent(undefined)).toBe('0%')
    expect(toPercent(undefined)).toBe(0)
  })

  it('rounds to whole percents', () => {
    expect(toPercent(0.07)).toBe(7)
  })
})

describe('formatDuration', () => {
  it('scales through minutes, hours and days', () => {
    expect(formatDuration(5 * 60000)).toBe('5 分钟')
    expect(formatDuration(3 * 3600000)).toBe('3 小时')
    expect(formatDuration(3 * 86400000)).toBe('3 天')
  })

  it('treats past or missing deadlines as now', () => {
    expect(formatDuration(-1)).toBe('现在')
    expect(formatDuration(undefined)).toBe('现在')
  })
})
