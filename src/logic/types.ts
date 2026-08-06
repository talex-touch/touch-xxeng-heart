import type { AiProtocol } from './providers'

export type FeatureScene = 'replacement' | 'selection' | 'daily' | 'digest' | 'omni'
export type TranslationDirection = 'auto' | 'zh-to-en' | 'en-to-zh'

export type { AiProtocol }

export interface AiConnectionConfig {
  endpoint: string
  apiKey: string
  model: string
}

export interface AiProviderConfig extends AiConnectionConfig {
  id: string
  label: string
  enabled: boolean
  /** Wire format; `auto` is resolved from the endpoint and model at request time. */
  protocol: AiProtocol
  priority: number
  delayMs: number
  updatedAt: number
}

/** Scenes own their prompt and pick providers; the connection lives on the provider. */
export interface AiSceneConfig {
  enabled: boolean
  prompt: string
  providerIds: string[]
}

export type AiSettings = Record<FeatureScene, AiSceneConfig> & {
  providers: AiProviderConfig[]
  approvedHttpEndpoints: string[]
}

export interface AiTestResult {
  ok: boolean
  request: {
    endpoint: string
    protocol: AiProtocol
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

export type PageTranslationScope = 'url' | 'site' | 'regex'

export interface PageTranslationSettings {
  scope: PageTranslationScope
  regex: string
  maxBlocksPerPage: number
  maxBlocksPerSite: number
  prefetchBlocks: number
  batchSize: number
  cacheDays: number
}

export interface PageTranslationActivation {
  enabled: boolean
  scope: PageTranslationScope
  url: string
  host: string
  regex: string
  updatedAt: number
}

export interface PageTranslationBlock {
  id: string
  source: string
  translation: string
  priority?: 'viewport' | 'near' | 'prefetch'
  updatedAt?: number
}

export interface PageTranslationCache {
  url: string
  title: string
  host: string
  enabled: boolean
  blocks: PageTranslationBlock[]
  updatedAt: number
}

export interface PageTranslationMemoryEntry extends PageTranslationBlock {
  url: string
  host: string
  direction: TranslationDirection
  updatedAt: number
}

export type PageTranslationMemory = Record<string, PageTranslationMemoryEntry>

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
  digest: boolean
  omni: boolean
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
  /** Configured density before the per-level taper, 0.01 - 0.35. */
  density: number
  minTextLength: number
  maxPerPage: number
  /** Learner level 1-9; drives both the word difficulty window and the density taper. */
  level: number
}

export interface SelectionSettings {
  enabled: boolean
  autoTranslate: boolean
  requireModifierKey: boolean
  translationDirection: TranslationDirection
  pageTranslation: PageTranslationSettings
}

export interface StudySettings {
  dailyGoal: number
  programmerMode: boolean
}

export interface HistorySettings {
  enabled: boolean
  /** Vocabulary ceiling; older entries are dropped once the list passes it. */
  maxRecords: number
}

export interface SyncSettings {
  enabled: boolean
  /** API keys leave the device when this is on; the options page spells that out. */
  includeApiKeys: boolean
  lastSyncedAt: number
  lastPulledAt: number
  lastError: string
}

export interface UiSettings {
  showFloatingStatus: boolean
  dialogShortcut: string
  mediaModifierShortcut: string
  customCss: string
}

export interface ContentDigestSettings {
  enabled: boolean
  autoGenerate: boolean
  autoDelaySeconds: number
  allowNsfw: boolean
  cacheDays: number
}

export type ContentPlatform = 'reddit' | 'x' | 'youtube' | 'bilibili' | 'xiaohongshu' | 'zhihu'
export type ContentDocumentType = 'discussion' | 'social-post' | 'video' | 'article'
export type ContentBlockKind = 'body' | 'reply' | 'transcript' | 'metadata'
export type ContentCompleteness = 'complete' | 'partial' | 'metadata-only'

export interface ContentBlock {
  id: string
  kind: ContentBlockKind
  text: string
  author?: string
  timestamp?: string
  score?: number
}

export interface ContentDocument {
  platform: ContentPlatform
  contentType: ContentDocumentType
  canonicalId: string
  canonicalUrl: string
  title: string
  author?: string
  publishedAt?: string
  language?: string
  blocks: ContentBlock[]
  completeness: ContentCompleteness
  coverage: string
  limitations: string[]
  nsfw: boolean
  sourceHash: string
}

export interface ContentDigestResult {
  oneLine: string
  summary: string[]
  keyPoints: string[]
  viewpoints: string[]
  actions: string[]
  terms: string[]
  coverage: string
}

export interface ContentDigestCacheEntry {
  platform: ContentPlatform
  contentType: ContentDocumentType
  canonicalId: string
  canonicalUrl: string
  title: string
  digest: ContentDigestResult
  sourceHash: string
  templateVersion: number
  modelFingerprint: string
  updatedAt: number
  lastAccessedAt: number
}

export type ContentDigestCache = Record<string, ContentDigestCacheEntry>

export interface GitHubDigestSettings {
  enabled: boolean
  autoGenerate: boolean
  autoDelaySeconds: number
  allowPrivateAutoGenerate: boolean
  cacheDays: number
}

export interface ForumDigestSettings {
  enabled: boolean
  autoGenerate: boolean
  autoDelaySeconds: number
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
  owner?: string
  name?: string
  description?: string
  topics: string[]
  languages: string[]
  quickDigest?: GitHubDigestResult
  digest?: GitHubDigestResult
  sourceHash: string
  updatedAt: number
}

export type GitHubDigestCache = Record<string, GitHubDigestCacheEntry>

export interface ForumDigestInfo {
  key: string
  host: string
  title: string
  author?: string
  category?: string
  tags: string[]
  posts: string[]
  pageText: string
  url: string
  sourceHash: string
}

export interface ForumDigestResult {
  oneLine: string
  summary: string[]
  keyPoints: string[]
  terms: string[]
  sentiment?: string
}

export interface ForumDigestCacheVersion {
  sourceHash: string
  digest: ForumDigestResult
  createdAt: number
}

export interface ForumDigestCacheEntry {
  host: string
  title: string
  url: string
  digest: ForumDigestResult
  sourceHash: string
  updatedAt: number
  history: ForumDigestCacheVersion[]
}

export type ForumDigestCache = Record<string, ForumDigestCacheEntry>

export interface LexiSettings {
  siteRules: SiteRules
  replacement: ReplacementSettings
  selection: SelectionSettings
  study: StudySettings
  history: HistorySettings
  ui: UiSettings
  contentDigest: ContentDigestSettings
  githubDigest: GitHubDigestSettings
  forumDigest: ForumDigestSettings
  ai: AiSettings
  sync: SyncSettings
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
  reviewCount?: number
  lastReviewedAt?: number
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
