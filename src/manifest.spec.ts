import { afterEach, describe, expect, it, vi } from 'vitest'

async function getManifestFor(extension: 'chromium' | 'firefox') {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('EXTENSION', extension === 'firefox' ? 'firefox' : '')
  vi.resetModules()

  const { getManifest } = await import('./manifest')
  return getManifest()
}

describe('extension manifest variants', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('uses the Chromium service worker and side panel manifest fields', async () => {
    const manifest = await getManifestFor('chromium')

    expect(manifest.background).toEqual({
      service_worker: 'dist/background/index.mjs',
    })
    expect(manifest.side_panel).toEqual({
      default_path: 'dist/sidepanel/index.html',
    })
    expect(manifest).not.toHaveProperty('browser_specific_settings')
    expect(manifest).not.toHaveProperty('sidebar_action')
  })

  it('uses a stable Gecko ID and Firefox sidebar manifest fields', async () => {
    const manifest = await getManifestFor('firefox')

    expect(manifest.background).toEqual({
      scripts: ['dist/background/index.mjs'],
      type: 'module',
    })
    expect(manifest.browser_specific_settings).toEqual({
      gecko: {
        id: 'lexi@tagzxia.com',
        strict_min_version: '112.0',
      },
    })
    expect(manifest.sidebar_action).toEqual({
      default_panel: 'dist/sidepanel/index.html',
    })
    expect(manifest).not.toHaveProperty('minimum_chrome_version')
    expect(manifest).not.toHaveProperty('side_panel')
  })
})
