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

  it('injects the MAIN-world YouTube caption bridge in Chromium only', async () => {
    const manifest = await getManifestFor('chromium')
    const scripts = manifest.content_scripts ?? []

    const bridgeEntry = {
      matches: ['https://youtube.com/*', 'https://*.youtube.com/*'],
      run_at: 'document_start',
      world: 'MAIN',
      js: ['dist/contentScripts/youtube-main.global.js'],
    }

    expect(scripts.filter(entry => entry.js?.includes('dist/contentScripts/youtube-main.global.js'))).toEqual([bridgeEntry])
    expect(scripts.filter(entry => entry.world === 'MAIN')).toEqual([bridgeEntry])
  })

  it('never injects the MAIN-world YouTube bridge in Firefox', async () => {
    const manifest = await getManifestFor('firefox')
    const scripts = manifest.content_scripts ?? []

    expect(scripts.some(entry => entry.js?.includes('dist/contentScripts/youtube-main.global.js'))).toBe(false)
    expect(scripts.some(entry => entry.world === 'MAIN')).toBe(false)
    expect(scripts.map(entry => entry.js)).toEqual([
      ['dist/contentScripts/index.global.js'],
      ['dist/contentScripts/frame.global.js'],
    ])
  })
})
