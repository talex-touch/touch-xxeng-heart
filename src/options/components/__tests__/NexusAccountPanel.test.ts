// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NexusAccountPanel from '../NexusAccountPanel.vue'

/**
 * Only two boundaries are faked: the token-free Nexus client (so the panel's auth
 * transitions can be driven) and `browser.tabs.create` (the popup it opens). Everything
 * asserted below is what a user can see or what a real consumer relies on.
 */
const mocks = vi.hoisted(() => ({
  getNexusAuthStatus: vi.fn(),
  getNexusCredits: vi.fn(),
  logoutNexus: vi.fn(),
  pollNexusDeviceAuth: vi.fn(),
  startNexusDeviceAuth: vi.fn(),
  openTab: vi.fn(),
}))

vi.mock('webextension-polyfill', () => ({
  default: { tabs: { create: mocks.openTab } },
}))

vi.mock('~/logic/nexusClient', () => ({
  NEXUS_PROVIDER_ID: 'tuff-nexus',
  getNexusAuthStatus: mocks.getNexusAuthStatus,
  getNexusCredits: mocks.getNexusCredits,
  logoutNexus: mocks.logoutNexus,
  pollNexusDeviceAuth: mocks.pollNexusDeviceAuth,
  startNexusDeviceAuth: mocks.startNexusDeviceAuth,
}))

const START_TIME = Date.parse('2026-09-13T00:00:00.000Z')
const POLL_INTERVAL_MS = 5_000

function deviceStart(overrides: Partial<Record<'deviceCode' | 'userCode' | 'authorizeUrl', string>> = {}) {
  return {
    deviceCode: 'device-code-SECRET-42',
    userCode: 'HX7K-2Q9M',
    authorizeUrl: 'https://tuff.tagzxia.com/app-auth/device?user_code=HX7K-2Q9M',
    expiresAt: new Date(START_TIME + 600_000).toISOString(),
    intervalSeconds: 5,
    ...overrides,
  }
}

/** A promise the test resolves by hand, to control an in-flight poll deterministically. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START_TIME)
  mocks.openTab.mockReset().mockResolvedValue({ id: 1 })
  mocks.getNexusAuthStatus.mockReset().mockResolvedValue({ signedIn: false })
  mocks.getNexusCredits.mockReset()
  mocks.logoutNexus.mockReset().mockResolvedValue(undefined)
  mocks.startNexusDeviceAuth.mockReset()
  mocks.pollNexusDeviceAuth.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('nexusAccountPanel — signed-out state', () => {
  it('offers sign-in and no account data when the session is signed out', async () => {
    const wrapper = mount(NexusAccountPanel)
    await flushPromises()

    expect(wrapper.get('[data-nexus-status]').attributes('data-nexus-status')).toBe('signed-out')
    expect(wrapper.find('[data-nexus-action="start"]').exists()).toBe(true)
    expect(wrapper.find('[data-nexus-action="logout"]').exists()).toBe(false)
    expect(wrapper.find('[data-nexus-remaining]').exists()).toBe(false)
    expect(mocks.getNexusCredits).not.toHaveBeenCalled()
  })
})

describe('nexusAccountPanel — device authorization start', () => {
  it('opens the exact authorize URL, shows only the user code, and polls at the server interval', async () => {
    const start = deviceStart()
    mocks.startNexusDeviceAuth.mockResolvedValue(start)
    mocks.pollNexusDeviceAuth.mockResolvedValue({ status: 'pending' })

    const wrapper = mount(NexusAccountPanel)
    await flushPromises()
    await wrapper.get('[data-nexus-action="start"]').trigger('click')
    await flushPromises()

    expect(mocks.openTab).toHaveBeenCalledTimes(1)
    expect(mocks.openTab).toHaveBeenCalledWith({ url: start.authorizeUrl })
    expect(wrapper.get('[data-nexus-status]').attributes('data-nexus-status')).toBe('awaiting')
    expect(wrapper.get('[data-nexus-user-code]').text()).toBe(start.userCode)
    // The polling secret is not a credential the user is meant to see.
    expect(wrapper.html()).not.toContain(start.deviceCode)

    expect(mocks.pollNexusDeviceAuth).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1)
    await flushPromises()
    expect(mocks.pollNexusDeviceAuth).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(mocks.pollNexusDeviceAuth).toHaveBeenCalledTimes(1)
    expect(mocks.pollNexusDeviceAuth).toHaveBeenCalledWith(start.deviceCode)
  })

  it('leaves an actionable safe link when the authorize tab cannot be opened', async () => {
    const start = deviceStart()
    mocks.startNexusDeviceAuth.mockResolvedValue(start)
    mocks.openTab.mockRejectedValue(new Error('tab blocked'))
    mocks.pollNexusDeviceAuth.mockResolvedValue({ status: 'pending' })

    const wrapper = mount(NexusAccountPanel)
    await flushPromises()
    await wrapper.get('[data-nexus-action="start"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-nexus-authorize-link]').attributes('href')).toBe(start.authorizeUrl)
    expect(wrapper.get('[data-nexus-status]').attributes('data-nexus-status')).toBe('awaiting')
    expect(wrapper.get('[data-nexus-user-code]').text()).toBe(start.userCode)
  })
})

describe('nexusAccountPanel — approval', () => {
  it('emits connected and loads the credit summary once the server approves', async () => {
    mocks.getNexusAuthStatus
      .mockResolvedValueOnce({ signedIn: false })
      .mockResolvedValueOnce({ signedIn: true, accessTokenExpiresAt: START_TIME + 86_400_000 })
    mocks.startNexusDeviceAuth.mockResolvedValue(deviceStart())
    mocks.pollNexusDeviceAuth
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'approved' })
    mocks.getNexusCredits.mockResolvedValue({ month: '2026-09', user: { quota: 100, used: 40 }, team: null })

    const wrapper = mount(NexusAccountPanel)
    await flushPromises()
    await wrapper.get('[data-nexus-action="start"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('connected')).toBeFalsy()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    await flushPromises()

    expect(wrapper.emitted('connected')).toHaveLength(1)
    expect(wrapper.get('[data-nexus-status]').attributes('data-nexus-status')).toBe('connected')
    expect(mocks.getNexusCredits).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-nexus-remaining]').text()).toContain('60')
    expect(wrapper.get('[data-nexus-month]').text()).toBe('2026-09')
  })
})

describe('nexusAccountPanel — terminal poll statuses', () => {
  const terminalStatuses = ['expired', 'cancelled', 'browser_closed', 'rejected'] as const

  it('stops polling and renders a distinct readable state for each terminal status', async () => {
    const renderedByStatus = new Map<string, string>()

    for (const status of terminalStatuses) {
      mocks.getNexusAuthStatus.mockResolvedValue({ signedIn: false })
      mocks.startNexusDeviceAuth.mockResolvedValue(deviceStart())
      mocks.pollNexusDeviceAuth.mockResolvedValue({ status })

      const wrapper = mount(NexusAccountPanel)
      await flushPromises()
      await wrapper.get('[data-nexus-action="start"]').trigger('click')
      await flushPromises()
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
      await flushPromises()

      expect(wrapper.get('[data-nexus-status]').attributes('data-nexus-status')).toBe(status)
      expect(wrapper.emitted('connected')).toBeFalsy()

      const text = wrapper.text().trim()
      expect(text.length).toBeGreaterThan(0)
      renderedByStatus.set(status, text)

      const pollsAfterTerminal = mocks.pollNexusDeviceAuth.mock.calls.length
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
      await flushPromises()
      expect(mocks.pollNexusDeviceAuth.mock.calls.length).toBe(pollsAfterTerminal)

      wrapper.unmount()
    }

    // Different terminal reasons must not collapse into one indistinguishable message.
    expect(new Set(renderedByStatus.values()).size).toBe(terminalStatuses.length)
  })

  it('surfaces the server-provided rejection reason', async () => {
    mocks.getNexusAuthStatus.mockResolvedValue({ signedIn: false })
    mocks.startNexusDeviceAuth.mockResolvedValue(deviceStart())
    mocks.pollNexusDeviceAuth.mockResolvedValue({ status: 'rejected', message: '设备授权已被拒绝' })

    const wrapper = mount(NexusAccountPanel)
    await flushPromises()
    await wrapper.get('[data-nexus-action="start"]').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    await flushPromises()

    expect(wrapper.get('[data-nexus-status]').attributes('data-nexus-status')).toBe('rejected')
    expect(wrapper.text()).toContain('设备授权已被拒绝')
  })
})

describe('nexusAccountPanel — polling lifecycle', () => {
  it('stops polling after unmount', async () => {
    mocks.startNexusDeviceAuth.mockResolvedValue(deviceStart())
    mocks.pollNexusDeviceAuth.mockResolvedValue({ status: 'pending' })

    const wrapper = mount(NexusAccountPanel)
    await flushPromises()
    await wrapper.get('[data-nexus-action="start"]').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    await flushPromises()
    expect(mocks.pollNexusDeviceAuth).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4)
    await flushPromises()
    expect(mocks.pollNexusDeviceAuth).toHaveBeenCalledTimes(1)
  })

  it('ignores a stale poll response once a new attempt has started', async () => {
    const stalePoll = deferred<{ status: string }>()
    mocks.getNexusAuthStatus.mockResolvedValue({ signedIn: false })
    mocks.startNexusDeviceAuth
      .mockResolvedValueOnce(deviceStart())
      .mockResolvedValueOnce(deviceStart({ deviceCode: 'device-code-B', userCode: 'BBBB-2222' }))
    mocks.pollNexusDeviceAuth
      .mockReturnValueOnce(stalePoll.promise)
      .mockResolvedValue({ status: 'pending' })

    const wrapper = mount(NexusAccountPanel)
    await flushPromises()
    await wrapper.get('[data-nexus-action="start"]').trigger('click')
    await flushPromises()
    // First poll is now in flight and will answer after the user restarts.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    await flushPromises()
    expect(mocks.pollNexusDeviceAuth).toHaveBeenCalledTimes(1)

    await wrapper.get('[data-nexus-action="restart"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-nexus-user-code]').text()).toBe('BBBB-2222')

    stalePoll.resolve({ status: 'approved' })
    await flushPromises()
    await flushPromises()

    expect(wrapper.emitted('connected')).toBeFalsy()
    expect(wrapper.get('[data-nexus-status]').attributes('data-nexus-status')).toBe('awaiting')
    expect(wrapper.get('[data-nexus-user-code]').text()).toBe('BBBB-2222')
  })
})

describe('nexusAccountPanel — credits', () => {
  const balanceCases = [
    { name: 'positive balance', quota: 100, used: 40, expected: '60' },
    { name: 'usage beyond quota clamps to zero', quota: 100, used: 130, expected: '0' },
    { name: 'zero quota', quota: 0, used: 0, expected: '0' },
  ]

  it.each(balanceCases)('renders remaining as max(0, quota - used): $name', async ({ quota, used, expected }) => {
    mocks.getNexusAuthStatus.mockResolvedValue({ signedIn: true, accessTokenExpiresAt: START_TIME + 3_600_000 })
    mocks.getNexusCredits.mockResolvedValue({ month: '2026-09', user: { quota, used }, team: null })

    const wrapper = mount(NexusAccountPanel)
    await flushPromises()

    const remaining = wrapper.get('[data-nexus-remaining]').text()
    expect(remaining).toContain(expected)
    expect(remaining).not.toContain('-')
    expect(wrapper.get('[data-nexus-session-note]').text().trim().length).toBeGreaterThan(0)
  })

  it('falls back to the team pool when the account has no personal pool', async () => {
    mocks.getNexusAuthStatus.mockResolvedValue({ signedIn: true, accessTokenExpiresAt: START_TIME + 3_600_000 })
    mocks.getNexusCredits.mockResolvedValue({ month: '2026-09', user: null, team: { quota: 50, used: 10 } })

    const wrapper = mount(NexusAccountPanel)
    await flushPromises()

    expect(wrapper.find('[data-nexus-team-remaining]').exists()).toBe(true)
    expect(wrapper.get('[data-nexus-remaining]').text()).toContain('40')
  })

  it('never renders credential material even if the client boundary leaks it', async () => {
    mocks.getNexusAuthStatus.mockResolvedValue({
      signedIn: true,
      accessTokenExpiresAt: START_TIME + 3_600_000,
      accessToken: 'SECRET-ACCESS-TOKEN',
      refreshToken: 'SECRET-REFRESH-TOKEN',
    })
    mocks.getNexusCredits.mockResolvedValue({
      month: '2026-09',
      user: { quota: 10, used: 1 },
      team: null,
      accessToken: 'SECRET-ACCESS-TOKEN',
    })

    const wrapper = mount(NexusAccountPanel)
    await flushPromises()

    const html = wrapper.html()
    expect(html).not.toContain('SECRET-ACCESS-TOKEN')
    expect(html).not.toContain('SECRET-REFRESH-TOKEN')
  })
})

describe('nexusAccountPanel — logout', () => {
  it('logs out through the client, emits logged-out, and returns to the signed-out view', async () => {
    mocks.getNexusAuthStatus.mockResolvedValue({ signedIn: true, accessTokenExpiresAt: START_TIME + 3_600_000 })
    mocks.getNexusCredits.mockResolvedValue({ month: '2026-09', user: { quota: 10, used: 1 }, team: null })

    const wrapper = mount(NexusAccountPanel)
    await flushPromises()
    expect(wrapper.get('[data-nexus-status]').attributes('data-nexus-status')).toBe('connected')

    await wrapper.get('[data-nexus-action="logout"]').trigger('click')
    await flushPromises()

    expect(mocks.logoutNexus).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('loggedOut')).toBeTruthy()
    expect(wrapper.get('[data-nexus-status]').attributes('data-nexus-status')).toBe('signed-out')
    expect(wrapper.find('[data-nexus-action="start"]').exists()).toBe(true)
    expect(wrapper.find('[data-nexus-remaining]').exists()).toBe(false)
  })
})
