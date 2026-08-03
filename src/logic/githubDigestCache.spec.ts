import { describe, expect, it } from 'vitest'
import { getCachedGitHubDigestEntry, getGitHubDigestCacheKeys } from './githubDigestCache'
import type { GitHubDigestCacheEntry } from './types'

const identity = {
  key: 'github.com:owner/repo',
  repo: 'Owner/Repo',
  name: 'Repo',
}

function createEntry(description: string): GitHubDigestCacheEntry {
  return {
    repo: identity.repo,
    description,
    topics: [],
    languages: [],
    sourceHash: 'source-v1',
    updatedAt: 1_000,
  }
}

describe('github digest cache compatibility', () => {
  it('checks the canonical key before legacy key variants', () => {
    const canonical = createEntry('canonical')
    const legacy = createEntry('legacy')
    const cache = {
      [identity.key]: canonical,
      [identity.repo]: legacy,
    }

    expect(getCachedGitHubDigestEntry(cache, identity, 'source-v1', 1, 1_001)).toBe(canonical)
  })

  it('reads legacy repository and name keys', () => {
    const entry = createEntry('legacy')

    expect(getCachedGitHubDigestEntry({ [identity.repo]: entry }, identity, 'source-v1', 1, 1_001)).toBe(entry)
    expect(getCachedGitHubDigestEntry({ [identity.name]: entry }, identity, 'source-v1', 1, 1_001)).toBe(entry)
  })

  it('deduplicates case-normalized key candidates', () => {
    const keys = getGitHubDigestCacheKeys(identity)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys[0]).toBe(identity.key)
  })
})
