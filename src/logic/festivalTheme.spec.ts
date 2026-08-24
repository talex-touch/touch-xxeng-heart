// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { resolveFestivalTheme } from './festivalTheme'

describe('resolveFestivalTheme', () => {
  it('keeps an explicit preference over the automatic seasonal theme', () => {
    expect(resolveFestivalTheme(new Date(2026, 1, 17), 'halloween')).toBe('halloween')
  })

  it.each([
    ['before Valentine window', new Date(2033, 1, 9), 'default'],
    ['at Valentine window start', new Date(2033, 1, 10), 'valentine'],
    ['at Valentine window end', new Date(2033, 1, 16), 'valentine'],
    ['after Valentine window', new Date(2033, 1, 17), 'default'],
    ['before Halloween window', new Date(2033, 9, 23), 'default'],
    ['at Halloween window start', new Date(2033, 9, 24), 'halloween'],
    ['at Halloween window end', new Date(2033, 10, 1), 'halloween'],
    ['after Halloween window', new Date(2033, 10, 2), 'default'],
  ])('resolves the correct theme $0', (_name, date, expected) => {
    expect(resolveFestivalTheme(date)).toBe(expected)
  })

  it.each([
    ['seven days before Lunar New Year', new Date(2026, 1, 10), 'spring'],
    ['on Lunar New Year', new Date(2026, 1, 17), 'spring'],
    ['seven days after Lunar New Year', new Date(2026, 1, 24), 'spring'],
    ['outside the Lunar New Year window', new Date(2026, 1, 25), 'default'],
    ['an unlisted Lunar New Year', new Date(2033, 0, 1), 'default'],
  ])('resolves $0', (_name, date, expected) => {
    expect(resolveFestivalTheme(date)).toBe(expected)
  })
})
