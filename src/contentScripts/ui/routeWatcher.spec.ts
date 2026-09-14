// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteWatcher } from './routeWatcher'
import { getMutationHub } from './mutationHub'
import { startRouteWatcher } from './routeWatcher'

/**
 * `startRouteWatcher` used to own a `MutationObserver` per instance. It now shares one
 * observer per document through the mutation hub while keeping every per-instance behavior:
 * its own mutation gate, its own debounce, URL polling, visibility hand-off, idempotent
 * teardown, and self-destruct when the extension context dies.
 */

let createdObservers = 0
const RealMutationObserver = globalThis.MutationObserver

class CountingMutationObserver extends RealMutationObserver {
  constructor(callback: MutationCallback) {
    super(callback)
    createdObservers += 1
  }
}

const watchers: RouteWatcher[] = []

function start(options: Partial<Parameters<typeof startRouteWatcher>[0]> = {}) {
  const watcher = startRouteWatcher({
    label: 'Test',
    refresh: vi.fn(async () => {}),
    onDispose: vi.fn(),
    ...options,
  })
  watchers.push(watcher)
  return watcher
}

/** MutationObserver records are delivered on a microtask. */
async function flushMutations() {
  await vi.advanceTimersByTimeAsync(0)
  await Promise.resolve()
}

async function mutateDom() {
  document.body.append(document.createElement('div'))
  await flushMutations()
}

beforeEach(() => {
  vi.useFakeTimers()
  createdObservers = 0
  vi.stubGlobal('MutationObserver', CountingMutationObserver)
  document.body.replaceChildren()
  window.history.pushState({}, '', '/')
})

afterEach(() => {
  for (const watcher of watchers.splice(0))
    watcher.stop()
  vi.unstubAllGlobals()
  vi.clearAllTimers()
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('startRouteWatcher sharing the mutation hub', () => {
  it('runs every watcher off a single underlying MutationObserver', async () => {
    const first = vi.fn(async () => {})
    const second = vi.fn(async () => {})
    start({ refresh: first, mutationDelayMs: 100 })
    start({ refresh: second, mutationDelayMs: 100 })

    expect(createdObservers).toBe(1)

    await mutateDom()

    expect(getMutationHub(document).subscriberCount).toBe(2)
  })

  it('debounces each watcher independently from the same mutation', async () => {
    const fast = vi.fn(async () => {})
    const slow = vi.fn(async () => {})
    start({ refresh: fast, mutationDelayMs: 100 })
    start({ refresh: slow, mutationDelayMs: 300 })

    // Each watcher ran its init refresh exactly once.
    expect(fast).toHaveBeenCalledTimes(1)
    expect(slow).toHaveBeenCalledTimes(1)

    await mutateDom()

    await vi.advanceTimersByTimeAsync(100)
    expect(fast).toHaveBeenCalledTimes(2)
    expect(slow).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(200)
    expect(fast).toHaveBeenCalledTimes(2)
    expect(slow).toHaveBeenCalledTimes(2)
  })

  it('honors its own shouldRefreshMutation gate', async () => {
    const refresh = vi.fn(async () => {})
    let allowed = false
    start({ refresh, shouldRefreshMutation: () => allowed })

    await mutateDom()
    await vi.advanceTimersByTimeAsync(900)
    expect(refresh).toHaveBeenCalledTimes(1)

    allowed = true
    await mutateDom()
    await vi.advanceTimersByTimeAsync(900)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('leaves the shared observer attached until the last watcher stops', async () => {
    const first = start({ onDispose: vi.fn() })
    const second = start({ onDispose: vi.fn() })

    const hub = getMutationHub(document)
    expect(hub.subscriberCount).toBe(2)

    first.stop()
    expect(hub.subscriberCount).toBe(1)
    expect(hub.observing).toBe(true)

    second.stop()
    expect(hub.subscriberCount).toBe(0)
    expect(hub.observing).toBe(false)
  })

  it('stops idempotently and ignores mutations afterwards', async () => {
    const refresh = vi.fn(async () => {})
    const onDispose = vi.fn()
    const watcher = start({ refresh, onDispose })

    watcher.stop()
    watcher.stop()

    expect(watcher.disposed).toBe(true)
    expect(onDispose).toHaveBeenCalledTimes(1)

    await mutateDom()
    await vi.advanceTimersByTimeAsync(2000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes after a URL change once the navigation delay elapses', async () => {
    const refresh = vi.fn(async () => {})
    start({ refresh, navigationDelayMs: 700 })

    window.history.pushState({}, '', '/lexi-navigate')
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(700)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('does not refresh when the URL is unchanged', async () => {
    const refresh = vi.fn(async () => {})
    start({ refresh })

    await vi.advanceTimersByTimeAsync(3000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('reports visibility transitions to the owning surface', () => {
    const onVisible = vi.fn()
    const onHidden = vi.fn()
    let state = 'visible'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    })
    start({ onVisible, onHidden })

    state = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onHidden).toHaveBeenCalledTimes(1)

    state = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onVisible).toHaveBeenCalledTimes(1)
  })

  it('self-destructs when the extension context is invalidated', async () => {
    const onDispose = vi.fn()
    const refresh = vi.fn(async () => {
      throw new Error('Extension context invalidated.')
    })
    const watcher = start({ refresh, onDispose })

    await flushMutations()

    expect(watcher.disposed).toBe(true)
    expect(onDispose).toHaveBeenCalledTimes(1)
    expect(getMutationHub(document).subscriberCount).toBe(0)
  })
})
