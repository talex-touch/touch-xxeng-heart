export const settingsStorageKey = 'touch-xxeng-heart-settings'
export const vocabularyStorageKey = 'touch-xxeng-heart-vocabulary'
export const aiCallLogsStorageKey = 'touch-xxeng-heart-ai-call-logs'
export const pageVisitLogsStorageKey = 'touch-xxeng-heart-page-visit-logs'
export const pageTranslationsStorageKey = 'touch-xxeng-heart-page-translations'
export const pageTranslationMemoryStorageKey = 'touch-xxeng-heart-page-translation-memory'
export const pageTranslationActivationsStorageKey = 'touch-xxeng-heart-page-translation-activations'
/** Local-only accounting for translation request caps. */
export const translationUsageStorageKey = 'touch-xxeng-heart-translation-usage'
export const githubDigestStorageKey = 'touch-xxeng-heart-github-digests'
export const forumDigestStorageKey = 'touch-xxeng-heart-forum-digests'
export const contentDigestStorageKey = 'touch-xxeng-heart-content-digests'
export const pageEntitiesStorageKey = 'touch-xxeng-heart-page-entities'
export const contentDigestLeaseStorageKey = 'touch-xxeng-heart-content-digest-leases'
/** Per-tab page-dialog conversation snapshots; never synchronized across devices. */
export const dialogHistorySessionStorageKey = 'touch-xxeng-heart-dialog-history'
/** Per-tab Discourse live-chat translations, keyed by channel + message + source hash. */
export const discourseChatTranslationsStorageKey = 'touch-xxeng-heart-discourse-chat-translations'
/** Bounded translated-cue cache; stores hashes and translations, never media or source text. */
export const subtitleTranslationCacheStorageKey = 'touch-xxeng-heart-subtitle-translation-cache'
/** Sync-area keys; the mirror is chunked because one sync item is capped at 8 KB. */
export const syncSettingsMetaKey = 'lexi-sync-settings-meta'
export const syncSettingsChunkPrefix = 'lexi-sync-settings-chunk-'
/** Local-only: identifies this browser profile so it can ignore its own sync writes. */
export const syncDeviceIdStorageKey = 'touch-xxeng-heart-sync-device-id'
/** Local-only: the stable random id this profile presents to the Nexus device flow. */
export const nexusDeviceIdStorageKey = 'touch-xxeng-heart-nexus-device-id'
/**
 * Nexus access/refresh tokens. Session area only, trusted contexts only — a content
 * script must never be able to read this, and nothing here survives the browser closing.
 */
export const nexusTokenBundleStorageKey = 'touch-xxeng-heart-nexus-tokens'
