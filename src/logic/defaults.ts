import type { FeatureScene, LexiSettings } from './types'

const disabledAi = {
  enabled: false,
  endpoint: '',
  apiKey: '',
  model: '',
}

export const featureLabels: Record<FeatureScene, string> = {
  replacement: '网页词汇替换',
  selection: '划词翻译',
  daily: '每日推荐',
}

export const defaultSettings: LexiSettings = {
  siteRules: {
    enabled: true,
    mode: 'all',
    domains: [],
  },
  replacement: {
    enabled: true,
    density: 0.12,
    minTextLength: 18,
    maxPerPage: 18,
    difficulty: 2,
  },
  selection: {
    enabled: true,
    autoTranslate: true,
  },
  study: {
    dailyGoal: 8,
    programmerMode: true,
  },
  ui: {
    showFloatingStatus: true,
  },
  ai: {
    replacement: { ...disabledAi },
    selection: { ...disabledAi },
    daily: { ...disabledAi },
  },
}

export function mergeSettings(value?: Partial<LexiSettings>): LexiSettings {
  return {
    ...defaultSettings,
    ...value,
    siteRules: {
      ...defaultSettings.siteRules,
      ...value?.siteRules,
      domains: value?.siteRules?.domains ?? defaultSettings.siteRules.domains,
    },
    replacement: {
      ...defaultSettings.replacement,
      ...value?.replacement,
    },
    selection: {
      ...defaultSettings.selection,
      ...value?.selection,
    },
    study: {
      ...defaultSettings.study,
      ...value?.study,
    },
    ui: {
      ...defaultSettings.ui,
      ...value?.ui,
    },
    ai: {
      replacement: {
        ...defaultSettings.ai.replacement,
        ...value?.ai?.replacement,
      },
      selection: {
        ...defaultSettings.ai.selection,
        ...value?.ai?.selection,
      },
      daily: {
        ...defaultSettings.ai.daily,
        ...value?.ai?.daily,
      },
    },
  }
}
