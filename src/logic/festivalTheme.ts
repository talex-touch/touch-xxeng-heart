import type { FestivalTheme, FestivalThemePreference } from './types'

export const festivalThemeOptions: Array<{ value: FestivalThemePreference, label: string }> = [
  { value: 'auto', label: '跟随节日' },
  { value: 'default', label: '默认外观' },
  { value: 'spring', label: '春节' },
  { value: 'valentine', label: '情人节' },
  { value: 'halloween', label: '万圣节' },
]

export const festivalThemeDetails: Record<FestivalTheme, { label: string, mark: string, description: string }> = {
  default: { label: '默认外观', mark: '', description: '保持 Lexi 的标准阅读界面。' },
  spring: { label: '春节', mark: '春', description: '新春阅读计划，今天也积累一个新词。' },
  valentine: { label: '情人节', mark: '心', description: '把每一次阅读，变成值得收藏的相遇。' },
  halloween: { label: '万圣节', mark: '夜', description: '点亮夜读模式，发现藏在网页里的词汇。' },
}

const lunarNewYearDates: Record<number, readonly [number, number]> = {
  2025: [1, 29],
  2026: [2, 17],
  2027: [2, 6],
  2028: [1, 26],
  2029: [2, 13],
  2030: [2, 3],
  2031: [1, 23],
  2032: [2, 11],
}

function localDayValue(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
}

function dateInWindow(date: Date, start: Date, beforeDays: number, afterDays: number) {
  const delta = (localDayValue(date) - localDayValue(start)) / 86_400_000
  return delta >= -beforeDays && delta <= afterDays
}

function resolveAutomaticFestivalTheme(date: Date): FestivalTheme {
  const lunarNewYear = lunarNewYearDates[date.getFullYear()]
  if (lunarNewYear && dateInWindow(date, new Date(date.getFullYear(), lunarNewYear[0] - 1, lunarNewYear[1]), 7, 7))
    return 'spring'

  const month = date.getMonth() + 1
  const day = date.getDate()
  if (month === 2 && day >= 10 && day <= 16)
    return 'valentine'
  if ((month === 10 && day >= 24) || (month === 11 && day === 1))
    return 'halloween'

  return 'default'
}

export function normalizeFestivalThemePreference(value: unknown): FestivalThemePreference {
  return value === 'default' || value === 'spring' || value === 'valentine' || value === 'halloween'
    ? value
    : 'auto'
}

export function resolveFestivalTheme(date = new Date(), preference: FestivalThemePreference = 'auto'): FestivalTheme {
  const normalized = normalizeFestivalThemePreference(preference)
  return normalized === 'auto' ? resolveAutomaticFestivalTheme(date) : normalized
}
