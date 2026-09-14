import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSubtitleCache, mergeSubtitleCacheSnapshot, readSubtitleCacheSnapshot } from './subtitleCache'
import { subtitleTranslationCacheStorageKey } from '~/logic/storageKeys'
import { subtitleCacheVersion } from '~/logic/subtitles/cache'

/**
 * The worker owns the only durable subtitle cache: the content script never touches
 * `storage.local` itself, it asks the worker over runtime messages. That makes this module
 * the trust boundary for whatever earlier builds (or other code) left in storage — a read
 * must hand back sanitized, bounded snapshots, a merge must serialize against concurrent
 * writers so neither update is lost, and a clear must touch nothing but its own key. The
 * stored payload is the one place raw cue/media strings are forbidden to appear.
 */

const state = vi.hoisted(() => ({
  local: new Map<string, unknown>(),
  readError: false,
  writeError: false,
  removeError: false,
  writtenKeys: [] as string[],
}))

vi.mock('webextension-polyfill', () => {
  return {
    default: {
      storage: {
        local: {
          async get(key: string | string[]) {
            if (state.readError)
              throw new Error('local area unavailable')

            const keys = Array.isArray(key) ? key : [key]
            return Object.fromEntries(keys.filter(k => state.local.has(k)).map(k => [k, state.local.get(k)]))
          },
          async set(items: Record<string, unknown>) {
            if (state.writeError)
              throw new Error('local area unavailable')

            for (const [key, value] of Object.entries(items)) {
              state.local.set(key, value)
              state.writtenKeys.push(key)
            }
          },
          async remove(key: string | string[]) {
            if (state.removeError)
              throw new Error('local area unavailable')

            for (const k of Array.isArray(key) ? key : [key])
              state.local.delete(k)
          },
        },
      },
    },
  }
})

const otherStorageKey = 'lexi-subtitle-cache-spec-unrelated'
const baseTime = 1_700_000_000_000

interface RawIdentity {
  providerId: string
  mediaId: string
  sourceLang: string
  targetLang: string
  sourceHash: string
}

function identity(overrides: Partial<RawIdentity> = {}): RawIdentity {
  return {
    providerId: 'youtube',
    mediaId: 'youtube:abc123',
    sourceLang: 'en',
    targetLang: 'zh',
    sourceHash: 'source-1a2b3c',
    ...overrides,
  }
}

function entry(overrides: Record<string, unknown> = {}) {
  return { ...identity(), translations: { 'cue-1': '你好' }, updatedAt: baseTime, ...overrides }
}

function snapshot(...entries: unknown[]) {
  return { version: subtitleCacheVersion, entries }
}

function storedJson(): { version: number, entries: Array<Record<string, unknown>> } {
  const raw = state.local.get(subtitleTranslationCacheStorageKey)
  return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw))
}

beforeEach(() => {
  state.local.clear()
  state.readError = false
  state.writeError = false
  state.removeError = false
  state.writtenKeys.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readSubtitleCacheSnapshot', () => {
  it('returns only sanitized entries, dropping unknown fields and unusable rows', async () => {
    state.local.set(
      subtitleTranslationCacheStorageKey,
      snapshot(
        entry({ rawCueText: 'the secret subtitle line', mediaUrl: 'https://media.example/v.mp4' }),
        entry({ mediaId: '', updatedAt: baseTime }),
        entry({ translations: { '': 'empty key', 'cue-2': '' }, updatedAt: baseTime }),
      ),
    )

    const result = await readSubtitleCacheSnapshot()

    expect(result.version).toBe(subtitleCacheVersion)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.mediaId).toBe('youtube:abc123')
    expect(Object.keys(result.entries[0]!).sort()).toEqual([
      'mediaId',
      'providerId',
      'sourceHash',
      'sourceLang',
      'targetLang',
      'translations',
      'updatedAt',
    ])
    expect(Object.keys(result.entries[0]!.translations)).toEqual(['cue-1'])
  })

  it('treats a version mismatch or non-snapshot value as an empty cache', async () => {
    state.local.set(subtitleTranslationCacheStorageKey, { version: 99, entries: [entry()] })

    await expect(readSubtitleCacheSnapshot()).resolves.toEqual({ version: subtitleCacheVersion, entries: [] })
  })
})

describe('mergeSubtitleCacheSnapshot', () => {
  it('persists disjoint identities side by side under the cache key only', async () => {
    expect(await mergeSubtitleCacheSnapshot(snapshot(entry()))).toEqual({ ok: true })
    expect(await mergeSubtitleCacheSnapshot(snapshot(entry({ mediaId: 'youtube:zzz999' })))).toEqual({ ok: true })

    const persisted = storedJson().entries.map(item => item.mediaId).sort()
    expect(persisted).toEqual(['youtube:abc123', 'youtube:zzz999'])
    expect(state.writtenKeys).toEqual([subtitleTranslationCacheStorageKey, subtitleTranslationCacheStorageKey])
  })

  it('unions translations for the same identity and keeps the newer timestamp', async () => {
    state.local.set(
      subtitleTranslationCacheStorageKey,
      snapshot(entry({ translations: { 'cue-1': '你好' }, updatedAt: baseTime })),
    )

    await mergeSubtitleCacheSnapshot(
      snapshot(entry({ translations: { 'cue-2': '世界' }, updatedAt: baseTime + 5_000 })),
    )

    const persisted = storedJson().entries
    expect(persisted).toHaveLength(1)
    expect(persisted[0]!.translations).toEqual({ 'cue-1': '你好', 'cue-2': '世界' })
    expect(persisted[0]!.updatedAt).toBe(baseTime + 5_000)
  })

  it('never writes raw cue text or media fields into the stored payload', async () => {
    await mergeSubtitleCacheSnapshot(
      snapshot(entry({ rawCueText: 'the secret subtitle line', mediaUrl: 'https://media.example/v.mp4' })),
    )

    const serialized = String(state.local.get(subtitleTranslationCacheStorageKey))
    expect(serialized).not.toContain('the secret subtitle line')
    expect(serialized).not.toContain('media.example')
    expect(storedJson().entries[0]!.translations).toEqual({ 'cue-1': '你好' })
  })

  it('survives concurrent merges without dropping either update', async () => {
    const first = mergeSubtitleCacheSnapshot(snapshot(entry({ mediaId: 'youtube:first' })))
    const second = mergeSubtitleCacheSnapshot(snapshot(entry({ mediaId: 'youtube:second' })))

    expect(await Promise.all([first, second])).toEqual([{ ok: true }, { ok: true }])
    expect(storedJson().entries.map(item => item.mediaId).sort()).toEqual(['youtube:first', 'youtube:second'])
  })

  it('reports a read failure as a failure envelope without throwing', async () => {
    state.readError = true

    const result = await mergeSubtitleCacheSnapshot(snapshot(entry()))

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/\S/) })
  })

  it('reports a write failure as a failure envelope and leaves storage untouched', async () => {
    state.writeError = true

    const result = await mergeSubtitleCacheSnapshot(snapshot(entry()))

    expect(result).toEqual({ ok: false, error: expect.any(String) })
    expect(state.local.has(subtitleTranslationCacheStorageKey)).toBe(false)
  })
})

describe('clearSubtitleCache', () => {
  it('removes the cache key and leaves unrelated storage alone', async () => {
    state.local.set(subtitleTranslationCacheStorageKey, JSON.stringify(snapshot(entry())))
    state.local.set(otherStorageKey, { keep: true })

    expect(await clearSubtitleCache()).toEqual({ ok: true })
    expect(state.local.has(subtitleTranslationCacheStorageKey)).toBe(false)
    expect(state.local.get(otherStorageKey)).toEqual({ keep: true })
  })

  it('reports a removal failure as a failure envelope without throwing', async () => {
    state.local.set(subtitleTranslationCacheStorageKey, JSON.stringify(snapshot(entry())))
    state.removeError = true

    const result = await clearSubtitleCache()

    expect(result).toEqual({ ok: false, error: expect.any(String) })
    expect(state.local.has(subtitleTranslationCacheStorageKey)).toBe(true)
  })
})

describe('cache round trip', () => {
  it('returns what it just merged through local storage', async () => {
    await mergeSubtitleCacheSnapshot(snapshot(entry({ translations: { 'cue-1': '你好', 'cue-2': '世界' } })))

    const readBack = await readSubtitleCacheSnapshot()

    expect(readBack.entries).toHaveLength(1)
    expect(readBack.entries[0]).toMatchObject({
      mediaId: 'youtube:abc123',
      translations: { 'cue-1': '你好', 'cue-2': '世界' },
    })
  })
})
