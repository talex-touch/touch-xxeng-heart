import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nexusDeviceIdStorageKey, nexusTokenBundleStorageKey } from '../logic/storageKeys'
import { NEXUS_BASE_URL } from '../logic/nexusClient'

/**
 * The worker's Nexus channel holds the only credential Lexi ever stores.
 *
 * These tests attack the boundaries that matter: tokens must reach `storage.session` and
 * nowhere else, a server-supplied link must never move the caller to another origin, a
 * caller-supplied path must never move the request off the canonical origin, and refresh
 * must be single-flight with exactly one retry so a 401 cannot stampede or double-spend.
 */

const state = vi.hoisted(() => ({
  local: new Map<string, unknown>(),
  session: new Map<string, unknown>(),
  hasSession: true,
  sessionBroken: false,
  accessLevels: [] as string[],
  listeners: [] as Array<(message: unknown) => unknown>,
}))

vi.mock('webextension-polyfill', () => {
  const createArea = (store: Map<string, unknown>) => ({
    async get(keys?: string | string[]) {
      const list = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys]
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
  })

  const sessionArea = {
    async get(key: string) {
      if (state.sessionBroken)
        throw new Error('session area unavailable')
      return state.session.has(key) ? { [key]: state.session.get(key) } : {}
    },
    async set(items: Record<string, unknown>) {
      if (state.sessionBroken)
        throw new Error('session area unavailable')
      for (const [key, value] of Object.entries(items))
        state.session.set(key, value)
    },
    async remove(key: string) {
      if (state.sessionBroken)
        throw new Error('session area unavailable')
      state.session.delete(key)
    },
    async setAccessLevel(options: { accessLevel: string }) {
      state.accessLevels.push(options.accessLevel)
    },
  }

  return {
    default: {
      storage: {
        local: createArea(state.local),
        get session() {
          return state.hasSession ? sessionArea : undefined
        },
      },
      runtime: {
        onMessage: {
          addListener: (listener: (message: unknown) => unknown) => {
            state.listeners.push(listener)
          },
          removeListener: () => {},
        },
      },
    },
  }
})

interface Failure {
  name?: string
  kind?: string
  message?: string
}

async function captureFailure(promise: Promise<unknown>): Promise<Failure> {
  try {
    await promise
  }
  catch (error) {
    return error as Failure
  }

  throw new Error('expected the call to reject, but it resolved')
}

/** Feeds one runtime message to whichever registered listener claims it. */
async function dispatchNexusMessage(message: unknown) {
  for (const listener of state.listeners) {
    const result = listener(message)
    if (result !== undefined)
      return await result
  }

  return undefined
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** A fresh Response per call: a body can only be read once. */
function stubFetch(...responses: Array<Response | (() => Response)>) {
  const queue = [...responses]
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = queue.shift()
    if (!next)
      throw new Error('unexpected fetch call')
    return typeof next === 'function' ? next() : next
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function loadAuth() {
  vi.resetModules()
  return import('./nexusAuth')
}

function seedBundle(overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  state.session.set(nexusTokenBundleStorageKey, {
    accessToken: 'ak-token',
    refreshToken: 'rk-token',
    accessExpiresAt: now + 10 * 60_000,
    refreshExpiresAt: now + 30 * 24 * 60 * 60_000,
    obtainedAt: now,
    ...overrides,
  })
}

function localHoldsToken(token: string) {
  return [...state.local.values()].some(value => JSON.stringify(value).includes(token))
}

const startPayload = {
  deviceCode: 'device-code-1',
  userCode: 'USER-CODE',
  authorizeUrl: 'https://tuff.tagzxia.com/sign-in?redirect_url=%2Fdevice-auth%3Fcode%3DUSER-CODE',
  expiresAt: '2026-09-13T06:00:00.000Z',
  intervalSeconds: 3,
}

describe('nexus device authorization', () => {
  beforeEach(() => {
    vi.resetModules()
    state.local.clear()
    state.session.clear()
    state.hasSession = true
    state.sessionBroken = false
    state.accessLevels.length = 0
    state.listeners.length = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('starts the flow on the canonical origin with the persisted device id', async () => {
    const { startNexusDeviceAuthorization } = await loadAuth()
    const fetchMock = stubFetch(jsonResponse(startPayload))

    const start = await startNexusDeviceAuthorization()

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${NEXUS_BASE_URL}/api/app-auth/device/start`)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' })
    const body = JSON.parse(init.body as string)
    expect(body.clientType).toBe('external')
    expect(body.deviceId).toBe(state.local.get(nexusDeviceIdStorageKey))
    expect(start.expiresAt).toBe(startPayload.expiresAt)
    expect(start.intervalSeconds).toBe(3)
  })

  it('refuses a sign-in link that leaves the canonical origin', async () => {
    const { startNexusDeviceAuthorization } = await loadAuth()
    stubFetch(jsonResponse({ ...startPayload, authorizeUrl: 'https://evil.example/sign-in' }))

    const failure = await captureFailure(startNexusDeviceAuthorization())

    expect(failure.name).toBe('NexusAuthError')
    expect(failure.kind).toBe('invalid')
  })

  it('stores an approval only in the session area, never in local storage', async () => {
    const { pollNexusDeviceAuthorization } = await loadAuth()
    stubFetch(jsonResponse({
      status: 'approved',
      appToken: 'ak-approved',
      refreshToken: 'rk-approved',
      ttlSeconds: 86400,
      refreshTtlSeconds: 2592000,
    }))

    const result = await pollNexusDeviceAuthorization('device-code-1')

    expect(result).toEqual({ status: 'approved' })
    expect(JSON.stringify(result)).not.toContain('ak-approved')

    const bundle = state.session.get(nexusTokenBundleStorageKey) as Record<string, number | string>
    expect(bundle.accessToken).toBe('ak-approved')
    expect(bundle.refreshToken).toBe('rk-approved')
    // Expiries come from the server's ttl fields, not from a local guess.
    expect(bundle.accessExpiresAt as number).toBeGreaterThan(Date.now() + 86_000_000)
    expect(localHoldsToken('ak-approved')).toBe(false)
    expect(localHoldsToken('rk-approved')).toBe(false)
  })

  it('pins the session area to trusted contexts', async () => {
    const { pollNexusDeviceAuthorization } = await loadAuth()
    stubFetch(jsonResponse({
      status: 'approved',
      appToken: 'ak-trusted',
      refreshToken: 'rk-trusted',
      ttlSeconds: 86400,
      refreshTtlSeconds: 2592000,
    }))

    await pollNexusDeviceAuthorization('device-code-1')

    expect(state.accessLevels).toEqual(['TRUSTED_CONTEXTS'])
  })

  it('redacts a JWT-shaped device code from a rejection reason', async () => {
    const { pollNexusDeviceAuthorization } = await loadAuth()
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    stubFetch(jsonResponse({ status: 'rejected', message: `device code ${jwt} was refused` }))

    const result = await pollNexusDeviceAuthorization('device-code-1')

    expect(result.status).toBe('rejected')
    expect(result.message).not.toContain(jwt)
    expect(result.message).toContain('[已隐藏]')
  })

  it('keeps an approval usable from memory when the session area rejects reads and writes', async () => {
    state.sessionBroken = true
    const { pollNexusDeviceAuthorization, readNexusAuthStatus } = await loadAuth()
    stubFetch(jsonResponse({
      status: 'approved',
      appToken: 'ak-mirror',
      refreshToken: 'rk-mirror',
      ttlSeconds: 86400,
      refreshTtlSeconds: 2592000,
    }))

    expect(await pollNexusDeviceAuthorization('device-code-1')).toEqual({ status: 'approved' })

    const status = await readNexusAuthStatus()
    expect(status.signedIn).toBe(true)
    expect(status.accessTokenExpiresAt).toBeGreaterThan(Date.now())
    expect(localHoldsToken('ak-mirror')).toBe(false)
    expect(localHoldsToken('rk-mirror')).toBe(false)
  })

  it('keeps the state working from memory when the browser has no session area', async () => {
    state.hasSession = false
    const { pollNexusDeviceAuthorization, readNexusAuthStatus, clearNexusAuth } = await loadAuth()
    stubFetch(jsonResponse({
      status: 'approved',
      appToken: 'ak-memory',
      refreshToken: 'rk-memory',
      ttlSeconds: 86400,
      refreshTtlSeconds: 2592000,
    }))

    await pollNexusDeviceAuthorization('device-code-1')
    expect(await readNexusAuthStatus()).toMatchObject({ signedIn: true })
    expect(localHoldsToken('ak-memory')).toBe(false)

    await clearNexusAuth()
    expect(await readNexusAuthStatus()).toEqual({ signedIn: false })
  })
})

describe('nexus authorized fetch', () => {
  beforeEach(() => {
    vi.resetModules()
    state.local.clear()
    state.session.clear()
    state.hasSession = true
    state.sessionBroken = false
    state.accessLevels.length = 0
    state.listeners.length = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('attaches the bearer itself and refuses to leave the canonical origin', async () => {
    seedBundle()
    const { nexusAuthorizedFetch } = await loadAuth()
    const fetchMock = stubFetch(jsonResponse({ ok: true }))

    await nexusAuthorizedFetch('/api/v1/intelligence/invoke', {
      method: 'POST',
      body: '{}',
      headers: { 'authorization': 'Bearer attacker', 'content-type': 'application/json' },
    })

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${NEXUS_BASE_URL}/api/v1/intelligence/invoke`)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init).toMatchObject({ redirect: 'error', credentials: 'omit' })
    const headers = init.headers as Headers
    expect(headers.get('authorization')).toBe('Bearer ak-token')
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('ak-token')

    const failure = await captureFailure(nexusAuthorizedFetch('https://evil.example/api/v1/intelligence/invoke'))
    expect(failure.kind).toBe('invalid')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const protocolRelative = await captureFailure(nexusAuthorizedFetch('//evil.example/api/v1/intelligence/invoke'))
    expect(protocolRelative.kind).toBe('invalid')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('collapses concurrent proactive refreshes into one request', async () => {
    seedBundle({ accessExpiresAt: Date.now() + 60_000 })
    const { nexusAuthorizedFetch } = await loadAuth()
    const fetchMock = stubFetch(
      jsonResponse({ appToken: 'ak-fresh', ttlSeconds: 3600 }),
      jsonResponse({ invocation: {} }),
      jsonResponse({ invocation: {} }),
      jsonResponse({ invocation: {} }),
    )

    await Promise.all([
      nexusAuthorizedFetch('/api/v1/intelligence/invoke', { method: 'POST', body: '{}' }),
      nexusAuthorizedFetch('/api/v1/intelligence/invoke', { method: 'POST', body: '{}' }),
      nexusAuthorizedFetch('/api/v1/intelligence/invoke', { method: 'POST', body: '{}' }),
    ])

    const refreshCalls = fetchMock.mock.calls.filter(call => String(call[0]) === `${NEXUS_BASE_URL}/api/app-auth/refresh`)
    expect(refreshCalls).toHaveLength(1)

    const invokeCalls = fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/api/v1/intelligence/invoke'))
    expect(invokeCalls).toHaveLength(3)
    for (const call of invokeCalls)
      expect(((call[1] as RequestInit).headers as Headers).get('authorization')).toBe('Bearer ak-fresh')
  })

  it('refreshes and retries exactly once after a 401', async () => {
    seedBundle()
    const { nexusAuthorizedFetch } = await loadAuth()
    const fetchMock = stubFetch(
      new Response('', { status: 401 }),
      jsonResponse({ appToken: 'ak-retry', ttlSeconds: 3600 }),
      jsonResponse({ invocation: { result: 'ok' } }),
    )

    const response = await nexusAuthorizedFetch('/api/v1/intelligence/invoke', { method: 'POST', body: '{}' })

    expect(response.status).toBe(200)
    const invokeCalls = fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/api/v1/intelligence/invoke'))
    expect(invokeCalls).toHaveLength(2)
    expect(((invokeCalls[1][1] as RequestInit).headers as Headers).get('authorization')).toBe('Bearer ak-retry')
  })

  it('returns a repeated 401 instead of looping', async () => {
    seedBundle()
    const { nexusAuthorizedFetch } = await loadAuth()
    const fetchMock = stubFetch(
      new Response('', { status: 401 }),
      jsonResponse({ appToken: 'ak-retry', ttlSeconds: 3600 }),
      new Response('', { status: 401 }),
    )

    const response = await nexusAuthorizedFetch('/api/v1/intelligence/invoke', { method: 'POST', body: '{}' })

    expect(response.status).toBe(401)
    expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/api/app-auth/refresh'))).toHaveLength(1)
  })

  it('clears both tokens when refresh is refused', async () => {
    seedBundle()
    const { nexusAuthorizedFetch } = await loadAuth()
    const fetchMock = stubFetch(
      new Response('', { status: 401 }),
      new Response('', { status: 401 }),
    )

    const failure = await captureFailure(nexusAuthorizedFetch('/api/v1/intelligence/invoke', { method: 'POST', body: '{}' }))

    expect(failure.kind).toBe('unauthorized')
    expect(state.session.has(nexusTokenBundleStorageKey)).toBe(false)
    expect(localHoldsToken('ak-token')).toBe(false)

    const callsAfter = fetchMock.mock.calls.length
    const next = await captureFailure(nexusAuthorizedFetch('/api/v1/intelligence/invoke', { method: 'POST', body: '{}' }))
    expect(next.kind).toBe('no-token')
    expect(fetchMock.mock.calls.length).toBe(callsAfter)
  })

  it('keeps the session when refresh fails for transport reasons', async () => {
    seedBundle()
    const { nexusAuthorizedFetch } = await loadAuth()
    stubFetch(
      new Response('', { status: 401 }),
      new Response('', { status: 503 }),
    )

    const failure = await captureFailure(nexusAuthorizedFetch('/api/v1/intelligence/invoke', { method: 'POST', body: '{}' }))

    expect(failure.kind).toBe('transient')
    expect(state.session.has(nexusTokenBundleStorageKey)).toBe(true)
  })
})

describe('nexus status and credits', () => {
  beforeEach(() => {
    vi.resetModules()
    state.local.clear()
    state.session.clear()
    state.hasSession = true
    state.sessionBroken = false
    state.accessLevels.length = 0
    state.listeners.length = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports sign-in state without ever exposing a token', async () => {
    seedBundle()
    const { readNexusAuthStatus } = await loadAuth()

    const status = await readNexusAuthStatus()

    expect(status.signedIn).toBe(true)
    expect(Object.keys(status).sort()).toEqual(['accessTokenExpiresAt', 'signedIn'])
    expect(JSON.stringify(status)).not.toContain('ak-token')
  })

  it('normalizes the credit summary to quota/used and drops server-only fields', async () => {
    seedBundle()
    const { readNexusCredits } = await loadAuth()
    stubFetch(jsonResponse({
      month: '2026-09',
      user: { quota: 100, used: 40, remaining: 9999, plan: 'PRO', ledger: 'x' },
      team: null,
      boost: { eligible: true },
    }))

    const credits = await readNexusCredits()

    expect(credits).toEqual({ month: '2026-09', user: { quota: 100, used: 40 }, team: null })
  })

  it('answers a failable runtime command with a redacted envelope, not a token', async () => {
    const { startNexusAuthService } = await loadAuth()
    startNexusAuthService()

    const reply = await dispatchNexusMessage({ channel: 'lexi', type: 'lexi-nexus-credits', data: undefined })

    expect(reply).toMatchObject({ ok: false, kind: 'denied' })
    expect(JSON.stringify(reply)).not.toMatch(/ak-|rk-/)
  })

  it('clears both tokens when the account logs out', async () => {
    seedBundle()
    const { startNexusAuthService, readNexusAuthStatus } = await loadAuth()
    startNexusAuthService()
    expect((await readNexusAuthStatus()).signedIn).toBe(true)

    const reply = await dispatchNexusMessage({ channel: 'lexi', type: 'lexi-nexus-logout', data: undefined })

    expect(reply).toEqual({ ok: true, data: undefined })
    expect(state.session.has(nexusTokenBundleStorageKey)).toBe(false)
    expect(localHoldsToken('ak-token')).toBe(false)
    expect((await readNexusAuthStatus()).signedIn).toBe(false)
  })
})
