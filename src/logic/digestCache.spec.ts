import { describe, expect, it } from 'vitest'
import { getCurrentDigestCacheEntry, pruneDigestCache } from './digestCache'

describe('digest cache', () => {
  it('returns a cache entry only when its source hash matches within the TTL', () => {
    const entry = { sourceHash: 'source-v1', updatedAt: 1_000, digest: 'cached digest' }
    const ttl = 24 * 60 * 60 * 1_000

    expect(getCurrentDigestCacheEntry(entry, 'source-v1', 1, entry.updatedAt + ttl)).toBe(entry)
    expect(getCurrentDigestCacheEntry(entry, 'source-v2', 1, entry.updatedAt + 1)).toBeUndefined()
  })

  it('rejects an entry immediately after its TTL expires', () => {
    const entry = { sourceHash: 'source-v1', updatedAt: 1_000 }
    const ttl = 24 * 60 * 60 * 1_000

    expect(getCurrentDigestCacheEntry(entry, 'source-v1', 1, entry.updatedAt + ttl + 1)).toBeUndefined()
  })

  it('keeps the most recently updated valid entries when pruning', () => {
    const oldest = { sourceHash: 'oldest', updatedAt: 10 }
    const recent = { sourceHash: 'recent', updatedAt: 20 }
    const newest = { sourceHash: 'newest', updatedAt: 30 }

    expect(pruneDigestCache({
      oldest,
      recent,
      newest,
      missingTimestamp: { sourceHash: 'missing', updatedAt: 0 },
      nonFiniteTimestamp: { sourceHash: 'non-finite', updatedAt: Number.NaN },
    }, 2)).toEqual({ newest, recent })
  })
})
