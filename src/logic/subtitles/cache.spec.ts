import { describe, expect, it } from 'vitest'
import {
  createSubtitleCueKey,
  createSubtitleTranslationCache,
  hashSubtitleCues,
  maxSubtitleCacheCueKeyLength,
  maxSubtitleCacheTranslationLength,
  parseSubtitleCacheSnapshot,
  subtitleCacheVersion,
} from './cache'
import type {
  SubtitleCacheEntry,
  SubtitleCacheIdentity,
  SubtitleCacheSnapshot,
  SubtitleCacheStorage,
  SubtitleTranslationCache,
} from './cache'
import type { SubtitleCue } from './types'

/**
 * The cache exists to stop translated cues from being bought twice, and it is the only place
 * that keeps state across page loads — so its contract is about identity, bounds, and the
 * persisted payload: a hit must require the exact same provider/media/language/source-hash,
 * a stored entry must never outlive its TTL or its count/length bounds, a blocked storage
 * must not take the in-memory mirror down with it, and the bytes written out must contain
 * hash-keyed translations only — never the cue text or media they came from.
 */

const dayInMs = 24 * 60 * 60 * 1000
const baseTime = 1_700_000_000_000

function identity(overrides: Partial<SubtitleCacheIdentity> = {}): SubtitleCacheIdentity {
  return {
    providerId: 'youtube',
    mediaId: 'youtube:abc123',
    sourceLang: 'en',
    targetLang: 'zh',
    sourceHash: 'source-1a2b3c',
    ...overrides,
  }
}

function entry(overrides: Partial<SubtitleCacheEntry> = {}): SubtitleCacheEntry {
  return { ...identity(), translations: { 'cue-1': '你好' }, updatedAt: baseTime, ...overrides }
}

function snapshot(...entries: SubtitleCacheEntry[]): SubtitleCacheSnapshot {
  return { version: subtitleCacheVersion, entries }
}

/** Deliberately unvalidated fixtures: they exercise what a hostile or stale storage can hand back. */
function rawSnapshot(entries: unknown[]): unknown {
  return { version: subtitleCacheVersion, entries }
}

interface Harness {
  cache: SubtitleTranslationCache
  storage: SubtitleCacheStorage
  state: {
    value: unknown
    writes: SubtitleCacheSnapshot[]
    clears: number
    clock: number
    readError?: Error
    writeError?: Error
    clearError?: Error
  }
}

/** A hand-written storage double: it records every write, can be made to fail, and never touches a real API. */
function createHarness(options: {
  initial?: unknown
  clearable?: boolean
  maxEntries?: number
  maxTranslationsPerEntry?: number
} = {}): Harness {
  const state: Harness['state'] = {
    value: options.initial,
    writes: [],
    clears: 0,
    clock: baseTime,
  }
  const storage: SubtitleCacheStorage = {
    read: async () => {
      if (state.readError)
        throw state.readError
      return state.value
    },
    write: async (value) => {
      if (state.writeError)
        throw state.writeError
      state.writes.push(value)
      state.value = value
    },
  }
  if (options.clearable !== false) {
    storage.clear = async () => {
      if (state.clearError)
        throw state.clearError
      state.clears += 1
      state.value = undefined
    }
  }

  const cache = createSubtitleTranslationCache({
    storage,
    now: () => state.clock,
    maxEntries: options.maxEntries,
    maxTranslationsPerEntry: options.maxTranslationsPerEntry,
  })
  return { cache, storage, state }
}

describe('subtitle translation cache identity', () => {
  it('serves a stored translation for the exact identity and cue key', async () => {
    const { cache } = createHarness({ initial: snapshot(entry()) })
    await cache.load()

    expect(cache.lookup(identity(), 'cue-1', 30)).toBe('你好')
  })

  it('misses an unknown cue key inside a matching entry', async () => {
    const { cache } = createHarness({ initial: snapshot(entry()) })
    await cache.load()

    expect(cache.lookup(identity(), 'cue-missing', 30)).toBeUndefined()
  })

  it.each([
    ['providerId', { providerId: 'bilibili' }],
    ['mediaId', { mediaId: 'youtube:other' }],
    ['sourceLang', { sourceLang: 'ja' }],
    ['targetLang', { targetLang: 'en' }],
    ['sourceHash', { sourceHash: 'source-other' }],
  ])('misses when only %s differs', async (_dimension, change) => {
    const { cache } = createHarness({ initial: snapshot(entry()) })
    await cache.load()

    expect(cache.lookup(identity(change), 'cue-1', 30)).toBeUndefined()
    expect(cache.lookup(identity(), 'cue-1', 30)).toBe('你好')
  })

  it('treats a language tag case-insensitively so provider casing cannot split an entry', async () => {
    const { cache } = createHarness()
    await cache.load()
    cache.merge(identity({ sourceLang: 'EN', targetLang: 'ZH' }), { 'cue-1': '你好' }, 30)

    expect(cache.snapshot().entries[0]?.sourceLang).toBe('en')
    expect(cache.snapshot().entries[0]?.targetLang).toBe('zh')
    expect(cache.lookup(identity({ sourceLang: 'en', targetLang: 'zh' }), 'cue-1', 30)).toBe('你好')
  })
})

describe('subtitle translation cache expiration', () => {
  it('serves an entry exactly at the TTL boundary and prunes it one millisecond past', async () => {
    const { cache, state } = createHarness({ initial: snapshot(entry({ updatedAt: baseTime })) })
    await cache.load()
    state.clock = baseTime + dayInMs

    expect(cache.lookup(identity(), 'cue-1', 1)).toBe('你好')

    state.clock = baseTime + dayInMs + 1
    expect(cache.lookup(identity(), 'cue-1', 1)).toBeUndefined()
    expect(cache.snapshot().entries).toEqual([])
  })

  it('refreshes freshness when a later merge adds a translation', async () => {
    const { cache, state } = createHarness({ initial: snapshot(entry({ updatedAt: baseTime })) })
    await cache.load()

    state.clock = baseTime + Math.floor(dayInMs / 2)
    cache.merge(identity(), { 'cue-2': '新' }, 1)

    state.clock = baseTime + dayInMs + 1
    expect(cache.lookup(identity(), 'cue-2', 1)).toBe('新')
  })

  it.each([[0], [-1], [Number.NaN]])('stores and serves nothing for a ttl of %s days', async (ttlDays) => {
    const { cache } = createHarness()
    await cache.load()
    cache.merge(identity(), { 'cue-1': '你好' }, 30)

    expect(cache.lookup(identity(), 'cue-1', ttlDays)).toBeUndefined()

    cache.merge(identity({ mediaId: 'youtube:other' }), { 'cue-2': '再见' }, ttlDays)
    expect(cache.lookup(identity({ mediaId: 'youtube:other' }), 'cue-2', 30)).toBeUndefined()
  })
})

describe('subtitle translation cache bounds', () => {
  it('keeps the newest entries when maxEntries is exceeded', async () => {
    const { cache, state } = createHarness({ maxEntries: 2 })
    await cache.load()

    cache.merge(identity({ mediaId: 'youtube:a' }), { 'cue-a': '甲' }, 30)
    state.clock += 1000
    cache.merge(identity({ mediaId: 'youtube:b' }), { 'cue-b': '乙' }, 30)
    state.clock += 1000
    cache.merge(identity({ mediaId: 'youtube:c' }), { 'cue-c': '丙' }, 30)

    expect(cache.snapshot().entries.map(stored => stored.mediaId)).toEqual(['youtube:b', 'youtube:c'])
  })

  it('keeps only the most recent translations when maxTranslationsPerEntry is exceeded', async () => {
    const { cache } = createHarness({ maxTranslationsPerEntry: 2 })
    await cache.load()

    cache.merge(identity(), { 'cue-1': '一', 'cue-2': '二', 'cue-3': '三' }, 30)

    expect(Object.keys(cache.snapshot().entries[0]!.translations)).toEqual(['cue-2', 'cue-3'])
    expect(cache.lookup(identity(), 'cue-1', 30)).toBeUndefined()
    expect(cache.lookup(identity(), 'cue-3', 30)).toBe('三')
  })

  it('accumulates translations across merges under the per-entry bound', async () => {
    const { cache } = createHarness({ maxTranslationsPerEntry: 2 })
    await cache.load()

    cache.merge(identity(), { 'cue-2': '二', 'cue-3': '三' }, 30)
    cache.merge(identity(), { 'cue-1': '一' }, 30)

    expect(Object.keys(cache.snapshot().entries[0]!.translations)).toEqual(['cue-3', 'cue-1'])
    expect(cache.lookup(identity(), 'cue-1', 30)).toBe('一')
    expect(cache.lookup(identity(), 'cue-2', 30)).toBeUndefined()
  })

  it.each([
    ['exactly at the length bound', maxSubtitleCacheTranslationLength, true],
    ['one character over the length bound', maxSubtitleCacheTranslationLength + 1, false],
  ])('keeps a translation %s', async (_label, length, kept) => {
    const { cache } = createHarness()
    await cache.load()
    const translation = 'x'.repeat(length)

    cache.merge(identity(), { 'cue-long': translation }, 30)

    if (kept) {
      expect(cache.lookup(identity(), 'cue-long', 30)).toBe(translation)
      expect(cache.snapshot().entries).toHaveLength(1)
    }
    else {
      expect(cache.snapshot().entries).toEqual([])
    }
  })

  it('drops an oversized cue key while loading and keeps the valid sibling', async () => {
    const validKey = 'k'.repeat(maxSubtitleCacheCueKeyLength)
    const oversizedKey = `${validKey}k`
    const { cache } = createHarness({
      initial: snapshot(entry({ translations: { [validKey]: '保留', [oversizedKey]: '丢弃' } })),
    })
    await cache.load()

    expect(cache.lookup(identity(), validKey, 30)).toBe('保留')
    expect(cache.lookup(identity(), oversizedKey, 30)).toBeUndefined()
    expect(Object.keys(cache.snapshot().entries[0]!.translations)).toEqual([validKey])
  })

  it.each([
    ['providerId', 120],
    ['mediaId', 512],
    ['sourceLang', 64],
    ['targetLang', 64],
    ['sourceHash', 160],
  ])('stores an entry whose %s is exactly at its bound and drops one that is over', async (field, bound) => {
    const atBound = 'x'.repeat(bound)
    const overBound = 'x'.repeat(bound + 1)
    const { cache } = createHarness({
      initial: rawSnapshot([
        entry({ [field]: atBound }),
        entry({ ...identity({ mediaId: 'youtube:second' }), [field]: overBound }),
      ]),
    })
    await cache.load()

    expect(cache.snapshot().entries).toHaveLength(1)
    expect(cache.lookup(identity({ [field]: atBound }), 'cue-1', 30)).toBe('你好')
  })
})

describe('subtitle translation cache malformed snapshots', () => {
  it('ignores values that are not a versioned entry array', async () => {
    const malformed = [
      undefined,
      null,
      42,
      [],
      'not-json',
      { version: subtitleCacheVersion - 1, entries: [entry()] },
      { entries: [entry()] },
      { version: subtitleCacheVersion },
      { version: subtitleCacheVersion, entries: 'not-an-array' },
    ]

    for (const initial of malformed) {
      const { cache } = createHarness({ initial })
      await cache.load()
      expect(cache.snapshot().entries).toEqual([])
    }
  })

  it('ignores an entry with an unusable identity or timestamp', async () => {
    const unusable = [
      entry({ providerId: '' }),
      entry({ mediaId: '   ' }),
      entry({ sourceHash: undefined as unknown as string }),
      { ...identity(), translations: { 'cue-1': '你好' } } as unknown as SubtitleCacheEntry,
      entry({ updatedAt: 0 }),
      entry({ updatedAt: -1 }),
      entry({ updatedAt: Number.NaN }),
      entry({ updatedAt: Number.POSITIVE_INFINITY }),
      entry({ updatedAt: '1700000000000' as unknown as number }),
    ]

    for (const item of unusable) {
      const { cache } = createHarness({ initial: rawSnapshot([item]) })
      await cache.load()
      expect(cache.snapshot().entries).toEqual([])
    }
  })

  it('ignores non-string, blank and array-valued translations', async () => {
    const unusable = [
      {},
      { 'cue-1': '' },
      { 'cue-1': '   ' },
      { 'cue-1': 42 },
      { 'cue-1': null },
      { 'cue-1': { nested: 'value' } },
      ['array-valued'],
    ]

    for (const translations of unusable) {
      const { cache } = createHarness({ initial: rawSnapshot([entry({ translations: translations as never })]) })
      await cache.load()
      expect(cache.snapshot().entries).toEqual([])
    }
  })

  it.each([
    ['an absolute URL', 'https://example.com/watch?v=secret'],
    ['a protocol-relative URL', '//example.com/watch'],
  ])('ignores a media id that is %s instead of a stable identifier', async (_label, mediaId) => {
    const { cache } = createHarness({ initial: rawSnapshot([entry({ mediaId })]) })
    await cache.load()

    expect(cache.snapshot().entries).toEqual([])
  })

  it('keeps one entry per identity when a stored snapshot repeats one', () => {
    const parsed = parseSubtitleCacheSnapshot(rawSnapshot([
      entry({ translations: { 'cue-old': '旧' }, updatedAt: baseTime }),
      entry({ translations: { 'cue-new': '新' }, updatedAt: baseTime + 1000 }),
    ]))

    expect(parsed.entries).toHaveLength(1)
  })
})

describe('subtitle translation cache storage failure', () => {
  it('stays usable in memory when the initial read fails', async () => {
    const { cache, state } = createHarness()
    state.readError = new Error('storage blocked')

    await expect(cache.load()).resolves.toBeUndefined()

    cache.merge(identity(), { 'cue-1': '你好' }, 30)
    expect(cache.lookup(identity(), 'cue-1', 30)).toBe('你好')
    expect(cache.snapshot().entries).toHaveLength(1)
  })

  it('keeps the mirror and retries a failed write on the next flush', async () => {
    const { cache, state } = createHarness()
    await cache.load()
    cache.merge(identity(), { 'cue-1': '你好' }, 30)
    state.writeError = new Error('quota exceeded')

    await expect(cache.flush()).resolves.toBeUndefined()
    expect(cache.lookup(identity(), 'cue-1', 30)).toBe('你好')
    expect(state.value).toBeUndefined()
    expect(state.writes).toEqual([])

    state.writeError = undefined
    await cache.flush()
    expect((state.value as SubtitleCacheSnapshot).entries).toHaveLength(1)
    expect(cache.lookup(identity(), 'cue-1', 30)).toBe('你好')
  })

  it('writes the mirror when the read that precedes a flush fails', async () => {
    const { cache, state } = createHarness()
    await cache.load()
    cache.merge(identity(), { 'cue-1': '你好' }, 30)
    state.readError = new Error('storage blocked')

    await expect(cache.flush()).resolves.toBeUndefined()

    expect((state.value as SubtitleCacheSnapshot).entries).toHaveLength(1)
  })

  it('clears memory even when the backing clear throws', async () => {
    const { cache, state } = createHarness()
    await cache.load()
    cache.merge(identity(), { 'cue-1': '你好' }, 30)
    state.clearError = new Error('storage blocked')

    await expect(cache.clear()).resolves.toBeUndefined()

    expect(cache.lookup(identity(), 'cue-1', 30)).toBeUndefined()
    expect(cache.snapshot().entries).toEqual([])
  })
})

describe('subtitle translation cache shared storage', () => {
  it('merges with another cache writing the same storage instead of losing its entries', async () => {
    const { storage, state } = createHarness()
    const first = createSubtitleTranslationCache({ storage, now: () => state.clock })
    const second = createSubtitleTranslationCache({ storage, now: () => state.clock })
    await Promise.all([first.load(), second.load()])

    first.merge(identity({ mediaId: 'youtube:first' }), { 'cue-1': '甲' }, 30)
    second.merge(identity({ mediaId: 'youtube:second' }), { 'cue-2': '乙' }, 30)
    await Promise.all([first.flush(), second.flush()])

    const persisted = (state.value as SubtitleCacheSnapshot).entries.map(stored => stored.mediaId).sort()
    expect(persisted).toEqual(['youtube:first', 'youtube:second'])
  })
})

describe('subtitle translation cache clear', () => {
  it('empties memory and the backing storage', async () => {
    const { cache, state } = createHarness()
    await cache.load()
    cache.merge(identity(), { 'cue-1': '你好' }, 30)
    await cache.flush()

    await cache.clear()

    expect(state.clears).toBe(1)
    expect(state.value).toBeUndefined()
    expect(cache.snapshot().entries).toEqual([])
    expect(cache.lookup(identity(), 'cue-1', 30)).toBeUndefined()
  })

  it('does not resurrect cleared entries when the persisted clear failed and a later flush runs', async () => {
    const { cache, state } = createHarness({ initial: snapshot(entry({ translations: { 'cue-1': '旧' } })) })
    await cache.load()
    state.clearError = new Error('storage blocked')
    await cache.clear()

    cache.merge(identity({ mediaId: 'youtube:new' }), { 'cue-9': '新' }, 30)
    await cache.flush()

    expect(cache.lookup(identity(), 'cue-1', 30)).toBeUndefined()
    expect(cache.lookup(identity({ mediaId: 'youtube:new' }), 'cue-9', 30)).toBe('新')
    expect((state.value as SubtitleCacheSnapshot).entries.map(stored => stored.mediaId)).toEqual(['youtube:new'])
  })

  it('writes an empty snapshot when the storage cannot clear itself', async () => {
    const { cache, state } = createHarness({ clearable: false })
    await cache.load()
    cache.merge(identity(), { 'cue-1': '你好' }, 30)
    await cache.flush()

    await cache.clear()

    expect(state.value).toEqual({ version: subtitleCacheVersion, entries: [] })
  })
})

describe('subtitle translation cache load gating', () => {
  it('ignores lookups and merges until load resolves, then serves only stored entries', async () => {
    const { cache } = createHarness({ initial: snapshot(entry({ translations: { 'cue-stored': '载入' } })) })

    expect(cache.lookup(identity(), 'cue-stored', 30)).toBeUndefined()
    cache.merge(identity(), { 'cue-merged': '写入' }, 30)
    expect(cache.snapshot().entries).toEqual([])

    await cache.load()

    expect(cache.lookup(identity(), 'cue-stored', 30)).toBe('载入')
    expect(cache.lookup(identity(), 'cue-merged', 30)).toBeUndefined()
  })
})

describe('subtitle translation cache snapshot', () => {
  it('hands out a copy callers cannot use to corrupt the mirror', async () => {
    const { cache } = createHarness()
    await cache.load()
    cache.merge(identity(), { 'cue-1': '你好' }, 30)

    const copy = cache.snapshot()
    copy.entries[0]!.translations['cue-1'] = '篡改'

    expect(cache.lookup(identity(), 'cue-1', 30)).toBe('你好')
  })
})

describe('subtitle cue keys and source hashes', () => {
  const cue: SubtitleCue = { start: 12.5, end: 14, text: 'A line worth caching' }

  it('is stable for the same cue and distinct for a different cue', () => {
    expect(createSubtitleCueKey(cue)).toBe(createSubtitleCueKey({ ...cue }))
    expect(hashSubtitleCues([cue])).toBe(hashSubtitleCues([{ ...cue }]))

    expect(createSubtitleCueKey(cue)).not.toBe(createSubtitleCueKey({ ...cue, start: 12.501 }))
    expect(createSubtitleCueKey(cue)).not.toBe(createSubtitleCueKey({ ...cue, text: 'A line worth caching!' }))
    expect(hashSubtitleCues([cue])).not.toBe(hashSubtitleCues([{ ...cue, text: 'A line worth caching!' }]))
    expect(hashSubtitleCues([cue])).not.toBe(hashSubtitleCues([{ ...cue, start: 12.501 }]))
    expect(hashSubtitleCues([cue])).not.toBe(hashSubtitleCues([{ ...cue, end: 14.001 }]))
  })

  it('ignores whitespace-only differences so re-extracted cues still hit', () => {
    expect(createSubtitleCueKey(cue)).toBe(createSubtitleCueKey({ ...cue, text: '  A line   worth\ncaching  ' }))
    expect(hashSubtitleCues([cue])).toBe(hashSubtitleCues([{ ...cue, text: 'A line worth  caching' }]))
  })

  it('distinguishes an added cue and cue order in the source hash', () => {
    const second: SubtitleCue = { start: 15, end: 17, text: 'Another line' }

    expect(hashSubtitleCues([cue])).not.toBe(hashSubtitleCues([cue, second]))
    expect(hashSubtitleCues([cue, second])).not.toBe(hashSubtitleCues([second, cue]))
  })

  it('produces a cue key the cache accepts back as a lookup key', async () => {
    const key = createSubtitleCueKey(cue)
    expect(key.length).toBeLessThanOrEqual(maxSubtitleCacheCueKeyLength)

    const sourceHash = hashSubtitleCues([cue])
    const { cache } = createHarness()
    await cache.load()
    cache.merge(identity({ sourceHash }), { [key]: '值得缓存的一句' }, 30)

    expect(cache.lookup(identity({ sourceHash }), key, 30)).toBe('值得缓存的一句')
  })
})

describe('subtitle translation cache persisted payload', () => {
  it('loads back the JSON string the default storage would write', async () => {
    const { cache } = createHarness({ initial: JSON.stringify(snapshot(entry())) })
    await cache.load()

    expect(cache.lookup(identity(), 'cue-1', 30)).toBe('你好')
  })

  it('writes only identity plus hash-keyed translations, never the raw cue or media', async () => {
    const raw: SubtitleCue = { start: 12.5, end: 14, text: 'RAW_SOURCE_TEXT_SENTINEL nothing else should carry this' }
    const sourceHash = hashSubtitleCues([raw])
    const cueKey = createSubtitleCueKey(raw)
    const { cache, state } = createHarness()
    await cache.load()
    cache.merge(identity({ sourceHash }), { [cueKey]: '这是译文' }, 30)

    await cache.flush()

    expect(JSON.stringify(state.value)).not.toContain('RAW_SOURCE_TEXT_SENTINEL')
    expect(JSON.stringify(state.value)).not.toContain('nothing else should carry this')

    const stored = (state.value as SubtitleCacheSnapshot).entries
    expect(stored).toHaveLength(1)
    expect(stored[0]!.sourceHash).toBe(sourceHash)
    expect(Object.keys(stored[0]!).sort()).toEqual([
      'mediaId',
      'providerId',
      'sourceHash',
      'sourceLang',
      'targetLang',
      'translations',
      'updatedAt',
    ])
    expect(stored[0]!.translations[cueKey]).toBe('这是译文')
  })
})
