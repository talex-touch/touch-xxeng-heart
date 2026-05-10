export type FeatureScene = 'replacement' | 'selection' | 'daily'

export interface AiSceneConfig {
  enabled: boolean
  endpoint: string
  apiKey: string
  model: string
}

export interface SiteRules {
  enabled: boolean
  mode: 'all' | 'allowlist' | 'blocklist'
  domains: string[]
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
}

export interface StudySettings {
  dailyGoal: number
  programmerMode: boolean
}

export interface LexiSettings {
  siteRules: SiteRules
  replacement: ReplacementSettings
  selection: SelectionSettings
  study: StudySettings
  ai: Record<FeatureScene, AiSceneConfig>
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
