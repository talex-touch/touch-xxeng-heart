import { simpleHash } from './text'
import type { ContentDigestCache, ContentDigestCacheEntry, ContentDigestResult, ContentDocument, ContentPlatform, LexiSettings } from './types'

export const contentDigestTemplateVersion = 1

const hour = 60 * 60 * 1000
const platformTtlHours: Record<ContentPlatform, number> = {
  reddit: 12,
  x: 3,
  youtube: 30 * 24,
  bilibili: 30 * 24,
  xiaohongshu: 3 * 24,
  zhihu: 24,
}

export function getContentDigestCacheKey(document: Pick<ContentDocument, 'platform' | 'canonicalId'>) {
  return `${document.platform}:${document.canonicalId}:summary:zh-CN`.toLowerCase()
}

export function getContentDigestTtlMs(platform: ContentPlatform, cacheDays: number) {
  const configuredMaximum = Math.max(1, cacheDays) * 24
  return Math.min(configuredMaximum, platformTtlHours[platform]) * hour
}

export function getContentDigestModelFingerprint(settings: LexiSettings) {
  const scene = settings.ai.digest
  const selected = new Set(scene.providerIds ?? [])
  const providers = settings.ai.providers
    .filter(provider => provider.enabled && (!selected.size || selected.has(provider.id)))
    .map(provider => ({
      id: provider.id,
      protocol: provider.protocol,
      endpoint: provider.endpoint,
      model: provider.model,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

  return simpleHash(JSON.stringify({
    scene: 'digest',
    providers,
  }))
}

export interface ResolvedContentDigestCache {
  entry: ContentDigestCacheEntry
  fresh: boolean
}

export function resolveContentDigestCache(
  cache: ContentDigestCache,
  key: string,
  document: ContentDocument,
  modelFingerprint: string,
  cacheDays: number,
  now = Date.now(),
): ResolvedContentDigestCache | undefined {
  const entry = cache[key]
  if (!entry
    || entry.templateVersion !== contentDigestTemplateVersion
    || entry.modelFingerprint !== modelFingerprint) {
    return undefined
  }

  const ttl = getContentDigestTtlMs(document.platform, cacheDays)
  const age = now - entry.updatedAt
  if (age > Math.min(ttl * 4, 90 * 24 * hour))
    return undefined

  return {
    entry,
    fresh: entry.sourceHash === document.sourceHash && age <= ttl,
  }
}

export function createContentDigestCacheEntry(
  document: ContentDocument,
  digest: ContentDigestResult,
  modelFingerprint: string,
  now = Date.now(),
): ContentDigestCacheEntry {
  return {
    platform: document.platform,
    contentType: document.contentType,
    canonicalId: document.canonicalId,
    canonicalUrl: document.canonicalUrl,
    title: document.title,
    digest,
    sourceHash: document.sourceHash,
    templateVersion: contentDigestTemplateVersion,
    modelFingerprint,
    updatedAt: now,
    lastAccessedAt: now,
  }
}
