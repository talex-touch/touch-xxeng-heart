import type { BrowserContext, Page } from '@playwright/test'
import { expect, settingsStorageKey, test } from './fixtures'

declare const chrome: {
  storage: {
    local: {
      get: (key: string | null) => Promise<Record<string, unknown>>
      set: (items: Record<string, unknown>) => Promise<void>
    }
    sync: {
      get: (key: string | null) => Promise<Record<string, unknown>>
      set: (items: Record<string, unknown>) => Promise<void>
    }
  }
}

/** The sync-area wire format: one meta record naming contiguous 2000-char chunks. */
const syncMetaKey = 'lexi-sync-settings-meta'
const syncChunkPrefix = 'lexi-sync-settings-chunk-'
const syncChunkChars = 2000

/** Recognisable credentials: the local one must survive, the mirrored one must not. */
const localApiKey = 'LOCAL-KEY-KEEP-ME'
const mirroredApiKey = 'REMOTE-KEY-MUST-BE-SCRUBBED'
const deviceApiKey = 'FRESH-DEVICE-KEY-MUST-NOT-LEAVE'

const migrationCallout = '旧版本曾默认允许同步 API Key。Lexi 已关闭该选项，并会从浏览器同步快照中移除已有 Key；其他设备需要重新填写。'

interface StoredSettings {
  sync: Record<string, unknown>
  ai: { providers: Array<Record<string, unknown>> }
  replacement: Record<string, unknown>
  [key: string]: unknown
}

/**
 * The settings exactly as they sit in the local area — never a merged read, which would
 * normalize the legacy sync policy before the migration can be credited with it.
 */
function readStoredSettings(page: Page): Promise<StoredSettings | undefined> {
  return page.evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key)
    if (typeof stored[key] !== 'string')
      return undefined

    return JSON.parse(stored[key] as string) as StoredSettings
  }, settingsStorageKey)
}

/** The sync area verbatim, so a scrub that left the string behind somewhere still shows. */
function readSyncItems(page: Page) {
  return page.evaluate(async () => await chrome.storage.sync.get(null) as Record<string, unknown>)
}

/**
 * Decodes the mirror the way `readSyncSnapshot` does: the meta record must name every
 * contiguous chunk and their joined length must match its recorded length.
 */
function decodeMirror(items: Record<string, unknown>) {
  const rawMeta = items[syncMetaKey]
  if (typeof rawMeta !== 'string')
    return undefined

  const meta = JSON.parse(rawMeta) as { chunks?: number, length?: number }
  if (typeof meta.chunks !== 'number' || typeof meta.length !== 'number')
    return undefined

  const chunks = Array.from({ length: meta.chunks }, (_, index) => items[`${syncChunkPrefix}${index}`])
  if (chunks.some(chunk => typeof chunk !== 'string'))
    return undefined

  const payload = (chunks as string[]).join('')
  if (payload.length !== meta.length)
    return undefined

  return JSON.parse(payload).settings as StoredSettings
}

async function openSyncSettings(page: Page, extensionId: string) {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.getByRole('tab', { name: '基础设置' }).click()
  await page.getByRole('tablist', { name: '基础设置分区' }).getByRole('tab', { name: '同步', exact: true }).click()
  await expect(page.getByRole('heading', { name: '同步到 Google 账号' })).toBeVisible()

  // The options page owns the first write of the settings object, so anything patched
  // before that write is silently overwritten.
  await expect.poll(() => page.evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key)
    return typeof stored[key] === 'string'
  }, settingsStorageKey)).toBe(true)
}

/**
 * A profile from before the policy change: sync is off and the stored policy still says a
 * key may travel.
 */
async function seedLegacyProfile(page: Page, providerIndex: number) {
  await page.evaluate(async ({ settingsKey, index, keep }) => {
    const stored = await chrome.storage.local.get(settingsKey)
    const settings = JSON.parse(stored[settingsKey] as string)
    settings.sync = {
      ...settings.sync,
      enabled: false,
      includeApiKeys: true,
      apiKeySyncConsentVersion: 0,
      apiKeySyncMigrationNotice: false,
    }
    settings.ai.providers[index] = { ...settings.ai.providers[index], apiKey: keep }
    await chrome.storage.local.set({ [settingsKey]: JSON.stringify(settings) })
  }, { settingsKey: settingsStorageKey, index: providerIndex, keep: localApiKey })
}

/**
 * The mirror an older build left behind: the current settings with a key in every provider.
 * Built from the live settings so `readSyncSnapshot` still accepts the chunks.
 */
async function seedMirroredApiKeys(page: Page) {
  await page.evaluate(async ({ settingsKey, mirrored, metaKey, chunkPrefix, chunkChars }) => {
    const stored = await chrome.storage.local.get(settingsKey)
    const settings = JSON.parse(stored[settingsKey] as string)
    const mirrorSource = {
      ...settings,
      ai: {
        ...settings.ai,
        providers: settings.ai.providers.map((provider: Record<string, unknown>) => ({ ...provider, apiKey: mirrored })),
      },
    }
    const payload = JSON.stringify({ v: 1, settings: mirrorSource })
    const chunks = Array.from(
      { length: Math.ceil(payload.length / chunkChars) },
      (_, index) => payload.slice(index * chunkChars, index * chunkChars + chunkChars),
    )
    const items: Record<string, string> = {
      [metaKey]: JSON.stringify({
        v: 1,
        updatedAt: Date.now(),
        chunks: chunks.length,
        length: payload.length,
        deviceId: 'legacy-device',
      }),
    }
    chunks.forEach((chunk, index) => {
      items[`${chunkPrefix}${index}`] = chunk
    })
    await chrome.storage.sync.set(items)
  }, {
    settingsKey: settingsStorageKey,
    mirrored: mirroredApiKey,
    metaKey: syncMetaKey,
    chunkPrefix: syncChunkPrefix,
    chunkChars: syncChunkChars,
  })
}

/**
 * `enforceApiKeySyncPolicy` runs once per service-worker startup, so the policy is only
 * enforced against the stored profile when the worker genuinely restarts. Chrome offers no
 * script-level restart here: `chrome.runtime.reload()` unloads a `--load-extension` build
 * for good, so the worker is stopped and started over the DevTools protocol instead.
 */
async function restartServiceWorker(context: BrowserContext, page: Page, extensionId: string) {
  const cdp = await context.newCDPSession(page)
  await cdp.send('ServiceWorker.enable' as never)
  await cdp.send('ServiceWorker.stopAllWorkers' as never)
  await cdp.send('ServiceWorker.startWorker' as never, { scopeURL: `chrome-extension://${extensionId}/` } as never)
}

test('a legacy profile revokes implicit API key sync and scrubs the mirrored keys', async ({ context, page, extensionId }) => {
  test.setTimeout(60_000)
  await openSyncSettings(page, extensionId)
  await seedLegacyProfile(page, 0)
  await restartServiceWorker(context, page, extensionId)

  // The stored opt-in alone carries the migration: a profile that never uploaded anything
  // still has its policy revoked and the reader told, so this half is asserted before the
  // mirror exists. (A mirror holding a key revokes the policy on its own, so a single
  // restart with both in place would pass even with the legacy detection removed.)
  await expect.poll(async () => (await readStoredSettings(page))?.sync.apiKeySyncMigrationNotice, { timeout: 15_000 }).toBe(true)

  const migrated = await readStoredSettings(page)
  expect(migrated?.sync.includeApiKeys).toBe(false)
  expect(migrated?.sync.apiKeySyncConsentVersion).toBe(0)
  // Revoking the sharing policy must not destroy the credential on this device.
  expect(migrated?.ai.providers[0].apiKey).toBe(localApiKey)

  await expect(page.getByText(migrationCallout)).toBeVisible()
  await expect(page.getByRole('switch', { name: '同步中包含 API Key' })).toHaveAttribute('aria-checked', 'false')

  // A policy migration is not an upload: a profile with sync off gains no snapshot.
  expect(decodeMirror(await readSyncItems(page))).toBeUndefined()

  await seedMirroredApiKeys(page)
  await restartServiceWorker(context, page, extensionId)

  await expect.poll(async () => {
    const providers = decodeMirror(await readSyncItems(page))?.ai.providers
    if (!providers?.length)
      return undefined

    return providers.every(provider => provider.apiKey === '')
  }, { timeout: 15_000 }).toBe(true)

  // A scrub that leaves the string anywhere in the mirror is not a scrub.
  expect(JSON.stringify(await readSyncItems(page))).not.toContain(mirroredApiKey)
  expect((await readStoredSettings(page))?.ai.providers[0].apiKey).toBe(localApiKey)
})

test('turning sync on from a fresh profile never mirrors the provider API key', async ({ page, extensionId }) => {
  test.setTimeout(60_000)
  await openSyncSettings(page, extensionId)

  await page.getByRole('switch', { name: '启用同步' }).click()
  await expect.poll(async () => (await readStoredSettings(page))?.sync.enabled, { timeout: 15_000 }).toBe(true)

  // A credential on this device plus an unrelated settings change, so the mirror is
  // rewritten by a real push rather than left over from the first upload.
  const bumpedLevel = await page.evaluate(async ({ settingsKey, apiKey }) => {
    const stored = await chrome.storage.local.get(settingsKey)
    const settings = JSON.parse(stored[settingsKey] as string)
    const current = typeof settings.replacement.level === 'number' ? settings.replacement.level : 5
    const level = current === 9 ? 8 : (current as number) + 1
    settings.replacement.level = level
    settings.ai.providers[0] = { ...settings.ai.providers[0], apiKey }
    await chrome.storage.local.set({ [settingsKey]: JSON.stringify(settings) })
    return level
  }, { settingsKey: settingsStorageKey, apiKey: deviceApiKey })

  await expect.poll(async () => decodeMirror(await readSyncItems(page))?.replacement.level, { timeout: 15_000 }).toBe(bumpedLevel)

  const mirrored = decodeMirror(await readSyncItems(page))
  expect(mirrored?.ai.providers[0].apiKey).toBe('')
  expect(JSON.stringify(await readSyncItems(page))).not.toContain(deviceApiKey)

  // The credential is still on this device: the mirror is empty because it was withheld.
  expect((await readStoredSettings(page))?.ai.providers[0].apiKey).toBe(deviceApiKey)
})
