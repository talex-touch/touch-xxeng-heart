import { defaultSettings, mergeSettings } from './defaults'
import { aiCallLogsStorageKey, forumDigestStorageKey, githubDigestStorageKey, pageTranslationMemoryStorageKey, pageVisitLogsStorageKey, settingsStorageKey, vocabularyStorageKey } from './storageKeys'
import type { AiCallLog, ForumDigestCache, GitHubDigestCache, LexiSettings, PageTranslationMemory, PageVisitLog, VocabularyRecord } from './types'
import { useWebExtensionStorage } from '~/composables/useWebExtensionStorage'

export const { data: lexiSettings, dataReady: lexiSettingsReady } = useWebExtensionStorage<LexiSettings>(
  settingsStorageKey,
  defaultSettings,
  {
    mergeDefaults: value => mergeSettings(value as Partial<LexiSettings>),
  },
)

export const { data: vocabularyRecords, dataReady: vocabularyRecordsReady } = useWebExtensionStorage<VocabularyRecord[]>(
  vocabularyStorageKey,
  [],
)

export const { data: aiCallLogs, dataReady: aiCallLogsReady } = useWebExtensionStorage<AiCallLog[]>(
  aiCallLogsStorageKey,
  [],
)

export const { data: pageVisitLogs, dataReady: pageVisitLogsReady } = useWebExtensionStorage<PageVisitLog[]>(
  pageVisitLogsStorageKey,
  [],
)

export const { data: githubDigestCache, dataReady: githubDigestCacheReady } = useWebExtensionStorage<GitHubDigestCache>(
  githubDigestStorageKey,
  {},
)

export const { data: forumDigestCache, dataReady: forumDigestCacheReady } = useWebExtensionStorage<ForumDigestCache>(
  forumDigestStorageKey,
  {},
)

export const { data: pageTranslationMemory, dataReady: pageTranslationMemoryReady } = useWebExtensionStorage<PageTranslationMemory>(
  pageTranslationMemoryStorageKey,
  {},
)
