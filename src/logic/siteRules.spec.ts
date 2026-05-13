import { describe, expect, it } from 'vitest'
import { defaultSettings, mergeSettings } from './defaults'
import { findSpecialSiteProfile, isPageEnabled, isSceneEnabled, parseDomainList } from './siteRules'

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
        specialProfiles: [],
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

  it('disables learning exam profiles by default', () => {
    expect(isSceneEnabled(defaultSettings, 'selection', 'https://mooc1.chaoxing.com/exam')).toBe(false)
    expect(findSpecialSiteProfile(defaultSettings, 'https://x.com/home')?.dynamicScan).toBe(true)
  })

  it('keeps X and Twitter selection enabled', () => {
    expect(isSceneEnabled(defaultSettings, 'selection', 'https://x.com/home')).toBe(true)
    expect(isSceneEnabled(defaultSettings, 'selection', 'https://mobile.twitter.com/home')).toBe(true)
  })

  it('detects self-hosted Discourse sites from page hints', () => {
    const profile = findSpecialSiteProfile(defaultSettings, 'https://forum.example.dev/t/topic/1', { discourse: true })

    expect(profile).toMatchObject({
      id: 'discourse',
      kind: 'forum-feed',
      dynamicScan: true,
      conservative: true,
      domains: ['forum.example.dev'],
    })
    expect(isSceneEnabled(defaultSettings, 'replacement', 'https://forum.example.dev/t/topic/1', { discourse: true })).toBe(true)
  })
})
