export interface DigestCacheEntry {
  sourceHash: string
  updatedAt: number
  lastAccessedAt?: number
}

export function getCurrentDigestCacheEntry<T extends DigestCacheEntry>(
  entry: T | undefined,
  sourceHash: string,
  cacheDays: number,
  now = Date.now(),
) {
  if (!entry || entry.sourceHash !== sourceHash)
    return undefined

  const ttl = Math.max(1, cacheDays) * 24 * 60 * 60 * 1000
  return now - entry.updatedAt <= ttl ? entry : undefined
}

export function mergeDigestCacheEntry<T extends DigestCacheEntry>(current: T | undefined, incoming: T): T {
  if (!current || incoming.updatedAt >= current.updatedAt) {
    return {
      ...incoming,
      lastAccessedAt: Math.max(incoming.lastAccessedAt ?? incoming.updatedAt, current?.lastAccessedAt ?? 0),
    }
  }

  return {
    ...current,
    lastAccessedAt: Math.max(current.lastAccessedAt ?? current.updatedAt, incoming.lastAccessedAt ?? 0),
  }
}

export function pruneDigestCache<T extends DigestCacheEntry>(cache: Record<string, T>, maxEntries: number) {
  const limit = Math.max(1, Math.floor(maxEntries))
  return Object.fromEntries(
    Object.entries(cache)
      .filter(([, entry]) => Number.isFinite(entry?.updatedAt) && entry.updatedAt > 0)
      .sort(([, left], [, right]) => (right.lastAccessedAt ?? right.updatedAt) - (left.lastAccessedAt ?? left.updatedAt))
      .slice(0, limit),
  ) as Record<string, T>
}

export function pruneDigestCacheBySize<T extends DigestCacheEntry>(
  cache: Record<string, T>,
  maxEntries: number,
  maxBytes: number,
) {
  const ordered = Object.entries(pruneDigestCache(cache, maxEntries))
  const byteLimit = Math.max(1024, Math.floor(maxBytes))
  const kept: Array<[string, T]> = []
  let usedBytes = 2

  for (const item of ordered) {
    const bytes = JSON.stringify(item).length * 2
    if (usedBytes + bytes > byteLimit)
      continue

    kept.push(item)
    usedBytes += bytes
  }

  return Object.fromEntries(kept) as Record<string, T>
}
