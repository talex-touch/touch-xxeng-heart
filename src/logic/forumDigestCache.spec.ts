import { describe, expect, it } from 'vitest'
import { createForumDigestCacheEntry, getCachedForumDigestEntry, getForumDigestVersion, shouldAutoGenerateForumDigest } from './forumDigestCache'
import type { ForumDigestResult } from './types'

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

  it('does not auto generate when any valid cached version exists', () => {
    const entry = createForumDigestCacheEntry({
      host: 'linux.do',
      title: '缓存问题',
      url: 'https://linux.do/t/a/1',
      sourceHash: 'hash-1',
    }, digest, undefined, 1000)

    expect(shouldAutoGenerateForumDigest(undefined)).toBe(true)
    expect(shouldAutoGenerateForumDigest(entry)).toBe(false)
  })
})
