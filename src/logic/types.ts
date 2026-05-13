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

export interface PageTranslationBlock {
  id: string
  source: string
  translation: string
}

export interface PageTranslationCache {
  url: string
  title: string
  enabled: boolean
  blocks: PageTranslationBlock[]
  updatedAt: number
}

export interface SiteRules {
  enabled: boolean
  mode: 'all' | 'allowlist' | 'blocklist'
  domains: string[]
  sceneRules: SiteSceneRule[]
  specialProfiles: SpecialSiteProfile[]
}

export interface SiteSceneRule {
  domain: string
  replacement: boolean
  selection: boolean
  daily: boolean
}

export type SpecialSiteKind = 'social-feed' | 'forum-feed' | 'learning-exam' | 'custom'

export interface SpecialSiteProfile {
  id: string
  label: string
  kind: SpecialSiteKind
  domains: string[]
  enabled: boolean
  replacement: boolean
  selection: boolean
  dynamicScan: boolean
  conservative: boolean
  examSafe: boolean
  maxPerPage?: number
  density?: number
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
  requireModifierKey: boolean
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
  dialogShortcut: string
  customCss: string
}

export interface GitHubDigestSettings {
  enabled: boolean
  autoGenerate: boolean
  autoDelaySeconds: number
  allowPrivateAutoGenerate: boolean
  cacheDays: number
}

export interface GitHubDigestResult {
  oneLine: string
  details?: string
  audience: string[]
  techStack: string[]
  startHere: string[]
  terms: string[]
}

export interface GitHubDigestCacheEntry {
  repo: string
  description?: string
  topics: string[]
  languages: string[]
  quickDigest?: GitHubDigestResult
  digest?: GitHubDigestResult
  sourceHash: string
  updatedAt: number
}

export type GitHubDigestCache = Record<string, GitHubDigestCacheEntry>

export interface LexiSettings {
  siteRules: SiteRules
  replacement: ReplacementSettings
  selection: SelectionSettings
  study: StudySettings
  history: HistorySettings
  ui: UiSettings
  githubDigest: GitHubDigestSettings
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
