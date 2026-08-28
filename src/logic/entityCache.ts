import { simpleHash } from './text'
import type { DetectedEntity, EntityCacheEntry, EntityDomain, LexiSettings, PageDomainProfile } from './types'

/** Bump when the prompt or the stored shape changes, so old answers stop being reused. */
export const entityDetectionTemplateVersion = 1

const day = 24 * 60 * 60 * 1000

export function getEntityCacheKey(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}${parsed.search}`.toLowerCase()
  }
  catch {
    return url.trim().toLowerCase()
  }
}

/**
 * Fingerprints the providers bound to the entity scene.
 *
 * Two models disagree about what counts as an entity, so a cached answer from one must
 * not be presented as the other's. Mirrors `getContentDigestModelFingerprint`.
 */
export function getEntityModelFingerprint(settings: LexiSettings) {
  const scene = settings.ai.entity
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
    scene: 'entity',
    aiEnabled: scene.enabled,
    providers,
  }))
}

/** The page content the entity pass actually read, so an edited page invalidates itself. */
export function getEntitySourceHash(title: string, text: string) {
  return simpleHash(JSON.stringify({ title: title.trim(), text: text.slice(0, 4000) }))
}

export function resolveEntityCache(
  entry: EntityCacheEntry | undefined,
  sourceHash: string,
  modelFingerprint: string,
  cacheDays: number,
  now = Date.now(),
) {
  if (!entry
    || entry.templateVersion !== entityDetectionTemplateVersion
    || entry.modelFingerprint !== modelFingerprint
    || entry.sourceHash !== sourceHash) {
    return undefined
  }

  return now - entry.updatedAt <= Math.max(1, cacheDays) * day ? entry : undefined
}

export function createEntityCacheEntry(
  page: { url: string, title: string, host: string },
  profile: PageDomainProfile,
  entities: DetectedEntity[],
  sourceHash: string,
  modelFingerprint: string,
  now = Date.now(),
): EntityCacheEntry {
  return {
    url: page.url,
    title: page.title,
    host: page.host,
    primaryDomain: profile.primary,
    entities,
    sourceHash,
    templateVersion: entityDetectionTemplateVersion,
    modelFingerprint,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

/** Rebuilds the profile a cached entry was written under, so the UI reads the same either way. */
export function readCachedDomainProfile(entry: Pick<EntityCacheEntry, 'primaryDomain' | 'entities'>): PageDomainProfile {
  const scores = { tech: 0, finance: 0, product: 0, medical: 0, legal: 0, academic: 0 } as Record<EntityDomain, number>
  for (const entity of entry.entities)
    scores[entity.domain] += 1

  return {
    primary: entry.primaryDomain,
    confidence: entry.primaryDomain ? 1 : 0,
    scores,
  }
}
