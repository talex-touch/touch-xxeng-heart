import { describe, expect, it } from 'vitest'
import { protectTerms, restoreTerms } from './termProtection'

describe('protectTerms', () => {
  it('hides code, URLs, acronyms and camelCase', () => {
    const { text, terms } = protectTerms('Call `fetchUser()` against https://api.example.com using the REST API.')

    expect(text).not.toContain('fetchUser')
    expect(text).not.toContain('https://')
    expect(terms).toContain('`fetchUser()`')
    expect(terms).toContain('https://api.example.com')
    expect(terms).toContain('REST')
  })

  it('leaves ordinary prose alone', () => {
    const { text, terms } = protectTerms('这是一段普通的中文说明文字。')

    expect(text).toBe('这是一段普通的中文说明文字。')
    expect(terms).toHaveLength(0)
  })

  it('cannot match its own output', () => {
    // Load-bearing: `_` is a word character, so there is no boundary before the `L` in
    // __LEXI_TERM_0__ and the acronym rule skips it. The inline-markup work will compose
    // a second pass over the same prefix and depends on this holding.
    const once = protectTerms('See the API docs')
    const twice = protectTerms(once.text)

    expect(twice.terms).toHaveLength(0)
    expect(twice.text).toBe(once.text)
  })
})

describe('restoreTerms', () => {
  it('round-trips unchanged text', () => {
    const source = 'Deploy the API to https://example.com with `kubectl apply`.'
    const { text, terms } = protectTerms(source)

    expect(restoreTerms(text, terms)).toBe(source)
  })

  it('restores tokens the engine reordered', () => {
    const { terms } = protectTerms('The API returns JSON')
    // Engines reflow word order freely, especially into Chinese.
    expect(restoreTerms('__LEXI_TERM_1__ 由 __LEXI_TERM_0__ 返回', terms)).toBe('JSON 由 API 返回')
  })

  it('restores a token the engine duplicated', () => {
    const { terms } = protectTerms('the API')
    expect(restoreTerms('__LEXI_TERM_0__ 和 __LEXI_TERM_0__', terms)).toBe('API 和 API')
  })

  it('loses only the dropped term when the engine eats a token', () => {
    // A missing token must cost one term, never the whole translation.
    const { terms } = protectTerms('The API returns JSON')
    expect(restoreTerms('返回 __LEXI_TERM_1__', terms)).toBe('返回 JSON')
  })
})
