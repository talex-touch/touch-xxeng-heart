export type FeatureScene = 'replacement' | 'selection' | 'daily'
export type TranslationDirection = 'auto' | 'zh-to-en' | 'en-to-zh'

export interface AiConnectionConfig {
  endpoint: string
  apiKey: string
  model: string
}

export interface AiSceneConfig extends AiConnectionConfig {
  enabled: boolean
  prompt: string
}

export type AiSettings = Record<FeatureScene, AiSceneConfig> & {
  global: AiConnectionConfig
}

export interface AiTestResult {
  ok: boolean
  request: {
    endpoint: string
    model: string
    system: string
    user: string
    stream: boolean
    authSent: boolean
    keyHint?: string
  }
  response?: string
  status?: number
  durationMs: number
}

export interface AiCallLog {
  id: string
  scene: FeatureScene
  endpoint: string
  model: string
  authSent: boolean
  keyHint?: string
  streamed?: boolean
  ok: boolean
  status?: number
  error?: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  tokenEstimate?: boolean
  durationMs: number
  pageUrl?: string
  createdAt: number
}

export interface PageVisitLog {
  id: string
  url: string
  title: string
  host: string
  enabled: boolean
  replacements: number
  records: number
  createdAt: number
}

export interface SiteRules {
  enabled: boolean
  mode: 'all' | 'allowlist' | 'blocklist'
  domains: string[]
  sceneRules: SiteSceneRule[]
}

export interface SiteSceneRule {
  domain: string
  replacement: boolean
  selection: boolean
  daily: boolean
}

export interface ReplacementSettings {
  enabled: boolean
  density: number
  minTextLength: number
  maxPerPage: number
  difficulty: number
}

export interface SelectionSettings {
  enabled: boolean
  autoTranslate: boolean
  translationDirection: TranslationDirection
}

export interface StudySettings {
  dailyGoal: number
  programmerMode: boolean
}

export interface HistorySettings {
  enabled: boolean
  maxRecords: number
}

export interface UiSettings {
  showFloatingStatus: boolean
  customCss: string
}

export interface LexiSettings {
  siteRules: SiteRules
  replacement: ReplacementSettings
  selection: SelectionSettings
  study: StudySettings
  history: HistorySettings
  ui: UiSettings
  ai: AiSettings
}

export interface VocabularyCandidate {
  original: string
  replacement: string
  pronunciation?: string
  meaning: string
  example: string
  tags: string[]
  difficulty: number
}

export interface VocabularyRecord extends VocabularyCandidate {
  id: string
  source: 'auto' | 'manual' | 'daily'
  pageUrl?: string
  pageTitle?: string
  context?: string
  seenCount: number
  selectedCount: number
  learnedLevel: number
  createdAt: number
  updatedAt: number
  nextReviewAt: number
}

export interface SelectionTranslation {
  original: string
  translation: string
  explanation: string
  source: 'local' | 'ai'
  candidate?: VocabularyCandidate
}

export interface ReplacementRequest {
  text: string
  pageUrl: string
  pageTitle: string
  settings: LexiSettings
}

export interface TranslationRequest {
  text: string
  context: string
  pageUrl: string
  settings: LexiSettings
}

export interface RecordVocabularyRequest {
  candidate: VocabularyCandidate
  source: VocabularyRecord['source']
  pageUrl?: string
  pageTitle?: string
  context?: string
}
