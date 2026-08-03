import { describe, expect, it } from 'vitest'
import type { LexiSettings, SiteSceneRule } from './types'
import { defaultSettings, mergeSettings } from './defaults'

describe('settings compatibility', () => {
  it('promotes a legacy global AI connection to the default provider', () => {
    const legacyAi = {
      global: {
        endpoint: 'https://legacy.example.com/v1',
        apiKey: 'legacy-key',
        model: 'legacy-model',
      },
    } as unknown as LexiSettings['ai']

    const settings = mergeSettings({ ai: legacyAi })

    expect(settings.ai.providers).toHaveLength(1)
    expect(settings.ai.providers[0]).toMatchObject({
      id: 'default',
      endpoint: 'https://legacy.example.com/v1',
      apiKey: 'legacy-key',
      model: 'legacy-model',
    })
    expect(settings.ai.selection).toEqual(defaultSettings.ai.selection)
  })

  it('converts the legacy 1-5 difficulty ceiling into a learner level', () => {
    const legacyReplacement = {
      enabled: true,
      density: 0.12,
      minTextLength: 18,
      maxPerPage: 18,
      difficulty: 4,
    } as unknown as LexiSettings['replacement']

    const settings = mergeSettings({ replacement: legacyReplacement })

    expect(settings.replacement.level).toBe(7)
    expect(settings.replacement).not.toHaveProperty('difficulty')
  })

  it('clamps a stored density into the 1% - 35% range', () => {
    const settings = mergeSettings({
      replacement: {
        ...defaultSettings.replacement,
        density: 0.9,
      },
    })

    expect(settings.replacement.density).toBe(0.35)
  })

  it('keeps NSFW content digest disabled for defaults and legacy settings', () => {
    expect(defaultSettings.contentDigest.allowNsfw).toBe(false)
    expect(mergeSettings({ contentDigest: undefined }).contentDigest.allowNsfw).toBe(false)
    expect(mergeSettings({
      contentDigest: {
        ...defaultSettings.contentDigest,
        allowNsfw: true,
      },
    }).contentDigest.allowNsfw).toBe(true)
  })

  it('adds the digest AI scene and enables it in legacy domain rules', () => {
    const settings = mergeSettings({
      siteRules: {
        ...defaultSettings.siteRules,
        sceneRules: [{
          domain: 'example.com',
          replacement: true,
          selection: true,
          daily: true,
          omni: true,
        } as unknown as SiteSceneRule],
      },
    })

    expect(settings.ai.digest).toEqual(defaultSettings.ai.digest)
    expect(settings.siteRules.sceneRules[0].digest).toBe(true)
  })

  it('migrates the old dialog shortcut to the current default', () => {
    const settings = mergeSettings({
      ui: {
        ...defaultSettings.ui,
        dialogShortcut: 'mod+k',
      },
    })

    expect(settings.ui.dialogShortcut).toBe(defaultSettings.ui.dialogShortcut)
  })
})
