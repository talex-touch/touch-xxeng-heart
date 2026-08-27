import { describe, expect, it, vi } from 'vitest'
import { getPageTranslationActivationKey, normalizePageTranslationUrl, pageTranslationActivationMatches } from './pageTranslationRules'
import type { PageTranslationActivation } from './types'

// Only the pure matchers are under test; the polyfill just needs to load.
vi.mock('webextension-polyfill', () => ({ default: { storage: { local: {} } } }))

function activation(overrides: Partial<PageTranslationActivation> = {}): PageTranslationActivation {
  return {
    enabled: true,
    scope: 'url',
    url: 'https://docs.example.com/guide?page=2#intro',
    host: 'docs.example.com',
    regex: '',
    updatedAt: 1,
    ...overrides,
  }
}

describe('normalizePageTranslationUrl', () => {
  it('drops only the fragment', () => {
    expect(normalizePageTranslationUrl('https://a.test/x?q=1#top')).toBe('https://a.test/x?q=1')
    expect(normalizePageTranslationUrl('not a url#frag')).toBe('not a url')
  })
})

describe('pageTranslationActivationMatches', () => {
  it('matches url-scope rules ignoring the fragment', () => {
    expect(pageTranslationActivationMatches(activation(), 'https://docs.example.com/guide?page=2#other')).toBe(true)
    expect(pageTranslationActivationMatches(activation(), 'https://docs.example.com/guide?page=3')).toBe(false)
  })

  it('matches site-scope rules by hostname', () => {
    const rule = activation({ scope: 'site' })
    expect(pageTranslationActivationMatches(rule, 'https://docs.example.com/anything')).toBe(true)
    expect(pageTranslationActivationMatches(rule, 'https://blog.example.com/anything')).toBe(false)
  })

  it('matches regex-scope rules against the full url', () => {
    const rule = activation({ scope: 'regex', regex: '^https://docs\\.example\\.com/guide' })
    expect(pageTranslationActivationMatches(rule, 'https://docs.example.com/guide/intro')).toBe(true)
    expect(pageTranslationActivationMatches(rule, 'https://docs.example.com/blog')).toBe(false)
  })

  it('never matches disabled, empty-regex or invalid-regex rules', () => {
    expect(pageTranslationActivationMatches(activation({ enabled: false }), 'https://docs.example.com/guide?page=2')).toBe(false)
    expect(pageTranslationActivationMatches(activation({ scope: 'regex', regex: '  ' }), 'https://docs.example.com/guide')).toBe(false)
    expect(pageTranslationActivationMatches(activation({ scope: 'regex', regex: '(' }), 'https://docs.example.com/guide')).toBe(false)
  })
})

describe('getPageTranslationActivationKey', () => {
  it('keys by scope identity so re-saving overwrites the same rule', () => {
    expect(getPageTranslationActivationKey(activation())).toBe('url:https://docs.example.com/guide?page=2')
    expect(getPageTranslationActivationKey(activation({ scope: 'site' }))).toBe('site:docs.example.com')
    expect(getPageTranslationActivationKey(activation({ scope: 'regex', regex: '^https://x' }))).toBe('regex:^https://x')
  })
})
