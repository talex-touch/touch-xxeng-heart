import browser from 'webextension-polyfill'
import {
  getDeviceId,
  mergeRemoteSettings,
  pushSettingsToSync,
  readLocalSettings,
  readSyncSnapshot,
  toSyncPayload,
  writeLocalSettings,
} from '~/logic/settingsSync'
import { settingsStorageKey, syncSettingsMetaKey } from '~/logic/storageKeys'
import type { LexiSettings } from '~/logic/types'

const pushDelayMs = 1500
let pushTimer: ReturnType<typeof setTimeout> | undefined

function serialize(settings: LexiSettings) {
  return JSON.stringify(toSyncPayload(settings))
}

async function recordSyncState(settings: LexiSettings, patch: Partial<LexiSettings['sync']>) {
  const current = await readLocalSettings()
  await writeLocalSettings({ ...current, sync: { ...current.sync, ...patch } })
  return settings
}

/**
 * Mirrors local settings into the sync area.
 *
 * Nothing is written when the payload already matches what is stored remotely — applying a
 * remote snapshot writes local settings, which would otherwise bounce straight back and
 * burn through the write-rate quota.
 */
async function push() {
  const settings = await readLocalSettings()
  if (!settings.sync.enabled)
    return

  const payload = serialize(settings)
  const snapshot = await readSyncSnapshot()
  if (snapshot && JSON.stringify(snapshot.settings) === payload)
    return

  try {
    const result = await pushSettingsToSync(settings)
    await recordSyncState(settings, { lastSyncedAt: result.updatedAt, lastError: '' })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : '同步失败'
    console.warn('[Lexi] settings sync push failed', error)
    await recordSyncState(settings, { lastError: message })
  }
}

function schedulePush() {
  if (pushTimer)
    clearTimeout(pushTimer)

  pushTimer = setTimeout(() => {
    pushTimer = undefined
    void push()
  }, pushDelayMs)
}

async function applyRemote() {
  const local = await readLocalSettings()
  if (!local.sync.enabled)
    return

  const snapshot = await readSyncSnapshot()
  if (!snapshot)
    return

  // Our own writes come back as sync events too; only another profile's snapshot wins.
  if (snapshot.deviceId === await getDeviceId() || snapshot.updatedAt <= local.sync.lastPulledAt)
    return

  if (JSON.stringify(snapshot.settings) === serialize(local))
    return

  const merged = mergeRemoteSettings(local, snapshot.settings)
  await writeLocalSettings({
    ...merged,
    sync: { ...merged.sync, lastPulledAt: snapshot.updatedAt, lastError: '' },
  })
}

export function startSettingsSync() {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && settingsStorageKey in changes) {
      schedulePush()
      return
    }

    if (areaName === 'sync' && syncSettingsMetaKey in changes)
      void applyRemote()
  })

  // A profile that was offline while another device changed settings catches up here.
  void applyRemote().then(push).catch((error: unknown) => console.warn('[Lexi] settings sync startup failed', error))
}
