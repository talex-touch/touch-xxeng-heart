import { defaultSettings } from './defaults'
import { settingsStorageKey, vocabularyStorageKey } from './storageKeys'
import type { LexiSettings, VocabularyRecord } from './types'
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
