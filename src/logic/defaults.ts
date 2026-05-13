import type { FeatureScene, LexiSettings } from './types'

const emptyAiConnection = {
  endpoint: '',
  apiKey: '',
  model: '',
}

const promptDefaults: Record<FeatureScene, string> = {
  replacement: [
    '从网页文本中提取少量适合程序员英语学习的词库项。',
    '中文技术词给出自然英文替换词。',
    '产品、品牌、模型、平台、库、框架、CLI 或服务名（如 Codex、ChatGPT、Claude、GitHub Actions、Vite、React、Next.js）只记录知识，不翻译不改名；这类条目的 original 和 replacement 都使用页面里的原始名称，并在 tags 中加入 product。',
    '普通技术词在 tags 中加入 technical。',
    '只返回 JSON：{"items":[{"original":"","replacement":"","meaning":"","example":"","tags":["technical"],"difficulty":2}]}。',
    '不要解释，不要输出 Markdown。',
  ].join(' '),
  selection: [
    '把用户选中的文本翻译成目标语言，先结合上下文判断语气、意图和潜台词。',
    '译文要准确、自然、有人味，避免翻译腔；必要时重组句子，让目标语言读者觉得像真人会说的话。',
    '只输出最终译文，不要 JSON、标题、解释、备选项或思考过程。',
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
  githubDigest: {
    enabled: true,
    autoGenerate: true,
    autoDelaySeconds: 18,
    hoverGenerate: true,
    hoverDelayMs: 2500,
    allowPrivateAutoGenerate: false,
    cacheDays: 7,
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
    githubDigest: {
      ...defaultSettings.githubDigest,
      ...value?.githubDigest,
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
