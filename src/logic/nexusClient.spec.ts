import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NEXUS_BASE_URL,
  NEXUS_PROVIDER_ID,
  createNexusProviderConfig,
  getNexusAuthStatus,
  getNexusCredits,
  logoutNexus,
  pollNexusDeviceAuth,
  startNexusDeviceAuth,
} from './nexusClient'

/**
 * The client half must be token-free by construction: every call is one runtime message to
 * the worker, and only the worker's bounded reply crosses back. These tests pin the exact
 * message envelope and the redaction of the reply, because a leak here reaches a content
 * script's world.
 */

const runtime = vi.hoisted(() => ({ sendMessage: vi.fn() }))

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      sendMessage: runtime.sendMessage,
    },
  },
}))

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

function lastMessage() {
  return runtime.sendMessage.mock.calls.at(-1)?.[0] as { channel: string, type: string, data: unknown }
}

describe('nexus runtime commands', () => {
  beforeEach(() => {
    runtime.sendMessage.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the device commands on the lexi channel and unwraps the reply', async () => {
    const start = {
      deviceCode: 'dc-1',
      userCode: 'USER',
      authorizeUrl: `${NEXUS_BASE_URL}/sign-in`,
      expiresAt: '2026-09-13T06:00:00.000Z',
      intervalSeconds: 3,
    }
    runtime.sendMessage.mockResolvedValueOnce({ ok: true, data: start })
    expect(await startNexusDeviceAuth()).toEqual(start)
    expect(lastMessage()).toEqual({ channel: 'lexi', type: 'lexi-nexus-device-start', data: undefined })

    runtime.sendMessage.mockResolvedValueOnce({ ok: true, data: { status: 'pending' } })
    expect(await pollNexusDeviceAuth('dc-1')).toEqual({ status: 'pending' })
    expect(lastMessage()).toEqual({ channel: 'lexi', type: 'lexi-nexus-device-poll', data: { deviceCode: 'dc-1' } })
  })

  it('maps a rejected worker envelope to a typed, bounded error', async () => {
    runtime.sendMessage.mockResolvedValue({ ok: false, kind: 'expired', error: 'Nexus 登录已失效，请重新登录' })

    const failure = await captureFailure(getNexusCredits())

    expect(failure.name).toBe('NexusClientError')
    expect(failure.kind).toBe('expired')
    expect(failure.message).not.toMatch(/ak-|rk-|Bearer/)
  })

  it('treats an unreachable worker and an unrecognized reply as failures', async () => {
    runtime.sendMessage.mockRejectedValueOnce(new Error('receiving end does not exist'))
    expect((await captureFailure(logoutNexus())).kind).toBe('unavailable')

    runtime.sendMessage.mockResolvedValueOnce('nonsense')
    expect((await captureFailure(getNexusCredits())).kind).toBe('unknown')
  })

  it('reads the connected account pools without inventing a remaining field', async () => {
    runtime.sendMessage.mockResolvedValueOnce({
      ok: true,
      data: { month: '2026-09', user: { quota: 100, used: 40 }, team: { quota: 10, used: 0 } },
    })

    const credits = await getNexusCredits()

    expect(credits).toEqual({ month: '2026-09', user: { quota: 100, used: 40 }, team: { quota: 10, used: 0 } })
    expect(lastMessage()).toEqual({ channel: 'lexi', type: 'lexi-nexus-credits', data: undefined })
  })
})

describe('nexus auth status', () => {
  beforeEach(() => {
    runtime.sendMessage.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('never surfaces a credential a worker reply might carry', async () => {
    runtime.sendMessage.mockResolvedValueOnce({
      signedIn: true,
      accessTokenExpiresAt: 1_700_000_000_000,
      accessToken: 'ak-leaked',
      refreshToken: 'rk-leaked',
    })

    const status = await getNexusAuthStatus()

    expect(status).toEqual({ signedIn: true, accessTokenExpiresAt: 1_700_000_000_000 })
    expect(JSON.stringify(status)).not.toContain('ak-leaked')
  })

  it('reports signed-out instead of throwing when the worker cannot answer', async () => {
    runtime.sendMessage.mockRejectedValue(new Error('worker gone'))

    expect(await getNexusAuthStatus()).toEqual({ signedIn: false })
    expect(lastMessage()).toEqual({ channel: 'lexi', type: 'lexi-nexus-auth-status', data: undefined })
  })
})

describe('nexus provider config', () => {
  it('pins the canonical endpoint, protocol and an empty credential', () => {
    const provider = createNexusProviderConfig(2)

    expect(provider).toMatchObject({
      id: NEXUS_PROVIDER_ID,
      endpoint: NEXUS_BASE_URL,
      apiKey: '',
      protocol: 'nexus-intelligence',
      enabled: false,
      priority: 2,
    })
    expect(NEXUS_BASE_URL).toBe('https://tuff.tagzxia.com')
  })
})
