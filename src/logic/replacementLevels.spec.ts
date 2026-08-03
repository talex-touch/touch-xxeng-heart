import { describe, expect, it } from 'vitest'
import {
  densityTiers,
  formatDensityPercent,
  getDifficultyWindow,
  getEffectiveDensity,
  maxReplacementLevel,
  minReplacementLevel,
  replacementLevels,
  resolveDensityTier,
  resolveReplacementLevel,
} from './replacementLevels'

describe('replacement levels', () => {
  it('exposes one preset per level, ordered 1-9', () => {
    expect(replacementLevels).toHaveLength(maxReplacementLevel)
    expect(replacementLevels.map(preset => preset.level))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('moves the difficulty window towards rarer words as the level rises', () => {
    const windows = replacementLevels.map(preset => getDifficultyWindow(preset.level))

    for (let index = 1; index < windows.length; index += 1) {
      expect(windows[index].min).toBeGreaterThanOrEqual(windows[index - 1].min)
      expect(windows[index].max).toBeGreaterThanOrEqual(windows[index - 1].max)
    }

    expect(windows[0]).toEqual({ min: 1, max: 1 })
    expect(windows[windows.length - 1].min).toBeGreaterThan(1)
  })

  it('tapers density hardest at low levels, where common words match everywhere', () => {
    const scales = replacementLevels.map(preset => preset.densityScale)

    for (let index = 1; index < scales.length; index += 1)
      expect(scales[index]).toBeGreaterThanOrEqual(scales[index - 1])

    expect(scales[0]).toBeLessThan(1)
    expect(scales[scales.length - 1]).toBe(1)
  })

  it('clamps levels outside 1-9 instead of returning undefined presets', () => {
    expect(resolveReplacementLevel(0).level).toBe(minReplacementLevel)
    expect(resolveReplacementLevel(42).level).toBe(maxReplacementLevel)
    expect(resolveReplacementLevel(Number.NaN).level).toBe(5)
  })

  it('applies the level taper to the configured density', () => {
    const balanced = densityTiers[2].value

    expect(getEffectiveDensity({ density: balanced, level: 9 })).toBeCloseTo(balanced)
    expect(getEffectiveDensity({ density: balanced, level: 1 })).toBeCloseTo(balanced * 0.4)
  })

  it('resolves any stored density to the nearest named tier', () => {
    expect(resolveDensityTier(densityTiers[3].value).id).toBe('dense')
    // 0.12 is the density shipped before the tiers existed.
    expect(resolveDensityTier(0.12).id).toBe('light')
    expect(resolveDensityTier(9).id).toBe('intense')
  })

  it('keeps one decimal for sub-percent densities so a taper never reads as 0%', () => {
    expect(formatDensityPercent(0.004)).toBe('0.4%')
    expect(formatDensityPercent(0.17)).toBe('17%')
  })
})
