import type { FeatureScene, LexiSettings } from './types'

const emptyAiConnection = {
  endpoint: '',
  apiKey: '',
  model: '',
}

const promptDefaults: Record<FeatureScene, string> = {
  replacement: [
    '从网页文本中挑少量适合程序员英语学习的中文技术词，给出英文替换词。',
    '只返回 JSON：{"items":[{"original":"","replacement":"","meaning":"","example":"","tags":[],"difficulty":2}]}。',
    '不要解释，不要输出 Markdown。',
  ].join(' '),
  selection: [
    '把用户选中的文本翻译成目标语言，表达自然、简洁。',
    '只输出译文，不要 JSON、标题、解释、备选项或思考过程。',
  ].join(' '),
  daily: [
    '生成适合程序员日常学习的英语词汇建议。',
    '优先选择真实开发场景常见表达，保持简洁。',
  ].join(' '),
}

function createAiSceneConfig(scene: FeatureScene) {
  return {
    enabled: false,
    ...emptyAiConnection,
    prompt: promptDefaults[scene],
  }
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
    sceneRules: [],
    specialProfiles: [
      {
        id: 'x-twitter',
        label: 'X / Twitter',
        kind: 'social-feed',
        domains: ['x.com', 'twitter.com'],
        enabled: true,
        replacement: true,
        selection: true,
        dynamicScan: true,
        conservative: true,
        examSafe: false,
        maxPerPage: 8,
        density: 0.1,
      },
      {
        id: 'discourse',
        label: 'Discourse 论坛',
        kind: 'forum-feed',
        domains: ['discourse.org'],
        enabled: true,
        replacement: true,
        selection: true,
        dynamicScan: true,
        conservative: true,
        examSafe: false,
        maxPerPage: 10,
        density: 0.09,
      },
      {
        id: 'chaoxing',
        label: '学习通',
        kind: 'learning-exam',
        domains: ['chaoxing.com', 'xuexitong.com', 'mooc1.chaoxing.com'],
        enabled: false,
        replacement: false,
        selection: false,
        dynamicScan: false,
        conservative: true,
        examSafe: true,
        maxPerPage: 0,
        density: 0,
      },
      {
        id: 'yuketang',
        label: '雨课堂',
        kind: 'learning-exam',
        domains: ['yuketang.cn', 'yuketang.com'],
        enabled: false,
        replacement: false,
        selection: false,
        dynamicScan: false,
        conservative: true,
        examSafe: true,
        maxPerPage: 0,
        density: 0,
      },
    ],
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
    requireModifierKey: true,
    translationDirection: 'auto',
  },
  study: {
    dailyGoal: 8,
    programmerMode: true,
  },
  history: {
    enabled: true,
    maxRecords: 500,
  },
  ui: {
    showFloatingStatus: false,
    dialogShortcut: 'mod+k',
    customCss: '',
  },
  ai: {
    global: { ...emptyAiConnection },
    replacement: createAiSceneConfig('replacement'),
    selection: createAiSceneConfig('selection'),
    daily: createAiSceneConfig('daily'),
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
      sceneRules: value?.siteRules?.sceneRules ?? defaultSettings.siteRules.sceneRules,
      specialProfiles: value?.siteRules?.specialProfiles ?? defaultSettings.siteRules.specialProfiles,
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
    history: {
      ...defaultSettings.history,
      ...value?.history,
    },
    ui: {
      ...defaultSettings.ui,
      ...value?.ui,
    },
    ai: {
      global: {
        ...defaultSettings.ai.global,
        ...value?.ai?.global,
      },
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
