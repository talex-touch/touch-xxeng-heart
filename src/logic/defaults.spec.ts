import { describe, expect, it } from 'vitest'
import type { LexiSettings, SiteSceneRule } from './types'
import { defaultSettings, maxEntityLimit, mergeSettings, minEntityLimit } from './defaults'

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

  it('folds a legacy scene override into its own provider and binds the scene to it', () => {
    const legacyAi = {
      global: { endpoint: 'https://global.example.com/v1', apiKey: 'global-key', model: 'global-model' },
      providers: [{ id: 'default', label: '默认 Provider', enabled: true, endpoint: '', apiKey: '', model: '' }],
      selection: { enabled: true, endpoint: 'https://scene.example.com/v1', model: 'scene-model', prompt: '译文' },
    } as unknown as LexiSettings['ai']

    const settings = mergeSettings({ ai: legacyAi })
    const legacyProvider = settings.ai.providers.find(provider => provider.id === 'legacy-selection')

    // The global connection fills the gaps the provider left empty.
    expect(settings.ai.providers[0]).toMatchObject({
      id: 'default',
      endpoint: 'https://global.example.com/v1',
      model: 'global-model',
      apiKey: 'global-key',
      protocol: 'auto',
    })
    expect(legacyProvider).toMatchObject({
      endpoint: 'https://scene.example.com/v1',
      model: 'scene-model',
      apiKey: 'global-key',
    })
    expect(settings.ai.selection.providerIds).toEqual(['legacy-selection'])
    expect(settings.ai.selection).not.toHaveProperty('endpoint')
  })

  it('keeps the scene migration idempotent across repeated merges', () => {
    const legacyAi = {
      selection: { enabled: true, endpoint: 'https://scene.example.com/v1' },
    } as unknown as LexiSettings['ai']

    const once = mergeSettings({ ai: legacyAi })
    const twice = mergeSettings(once)

    expect(twice.ai.providers).toHaveLength(once.ai.providers.length)
    expect(twice.ai.selection.providerIds).toEqual(['legacy-selection'])
  })

  it('defaults the vocabulary ceiling to 3000 and clamps hand-edited values', () => {
    expect(defaultSettings.history.maxRecords).toBe(3000)
    expect(mergeSettings({ history: { enabled: true, maxRecords: 99999 } }).history.maxRecords).toBe(20000)
    expect(mergeSettings({ history: { enabled: true, maxRecords: 1 } }).history.maxRecords).toBe(50)
    expect(mergeSettings({ history: { enabled: true, maxRecords: Number.NaN } }).history.maxRecords).toBe(3000)
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

  it('fills in entity detection for settings written before it existed', () => {
    const { entityDetection, ...legacy } = defaultSettings
    const settings = mergeSettings({
      ...legacy,
      siteRules: {
        ...defaultSettings.siteRules,
        sceneRules: [{
          domain: 'example.com',
          replacement: true,
          selection: true,
          daily: true,
          digest: true,
          omni: true,
        } as unknown as SiteSceneRule],
      },
    })

    expect(settings.entityDetection).toEqual(defaultSettings.entityDetection)
    expect(settings.ai.entity).toEqual(defaultSettings.ai.entity)
    expect(settings.siteRules.sceneRules[0].entity).toBe(true)
  })

  it('keeps a hand-edited entity budget inside the range the options page allows', () => {
    const tooMany = mergeSettings({ entityDetection: { ...defaultSettings.entityDetection, maxPerPage: 5000 } })
    const tooFew = mergeSettings({ entityDetection: { ...defaultSettings.entityDetection, maxPerPage: 0 } })

    expect(tooMany.entityDetection.maxPerPage).toBe(maxEntityLimit)
    expect(tooFew.entityDetection.maxPerPage).toBe(minEntityLimit)
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

  it('uses English when a legacy replacement setting has no display mode and preserves saved modes', () => {
    const legacySettings = mergeSettings({
      replacement: {} as LexiSettings['replacement'],
    })
    expect(legacySettings.replacement.displayMode).toBe('english')

    for (const displayMode of ['chinese', 'bilingual'] as const) {
      const settings = mergeSettings({
        replacement: { displayMode } as unknown as LexiSettings['replacement'],
      })

      expect(settings.replacement.displayMode).toBe(displayMode)
    }
  })

  it('keeps platform auto translation opt-in: every auto site defaults to off', () => {
    expect(defaultSettings.selection.pageTranslation.autoSites).toEqual({
      'discourse': false,
      'github-readme': false,
      'reddit': false,
    })

    // A legacy blob without the field must not silently opt pages in either.
    const settings = mergeSettings({
      selection: {} as LexiSettings['selection'],
    })
    expect(Object.values(settings.selection.pageTranslation.autoSites)).not.toContain(true)
  })

  it('drops the retired card presets that pinned the translation card to one theme', () => {
    const light = mergeSettings({
      ui: { customCss: '.lexi-selection-translation { background: #fff; border-color: #d4d9e2; }' } as LexiSettings['ui'],
    })
    const dark = mergeSettings({
      ui: { customCss: '.lexi-selection-translation { background: #111827; color: #f9fafb; border-color: #60a5fa; }' } as LexiSettings['ui'],
    })

    expect(light.ui.customCss).toBe('')
    expect(dark.ui.customCss).toBe('')
  })

  it('keeps hand-written custom CSS, including the still-supported compact preset', () => {
    const handWritten = '.lexi-token { color: #2563eb; }'
    const compact = '.lexi-selection-translation { max-width: 30rem; padding: 10px 12px; }'

    expect(mergeSettings({ ui: { customCss: handWritten } as LexiSettings['ui'] }).ui.customCss).toBe(handWritten)
    expect(mergeSettings({ ui: { customCss: compact } as LexiSettings['ui'] }).ui.customCss).toBe(compact)
  })
})
