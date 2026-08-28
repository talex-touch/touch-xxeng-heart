import { describe, expect, it, vi } from 'vitest'
import { resolveSubtitleSource } from './registry'
import type { SubtitleProvider, SubtitleSource } from './types'

function source(mediaId: string): SubtitleSource {
  return { mediaId, media: {} as HTMLVideoElement, listTracks: async () => [] }
}

function provider(value: Partial<SubtitleProvider> & Pick<SubtitleProvider, 'id' | 'priority'>): SubtitleProvider {
  return {
    label: value.id,
    match: () => true,
    resolve: async () => source(value.id),
    ...value,
  }
}

const url = new URL('https://example.com/watch?v=abc')

describe('resolveSubtitleSource', () => {
  it('prefers the lowest priority number', async () => {
    const resolved = await resolveSubtitleSource([
      provider({ id: 'asr', priority: 90 }),
      provider({ id: 'native', priority: 10 }),
    ], url)

    expect(resolved?.provider.id).toBe('native')
  })

  it('falls through when a provider declines', async () => {
    const resolved = await resolveSubtitleSource([
      provider({ id: 'youtube', priority: 10, resolve: async () => undefined }),
      provider({ id: 'texttrack', priority: 20 }),
    ], url)

    expect(resolved?.provider.id).toBe('texttrack')
  })

  it('treats a throwing provider as one that declined', async () => {
    // A broken bridge must not take the feature down with it.
    const resolved = await resolveSubtitleSource([
      provider({ id: 'youtube', priority: 10, resolve: async () => { throw new Error('bridge lost') } }),
      provider({ id: 'texttrack', priority: 20 }),
    ], url)

    expect(resolved?.provider.id).toBe('texttrack')
  })

  it('skips providers whose match rejects the url', async () => {
    const resolve = vi.fn()
    const resolved = await resolveSubtitleSource([
      provider({ id: 'bilibili', priority: 10, match: () => false, resolve }),
      provider({ id: 'texttrack', priority: 20 }),
    ], url)

    expect(resolve).not.toHaveBeenCalled()
    expect(resolved?.provider.id).toBe('texttrack')
  })

  it('leaves billable providers out until the caller opts in', async () => {
    const providers = [provider({ id: 'asr', priority: 90, billable: true })]

    expect(await resolveSubtitleSource(providers, url, { allowBillable: false })).toBeUndefined()
    expect((await resolveSubtitleSource(providers, url))?.provider.id).toBe('asr')
  })

  it('returns nothing when every provider declines', async () => {
    const resolved = await resolveSubtitleSource([
      provider({ id: 'youtube', priority: 10, resolve: async () => undefined }),
    ], url)

    expect(resolved).toBeUndefined()
  })
})
