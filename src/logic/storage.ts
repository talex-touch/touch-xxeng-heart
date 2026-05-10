import { defaultSettings } from './defaults'
import { aiCallLogsStorageKey, pageVisitLogsStorageKey, settingsStorageKey, vocabularyStorageKey } from './storageKeys'
import type { AiCallLog, LexiSettings, PageVisitLog, VocabularyRecord } from './types'
import { useWebExtensionStorage } from '~/composables/useWebExtensionStorage'

export const { data: lexiSettings, dataReady: lexiSettingsReady } = useWebExtensionStorage<LexiSettings>(
  settingsStorageKey,
  defaultSettings,
  {
    mergeDefaults: true,
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
