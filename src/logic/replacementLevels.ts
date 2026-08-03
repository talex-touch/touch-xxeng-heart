import type { ReplacementSettings } from './types'

export interface ReplacementLevelPreset {
  level: number
  /** Full milestone shown next to the slider. */
  label: string
  /** Compact form for tight surfaces (popup tile, side panel header). */
  shortLabel: string
  /** Vocabulary size the milestone roughly implies. */
  scale: string
  /** What actually gets replaced at this level. */
  coverage: string
  /**
   * Word difficulty window on the vocabulary bank scale (1-5). Low levels use a
   * narrow window over the most common words, so a page hits them constantly.
   */
  minDifficulty: number
  maxDifficulty: number
  /**
   * Density multiplier. Common words match everywhere, so low levels would flood
   * the page at the same configured density; the taper keeps pages readable.
   */
  densityScale: number
}

export interface DensityTier {
  id: DensityTierId
  label: string
  value: number
  hint: string
}

export type DensityTierId = 'minimal' | 'light' | 'balanced' | 'dense' | 'intense'

export const minReplacementLevel = 1
export const maxReplacementLevel = 9
export const defaultReplacementLevel = 5
export const minReplacementDensity = 0.01
export const maxReplacementDensity = 0.35

export const replacementLevels: readonly ReplacementLevelPreset[] = [
  {
    level: 1,
    label: '零基础 / 小学',
    shortLabel: '零基础',
    scale: '约 800 词',
    coverage: '只替换最常见的基础词，几乎每段都会出现',
    minDifficulty: 1,
    maxDifficulty: 1,
    densityScale: 0.4,
  },
  {
    level: 2,
    label: '初中在读',
    shortLabel: '初中',
    scale: '约 1500 词',
    coverage: '常见基础词为主，替换仍然很密',
    minDifficulty: 1,
    maxDifficulty: 1,
    densityScale: 0.5,
  },
  {
    level: 3,
    label: '初中毕业（中考）',
    shortLabel: '中考',
    scale: '约 2000 词',
    coverage: '基础词 + 少量入门技术词',
    minDifficulty: 1,
    maxDifficulty: 2,
    densityScale: 0.6,
  },
  {
    level: 4,
    label: '高中毕业（高考）',
    shortLabel: '高考',
    scale: '约 3500 词',
    coverage: '基础词 + 常用技术词',
    minDifficulty: 1,
    maxDifficulty: 2,
    densityScale: 0.7,
  },
  {
    level: 5,
    label: '大学四级 CET-4 · 中等标准',
    shortLabel: 'CET-4',
    scale: '约 4500 词',
    coverage: '日常词到常规技术词，兼顾认识和陌生',
    minDifficulty: 1,
    maxDifficulty: 3,
    densityScale: 0.8,
  },
  {
    level: 6,
    label: '大学六级 CET-6',
    shortLabel: 'CET-6',
    scale: '约 6000 词',
    coverage: '跳过最简单的词，专注中高频技术词',
    minDifficulty: 2,
    maxDifficulty: 3,
    densityScale: 0.9,
  },
  {
    level: 7,
    label: '考研 / 雅思托福',
    shortLabel: '考研',
    scale: '约 8000 词',
    coverage: '中高频技术词 + 抽象表达',
    minDifficulty: 2,
    maxDifficulty: 4,
    densityScale: 1,
  },
  {
    level: 8,
    label: '专业八级 / 英文技术文档',
    shortLabel: '专八',
    scale: '约 10000 词',
    coverage: '只挑专业词和低频表达，替换明显变少',
    minDifficulty: 3,
    maxDifficulty: 5,
    densityScale: 1,
  },
  {
    level: 9,
    label: '母语级 / 论文与源码',
    shortLabel: '母语级',
    scale: '12000 词以上',
    coverage: '只保留最生僻的专业词，一页可能只替换几个',
    minDifficulty: 4,
    maxDifficulty: 5,
    densityScale: 1,
  },
]

export const densityTiers: readonly DensityTier[] = [
  { id: 'minimal', label: '极少', value: 0.01, hint: '一页只点几个词，几乎不打断阅读' },
  { id: 'light', label: '少', value: 0.09, hint: '偶尔遇到一个替换词' },
  { id: 'balanced', label: '适度', value: 0.17, hint: '推荐档位，读得下去也记得住' },
  { id: 'dense', label: '密集', value: 0.26, hint: '每段都会出现替换词' },
  { id: 'intense', label: '极度密集', value: 0.35, hint: '尽可能多替换，阅读成本明显上升' },
]

export function clampReplacementLevel(value: unknown) {
  const level = typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : defaultReplacementLevel

  return Math.min(maxReplacementLevel, Math.max(minReplacementLevel, level))
}

export function resolveReplacementLevel(value: unknown) {
  const level = clampReplacementLevel(value)
  return replacementLevels[level - 1]
}

/**
 * Settings before v0.2.5 stored a 1-5 word-difficulty ceiling. Map it onto the
 * level whose window ends at the same ceiling so existing users keep their feel.
 */
export function levelFromLegacyDifficulty(difficulty: unknown) {
  const legacy = typeof difficulty === 'number' && Number.isFinite(difficulty)
    ? Math.round(difficulty)
    : undefined

  if (legacy == null)
    return defaultReplacementLevel

  const byCeiling: Record<number, number> = { 1: 2, 2: 4, 3: 5, 4: 7, 5: 8 }
  return byCeiling[Math.min(5, Math.max(1, legacy))] ?? defaultReplacementLevel
}

export function clampReplacementDensity(value: unknown) {
  const density = typeof value === 'number' && Number.isFinite(value)
    ? value
    : densityTiers[2].value

  return Math.min(maxReplacementDensity, Math.max(minReplacementDensity, density))
}

export function resolveDensityTier(value: unknown) {
  const density = clampReplacementDensity(value)
  return densityTiers.reduce((closest, tier) => {
    return Math.abs(tier.value - density) < Math.abs(closest.value - density) ? tier : closest
  }, densityTiers[0])
}

export function getDifficultyWindow(level: unknown) {
  const preset = resolveReplacementLevel(level)
  return { min: preset.minDifficulty, max: preset.maxDifficulty }
}

/** Density actually handed to the page enhancer, after the per-level taper. */
export function getEffectiveDensity(replacement: Pick<ReplacementSettings, 'density' | 'level'>) {
  const preset = resolveReplacementLevel(replacement.level)
  return clampReplacementDensity(replacement.density) * preset.densityScale
}

export function formatDensityPercent(density: number) {
  const percent = density * 100
  return percent < 1 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`
}
