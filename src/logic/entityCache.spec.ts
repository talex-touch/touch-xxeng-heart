import { describe, expect, it } from 'vitest'
import { defaultSettings, mergeSettings } from './defaults'
import {
  createEntityCacheEntry,
  getEntityCacheKey,
  getEntityModelFingerprint,
  getEntitySourceHash,
  readCachedDomainProfile,
  resolveEntityCache,
} from './entityCache'
import type { DetectedEntity, PageDomainProfile } from './types'

const page = { url: 'https://example.com/post', title: '一篇文章', host: 'example.com' }
const profile: PageDomainProfile = {
  primary: 'finance',
  confidence: 0.7,
  scores: { tech: 2, finance: 9, product: 0, medical: 0, legal: 0, academic: 0 },
}
const entities: DetectedEntity[] = [
  { term: 'ARR', domain: 'finance', meaning: '年度经常性收入。', source: 'seed', alternativeDomains: [], count: 3 },
  { term: 'volatile', domain: 'finance', meaning: '波动剧烈的。', source: 'seed', alternativeDomains: ['tech'], count: 1 },
]

const hash = getEntitySourceHash(page.title, '正文内容')
const fingerprint = 'fingerprint-a'
const entry = createEntityCacheEntry(page, profile, entities, hash, fingerprint, 1000)

describe('entity cache', () => {
  it('drops the query fragment but keeps the path and search', () => {
    expect(getEntityCacheKey('https://Example.com/Post?id=2#section')).toBe('https://example.com/post?id=2')
    expect(getEntityCacheKey('not a url')).toBe('not a url')
  })

  it('reuses an entry only while source, model and template all match', () => {
    expect(resolveEntityCache(entry, hash, fingerprint, 7, 2000)).toBeDefined()
    expect(resolveEntityCache(entry, 'other-hash', fingerprint, 7, 2000)).toBeUndefined()
    expect(resolveEntityCache(entry, hash, 'fingerprint-b', 7, 2000)).toBeUndefined()
    expect(resolveEntityCache({ ...entry, templateVersion: 0 }, hash, fingerprint, 7, 2000)).toBeUndefined()
    expect(resolveEntityCache(undefined, hash, fingerprint, 7, 2000)).toBeUndefined()
  })

  it('expires an entry once it is older than the configured days', () => {
    const day = 24 * 60 * 60 * 1000

    expect(resolveEntityCache(entry, hash, fingerprint, 7, 1000 + 6 * day)).toBeDefined()
    expect(resolveEntityCache(entry, hash, fingerprint, 7, 1000 + 8 * day)).toBeUndefined()
  })

  it('changes the fingerprint when the bound provider or the scene switch changes', () => {
    const base = getEntityModelFingerprint(defaultSettings)
    const enabled = mergeSettings({
      ...defaultSettings,
      ai: { ...defaultSettings.ai, entity: { ...defaultSettings.ai.entity, enabled: true } },
    })
    const remodelled = mergeSettings({
      ...enabled,
      ai: {
        ...enabled.ai,
        providers: enabled.ai.providers.map(provider => ({ ...provider, model: 'another-model' })),
      },
    })

    expect(getEntityModelFingerprint(enabled)).not.toBe(base)
    expect(getEntityModelFingerprint(remodelled)).not.toBe(getEntityModelFingerprint(enabled))
  })

  it('changes the source hash when the page title or the body changes', () => {
    expect(getEntitySourceHash('标题', '正文')).toBe(getEntitySourceHash(' 标题 ', '正文'))
    expect(getEntitySourceHash('标题', '正文')).not.toBe(getEntitySourceHash('别的标题', '正文'))
    expect(getEntitySourceHash('标题', '正文')).not.toBe(getEntitySourceHash('标题', '别的正文'))
  })

  it('rebuilds a domain profile from a cached entry so the UI reads the same either way', () => {
    const restored = readCachedDomainProfile(entry)

    expect(restored.primary).toBe('finance')
    expect(restored.scores.finance).toBe(2)
    expect(readCachedDomainProfile({ primaryDomain: undefined, entities: [] }).confidence).toBe(0)
  })
})
