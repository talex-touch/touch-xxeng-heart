import { describe, expect, it } from 'vitest'
import { createForumDigestCacheEntry, getCachedForumDigestEntry, getForumDigestVersion, shouldAutoGenerateForumDigest } from './forumDigestCache'
import type { ForumDigestCacheEntry, ForumDigestResult } from './types'

const digest: ForumDigestResult = {
  oneLine: '主贴在讨论缓存复用。',
  summary: ['主贴希望减少重复请求。'],
  keyPoints: ['缓存命中后不应自动刷新。'],
  terms: ['cache'],
}

describe('forum digest cache', () => {
  it('keeps current and previous digest versions', () => {
    const first = createForumDigestCacheEntry({
      host: 'linux.do',
      title: '缓存问题',
      url: 'https://linux.do/t/a/1',
      sourceHash: 'hash-1',
    }, digest, undefined, 1000)
    const second = createForumDigestCacheEntry({
      host: 'linux.do',
      title: '缓存问题',
      url: 'https://linux.do/t/a/1',
      sourceHash: 'hash-2',
    }, { ...digest, oneLine: '内容已变化。' }, first, 2000)

    expect(second.history.map(item => item.sourceHash)).toEqual(['hash-2', 'hash-1'])
    expect(getForumDigestVersion(second, 'hash-1')?.digest.oneLine).toBe(digest.oneLine)
  })

  it('restores history from a legacy entry without a history array', () => {
    const legacyEntry = {
      host: 'linux.do',
      title: 'Legacy cache',
      url: 'https://linux.do/t/a/1',
      digest,
      sourceHash: 'hash-1',
      updatedAt: 1_000,
    } as ForumDigestCacheEntry
    const cache = { 'linux.do:https://linux.do/t/a/1': legacyEntry }

    const restored = getCachedForumDigestEntry(cache, 'linux.do:https://linux.do/t/a/1', 1, 1_001)

    expect(restored?.history).toEqual([{
      sourceHash: 'hash-1',
      digest,
      createdAt: 1_000,
    }])
  })

  it('expires stale entries by cache days', () => {
    const entry = createForumDigestCacheEntry({
      host: 'linux.do',
      title: '缓存问题',
      url: 'https://linux.do/t/a/1',
      sourceHash: 'hash-1',
    }, digest, undefined, 1000)
    const cache = { 'linux.do:https://linux.do/t/a/1': entry }

    expect(getCachedForumDigestEntry(cache, 'linux.do:https://linux.do/t/a/1', 1, 1000 + 23 * 60 * 60 * 1000)).toBeDefined()
    expect(getCachedForumDigestEntry(cache, 'linux.do:https://linux.do/t/a/1', 1, 1000 + 25 * 60 * 60 * 1000)).toBeUndefined()
  })

  it('auto generates only when the current source has no cached digest', () => {
    const entry = createForumDigestCacheEntry({
      host: 'linux.do',
      title: '缓存问题',
      url: 'https://linux.do/t/a/1',
      sourceHash: 'hash-1',
    }, digest, undefined, 1000)

    expect(shouldAutoGenerateForumDigest(undefined, 'hash-1')).toBe(true)
    expect(shouldAutoGenerateForumDigest(entry, 'hash-1')).toBe(false)
    expect(shouldAutoGenerateForumDigest(entry, 'hash-2')).toBe(true)
  })
})
