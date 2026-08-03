import type { GitHubDigestCache } from './types'
import { getCurrentDigestCacheEntry } from './digestCache'

export interface GitHubDigestCacheIdentity {
  key: string
  repo: string
  name: string
}

export function getGitHubDigestCacheKeys(info: GitHubDigestCacheIdentity) {
  return [...new Set([
    info.key,
    `github.com:${info.repo}`,
    `github.com:${info.repo}`.toLowerCase(),
    info.repo,
    info.repo.toLowerCase(),
    info.name,
  ].filter(Boolean))]
}

export function getCachedGitHubDigestEntry(
  cache: GitHubDigestCache,
  info: GitHubDigestCacheIdentity,
  sourceHash: string,
  cacheDays: number,
  now = Date.now(),
) {
  for (const key of getGitHubDigestCacheKeys(info)) {
    const entry = getCurrentDigestCacheEntry(cache[key], sourceHash, cacheDays, now)
    if (entry)
      return entry
  }

  return undefined
}
