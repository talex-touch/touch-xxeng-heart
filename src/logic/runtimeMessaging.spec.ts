import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Chrome's structured clone drops object properties whose value is `undefined`.
 * A payload-less command therefore reaches `browser.runtime.onMessage` listeners
 * as `{ channel: 'lexi', type: '…' }` — with no own `data` property at all.
 *
 * These tests defend the listener contract at that boundary: the matching handler
 * must still run once with `undefined`, while the channel/type gate still rejects
 * everything that is not a Lexi runtime message.
 */

const state = vi.hoisted(() => ({
  listeners: [] as Array<(message: unknown) => unknown>,
}))

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      onMessage: {
        addListener: (listener: (message: unknown) => unknown) => {
          state.listeners.push(listener)
        },
        removeListener: (listener: (message: unknown) => unknown) => {
          const index = state.listeners.indexOf(listener)
          if (index !== -1)
            state.listeners.splice(index, 1)
        },
      },
    },
  },
}))

async function loadRuntimeMessaging() {
  vi.resetModules()
  return import('./runtimeMessaging')
}

/** Feeds one runtime message to whichever registered listener claims it. */
async function dispatch(message: unknown) {
  for (const listener of state.listeners) {
    const result = listener(message)
    if (result !== undefined)
      return await result
  }

  return undefined
}

describe('runtime message listener', () => {
  beforeEach(() => {
    state.listeners.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('delivers a payload-less message to the matching handler with undefined data', async () => {
    const { listenRuntimeMessage } = await loadRuntimeMessaging()
    const handler = vi.fn(() => 'started')
    listenRuntimeMessage('lexi-nexus-device-start', handler)

    // Exactly what Chrome's structured clone hands the listener for `{ data: undefined }`.
    const cloned: Record<string, unknown> = { channel: 'lexi', type: 'lexi-nexus-device-start' }
    const result = await dispatch(cloned)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(undefined)
    expect(result).toBe('started')
  })

  it.each([
    ['a foreign channel', { channel: 'other', type: 'lexi-nexus-device-start' }],
    ['a foreign type', { channel: 'lexi', type: 'lexi-unknown-command' }],
    ['a non-object payload', 'lexi-nexus-device-start'],
  ])('ignores a message with %s', async (_label, message) => {
    const { listenRuntimeMessage } = await loadRuntimeMessaging()
    const handler = vi.fn(() => 'started')
    listenRuntimeMessage('lexi-nexus-device-start', handler)

    expect(await dispatch(message)).toBeUndefined()
    expect(handler).not.toHaveBeenCalled()
  })
})
