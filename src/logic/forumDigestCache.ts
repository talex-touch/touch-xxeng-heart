import type { ForumDigestCache, ForumDigestCacheEntry, ForumDigestResult } from './types'

export function normalizeForumCacheHistory(entry: ForumDigestCacheEntry | undefined) {
  if (!entry)
    return []

  const history = Array.isArray(entry.history)
    ? entry.history.filter(item => item?.sourceHash && item.digest)
    : []
  const hasCurrent = history.some(item => item.sourceHash === entry.sourceHash)
  if (!hasCurrent && entry.digest && entry.sourceHash) {
    history.unshift({
      sourceHash: entry.sourceHash,
      digest: entry.digest,
      createdAt: entry.updatedAt,
    })
  }

  return history
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8)
}

export function getCachedForumDigestEntry(
  cache: ForumDigestCache,
  key: string,
  cacheDays: number,
  now = Date.now(),
) {
  const entry = cache[key]
  if (!entry)
    return undefined

  const ttl = Math.max(1, cacheDays) * 24 * 60 * 60 * 1000
  if (now - entry.updatedAt > ttl)
    return undefined

  return {
    ...entry,
    history: normalizeForumCacheHistory(entry),
  }
}

export function getForumDigestVersion(entry: ForumDigestCacheEntry | undefined, sourceHash: string) {
  return entry?.history.find(item => item.sourceHash === sourceHash)
}

export function shouldAutoGenerateForumDigest(entry: ForumDigestCacheEntry | undefined) {
  return !entry?.history.length
}

export function createForumDigestCacheEntry(
  input: {
    host: string
    title: string
    url: string
    sourceHash: string
  },
  digest: ForumDigestResult,
  current?: ForumDigestCacheEntry,
  now = Date.now(),
): ForumDigestCacheEntry {
  const nextVersion = {
    sourceHash: input.sourceHash,
    digest,
    createdAt: now,
  }
  const history = [
    nextVersion,
    ...normalizeForumCacheHistory(current).filter(item => item.sourceHash !== input.sourceHash),
  ].slice(0, 8)

  return {
    host: input.host,
    title: input.title,
    url: input.url,
    digest,
    sourceHash: input.sourceHash,
    updatedAt: now,
    history,
  }
}
