import { describe, expect, it } from 'vitest'
import { defaultSettings, mergeSettings } from './defaults'
import { isPageEnabled, parseDomainList } from './siteRules'

describe('site rules', () => {
  it('enables all pages by default', () => {
    expect(isPageEnabled(defaultSettings, 'https://docs.example.com/a')).toBe(true)
  })

  it('supports allowlist domains and subdomains', () => {
    const settings = mergeSettings({
      siteRules: {
        enabled: true,
        mode: 'allowlist',
        domains: ['example.com'],
        sceneRules: [],
      },
    })

    expect(isPageEnabled(settings, 'https://docs.example.com/a')).toBe(true)
    expect(isPageEnabled(settings, 'https://other.test/a')).toBe(false)
  })

  it('normalizes textarea domain input', () => {
    expect(parseDomainList('https://a.com/path\nb.com, c.com ')).toEqual(['a.com', 'b.com', 'c.com'])
  })

  it('keeps merged settings valid from plain objects', () => {
    const settings = mergeSettings({
      replacement: {
        ...defaultSettings.replacement,
        difficulty: 4,
      },
    })

    expect(settings.replacement.difficulty).toBe(4)
    expect(settings.ai.selection.enabled).toBe(false)
  })
})
