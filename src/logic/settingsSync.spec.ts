import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeSettings } from './defaults'
import {
  getDeviceId,
  mergeRemoteSettings,
  pullSettingsFromSync,
  pushSettingsToSync,
  readSyncSnapshot,
  toSyncPayload,
} from './settingsSync'
import { settingsStorageKey, syncSettingsChunkPrefix, syncSettingsMetaKey } from './storageKeys'
import type { LexiSettings } from './types'

const areas = {
  local: new Map<string, unknown>(),
  sync: new Map<string, unknown>(),
}

function createArea(store: Map<string, unknown>) {
  return {
    async get(keys?: string | string[] | null) {
      if (keys == null)
        return Object.fromEntries(store)

      const list = Array.isArray(keys) ? keys : [keys]
      return Object.fromEntries(list.filter(key => store.has(key)).map(key => [key, store.get(key)]))
    },
    async set(items: Record<string, unknown>) {
      for (const [key, value] of Object.entries(items))
        store.set(key, value)
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys])
        store.delete(key)
    },
    async getBytesInUse() {
      return [...store.values()].reduce<number>((sum, value) => sum + JSON.stringify(value).length, 0)
    },
  }
}

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      get local() {
        return createArea(areas.local)
      },
      get sync() {
        return createArea(areas.sync)
      },
    },
  },
}))

function createSettings(patch: (settings: LexiSettings) => void = () => {}) {
  const settings = mergeSettings()
  settings.ai.providers[0] = {
    ...settings.ai.providers[0],
    endpoint: 'https://api.example.com/v1',
    apiKey: 'sk-secret',
    model: 'gpt-4.1-mini',
  }
  settings.ai.approvedHttpEndpoints = ['http://localhost:11434']
  patch(settings)
  return settings
}

function syncChunkKeys() {
  return [...areas.sync.keys()].filter(key => key.startsWith(syncSettingsChunkPrefix) && key !== syncSettingsMetaKey)
}

describe('sync payload', () => {
  beforeEach(() => {
    areas.local.clear()
    areas.sync.clear()
  })

  it('keeps device-local state out of the payload', () => {
    const payload = toSyncPayload(createSettings()) as Partial<LexiSettings>

    expect(payload).not.toHaveProperty('sync')
    expect(payload.ai?.approvedHttpEndpoints).toEqual([])
    expect(payload.ai?.providers[0].apiKey).toBe('sk-secret')
  })

  it('blanks API keys when the user opted out', () => {
    const settings = createSettings((value) => {
      value.sync.includeApiKeys = false
    })

    expect(toSyncPayload(settings).ai.providers[0].apiKey).toBe('')
  })

  it('restores the local API key when the remote snapshot has none', () => {
    const local = createSettings()
    const remote = toSyncPayload(createSettings((value) => {
      value.sync.includeApiKeys = false
      value.replacement.level = 8
    }))

    const merged = mergeRemoteSettings(local, remote as Partial<LexiSettings>)

    expect(merged.replacement.level).toBe(8)
    expect(merged.ai.providers[0].apiKey).toBe('sk-secret')
    expect(merged.ai.approvedHttpEndpoints).toEqual(['http://localhost:11434'])
    expect(merged.sync).toEqual(local.sync)
  })
})

describe('sync transport', () => {
  beforeEach(() => {
    areas.local.clear()
    areas.sync.clear()
  })

  it('chunks the payload under the 8 KB per-item cap and round-trips it', async () => {
    const settings = createSettings((value) => {
      value.ui.customCss = '中'.repeat(4000)
    })

    const result = await pushSettingsToSync(settings, 1000)
    const snapshot = await readSyncSnapshot()

    expect(result.chunks).toBeGreaterThan(1)
    expect(syncChunkKeys()).toHaveLength(result.chunks)
    for (const key of syncChunkKeys())
      expect(new TextEncoder().encode(areas.sync.get(key) as string).length).toBeLessThanOrEqual(8192)

    expect(snapshot?.updatedAt).toBe(1000)
    expect(snapshot?.settings.ui?.customCss).toBe('中'.repeat(4000))
  })

  it('drops chunks left behind by a larger previous payload', async () => {
    await pushSettingsToSync(createSettings((value) => {
      value.ui.customCss = '中'.repeat(4000)
    }), 1000)
    const before = syncChunkKeys().length

    await pushSettingsToSync(createSettings(), 2000)

    expect(syncChunkKeys().length).toBeLessThan(before)
    expect(await readSyncSnapshot()).toBeDefined()
  })

  it('refuses a payload that cannot fit the sync quota', async () => {
    const settings = createSettings((value) => {
      value.ui.customCss = 'a'.repeat(120000)
    })

    await expect(pushSettingsToSync(settings)).rejects.toThrow(/超出 Google 同步配额/)
    expect(areas.sync.size).toBe(0)
  })

  it('tags the snapshot with a stable device id', async () => {
    await pushSettingsToSync(createSettings(), 1000)
    const snapshot = await readSyncSnapshot()

    expect(snapshot?.deviceId).toBe(await getDeviceId())
  })

  it('writes a pulled snapshot into local settings', async () => {
    await pushSettingsToSync(createSettings((value) => {
      value.history.maxRecords = 5000
    }), 4200)
    areas.local.delete(settingsStorageKey)

    const pulled = await pullSettingsFromSync()

    expect(pulled?.history.maxRecords).toBe(5000)
    expect(pulled?.sync.lastPulledAt).toBe(4200)
    expect(JSON.parse(areas.local.get(settingsStorageKey) as string).history.maxRecords).toBe(5000)
  })

  it('reports no snapshot when the sync area is empty', async () => {
    expect(await readSyncSnapshot()).toBeUndefined()
    expect(await pullSettingsFromSync()).toBeUndefined()
  })

  it('ignores a half-replicated snapshot instead of importing broken settings', async () => {
    await pushSettingsToSync(createSettings((value) => {
      value.ui.customCss = '中'.repeat(4000)
    }), 1000)
    areas.sync.delete(`${syncSettingsChunkPrefix}1`)

    expect(await readSyncSnapshot()).toBeUndefined()
    expect(areas.sync.has(syncSettingsMetaKey)).toBe(true)
  })
})
