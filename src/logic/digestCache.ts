export interface DigestCacheEntry {
  sourceHash: string
  updatedAt: number
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

export function pruneDigestCache<T extends DigestCacheEntry>(cache: Record<string, T>, maxEntries: number) {
  const limit = Math.max(1, Math.floor(maxEntries))
  return Object.fromEntries(
    Object.entries(cache)
      .filter(([, entry]) => Number.isFinite(entry?.updatedAt) && entry.updatedAt > 0)
      .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, limit),
  ) as Record<string, T>
}
