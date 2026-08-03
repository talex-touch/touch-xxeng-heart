import { describe, expect, it } from 'vitest'
import { contentDigestTemplateVersion, createContentDigestCacheEntry, getContentDigestCacheKey, getContentDigestModelFingerprint, getContentDigestTtlMs, resolveContentDigestCache } from './contentDigestCache'
import { mergeSettings } from './defaults'
import type { ContentDigestResult, ContentDocument } from './types'

const document: ContentDocument = {
  platform: 'reddit',
  contentType: 'discussion',
  canonicalId: 'post-1',
  canonicalUrl: 'https://www.reddit.com/comments/post-1',
  title: 'Cache design',
  blocks: [{ id: 'body-0', kind: 'body', text: 'A sufficiently long source paragraph for the cache test.' }],
  completeness: 'partial',
  coverage: '已读取主贴',
  limitations: [],
  nsfw: false,
  sourceHash: 'source-v1',
}

const digest: ContentDigestResult = {
  oneLine: '讨论缓存设计。',
  summary: ['使用稳定键。'],
  keyPoints: [],
  viewpoints: [],
  actions: [],
  terms: ['cache'],
  coverage: document.coverage,
}

describe('content digest cache', () => {
  it('uses shorter TTLs for dynamic platforms than video platforms', () => {
    expect(getContentDigestTtlMs('x', 30)).toBe(3 * 60 * 60 * 1000)
    expect(getContentDigestTtlMs('reddit', 30)).toBe(12 * 60 * 60 * 1000)
    expect(getContentDigestTtlMs('youtube', 30)).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('distinguishes fresh and stale-while-revalidate entries', () => {
    const key = getContentDigestCacheKey(document)
    const entry = createContentDigestCacheEntry(document, digest, 'model-v1', 1_000)
    const cache = { [key]: entry }

    expect(resolveContentDigestCache(cache, key, document, 'model-v1', 14, 2_000)?.fresh).toBe(true)
    expect(resolveContentDigestCache(cache, key, { ...document, sourceHash: 'source-v2' }, 'model-v1', 14, 2_000)?.fresh).toBe(false)
  })

  it('invalidates entries when the template or model fingerprint changes', () => {
    const key = getContentDigestCacheKey(document)
    const entry = createContentDigestCacheEntry(document, digest, 'model-v1', 1_000)

    expect(resolveContentDigestCache({ [key]: entry }, key, document, 'model-v2', 14, 2_000)).toBeUndefined()
    expect(resolveContentDigestCache({ [key]: { ...entry, templateVersion: contentDigestTemplateVersion + 1 } }, key, document, 'model-v1', 14, 2_000)).toBeUndefined()
  })

  it('does not include API keys in the model fingerprint', () => {
    const first = mergeSettings()
    first.ai.digest.enabled = true
    first.ai.providers[0].endpoint = 'https://api.example.com/v1'
    first.ai.providers[0].model = 'model-a'
    first.ai.providers[0].apiKey = 'secret-a'
    const second = structuredClone(first)
    second.ai.providers[0].apiKey = 'secret-b'

    expect(getContentDigestModelFingerprint(first)).toBe(getContentDigestModelFingerprint(second))
    second.ai.providers[0].model = 'model-b'
    expect(getContentDigestModelFingerprint(first)).not.toBe(getContentDigestModelFingerprint(second))
  })
})
