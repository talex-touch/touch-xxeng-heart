import { defaultSettings, mergeSettings } from './defaults'
import { aiCallLogsStorageKey, forumDigestStorageKey, githubDigestStorageKey, pageVisitLogsStorageKey, settingsStorageKey, vocabularyStorageKey } from './storageKeys'
import type { AiCallLog, ForumDigestCache, GitHubDigestCache, LexiSettings, PageVisitLog, VocabularyRecord } from './types'
import { useWebExtensionStorage } from '~/composables/useWebExtensionStorage'

// The `dataReady` promises these used to export were never awaited anywhere.
// `pageTranslationMemory` is likewise gone: nothing read the ref, and the content
// script goes straight to `browser.storage.local` for that key.

export const { data: lexiSettings } = useWebExtensionStorage<LexiSettings>(
  settingsStorageKey,
  defaultSettings,
  {
    mergeDefaults: value => mergeSettings(value as Partial<LexiSettings>),
  },
)

export const { data: vocabularyRecords } = useWebExtensionStorage<VocabularyRecord[]>(
  vocabularyStorageKey,
  [],
  { writeDefaults: false },
)

export const { data: aiCallLogs } = useWebExtensionStorage<AiCallLog[]>(
  aiCallLogsStorageKey,
  [],
  { writeDefaults: false },
)

export const { data: pageVisitLogs } = useWebExtensionStorage<PageVisitLog[]>(
  pageVisitLogsStorageKey,
  [],
  { writeDefaults: false },
)

export const { data: githubDigestCache } = useWebExtensionStorage<GitHubDigestCache>(
  githubDigestStorageKey,
  {},
  { writeDefaults: false },
)

export const { data: forumDigestCache } = useWebExtensionStorage<ForumDigestCache>(
  forumDigestStorageKey,
  {},
  { writeDefaults: false },
)
