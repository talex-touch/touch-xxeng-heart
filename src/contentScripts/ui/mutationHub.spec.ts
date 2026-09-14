// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMutationHub } from './mutationHub'

/**
 * The hub exists to collapse N per-surface `MutationObserver`s into one per document, so the
 * tests pin the lifecycle: one observer while subscribers exist, records fanned out
 * independently, exact teardown when the last subscriber leaves, and a body that shows up
 * after subscribing still counted.
 */

let createdObservers = 0
const RealMutationObserver = globalThis.MutationObserver

class CountingMutationObserver extends RealMutationObserver {
  constructor(callback: MutationCallback) {
    super(callback)
    createdObservers += 1
  }
}

function createDocument() {
  return document.implementation.createHTMLDocument('lexi-test')
}

/** MutationObserver records are delivered on a microtask. */
async function flushMutations() {
  await vi.advanceTimersByTimeAsync(0)
  await Promise.resolve()
}

function appendToBody(doc: Document, count = 1) {
  for (let index = 0; index < count; index++)
    doc.body.append(doc.createElement('div'))
}

beforeEach(() => {
  vi.useFakeTimers()
  createdObservers = 0
  vi.stubGlobal('MutationObserver', CountingMutationObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('getMutationHub', () => {
  it('returns one hub per document and separate hubs for distinct documents', () => {
    const first = createDocument()
    const second = createDocument()

    const hub = getMutationHub(first)

    expect(getMutationHub(first)).toBe(hub)
    expect(getMutationHub(second)).not.toBe(hub)
  })

  it('forwards records to every subscriber independently while sharing one observer', async () => {
    const doc = createDocument()
    const hub = getMutationHub(doc)
    const first = vi.fn()
    const second = vi.fn()

    hub.subscribe(first)
    hub.subscribe(second)

    expect(createdObservers).toBe(1)

    appendToBody(doc)
    await flushMutations()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    // Both saw the same records, not copies held by separate observers.
    expect(first.mock.calls[0][0]).toBe(second.mock.calls[0][0])
    expect(first.mock.calls[0][0]).toHaveLength(1)
  })

  it('stops delivering to an unsubscribed callback', async () => {
    const doc = createDocument()
    const hub = getMutationHub(doc)
    const first = vi.fn()
    const second = vi.fn()

    const unsubscribeFirst = hub.subscribe(first)
    hub.subscribe(second)
    expect(hub.subscriberCount).toBe(2)

    unsubscribeFirst()
    expect(hub.subscriberCount).toBe(1)

    appendToBody(doc)
    await flushMutations()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(createdObservers).toBe(1)
  })

  it('detaches when the last subscriber leaves and reattaches for the next one', async () => {
    const doc = createDocument()
    const hub = getMutationHub(doc)
    const only = vi.fn()

    hub.subscribe(only)()
    expect(hub.subscriberCount).toBe(0)
    expect(hub.observing).toBe(false)

    // A detached observer must not keep notifying the document.
    appendToBody(doc)
    await flushMutations()
    expect(only).not.toHaveBeenCalled()

    const again = vi.fn()
    hub.subscribe(again)

    expect(hub.observing).toBe(true)
    expect(createdObservers).toBe(2)

    appendToBody(doc)
    await flushMutations()
    expect(again).toHaveBeenCalledTimes(1)
  })

  it('keeps distinct documents from sharing observers or records', async () => {
    const first = createDocument()
    const second = createDocument()
    const firstCallback = vi.fn()
    const secondCallback = vi.fn()

    getMutationHub(first).subscribe(firstCallback)
    getMutationHub(second).subscribe(secondCallback)
    expect(createdObservers).toBe(2)

    appendToBody(second)
    await flushMutations()

    expect(secondCallback).toHaveBeenCalledTimes(1)
    expect(firstCallback).not.toHaveBeenCalled()
  })

  it('subscribes before a body exists and still delivers the insertion', async () => {
    const doc = createDocument()
    doc.body.remove()
    expect(doc.body).toBeNull()

    const callback = vi.fn()
    const hub = getMutationHub(doc)
    hub.subscribe(callback)

    const body = doc.createElement('body')
    doc.documentElement.append(body)
    await flushMutations()

    expect(callback).toHaveBeenCalledTimes(1)

    appendToBody(doc)
    await flushMutations()
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('isolates a throwing subscriber from the rest of the fan-out', async () => {
    const doc = createDocument()
    const hub = getMutationHub(doc)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const healthy = vi.fn()

    hub.subscribe(() => {
      throw new Error('subscriber exploded')
    })
    hub.subscribe(healthy)

    appendToBody(doc)
    await flushMutations()

    expect(healthy).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[Lexi] mutation hub subscriber failed', expect.any(Error))
  })

  it('lets a subscriber unsubscribe during dispatch without skipping siblings', async () => {
    const doc = createDocument()
    const hub = getMutationHub(doc)
    const third = vi.fn()
    let unsubscribeFirst: (() => void) | undefined

    const first = vi.fn(() => unsubscribeFirst?.())
    unsubscribeFirst = hub.subscribe(first)
    hub.subscribe(third)

    appendToBody(doc)
    await flushMutations()

    expect(first).toHaveBeenCalledTimes(1)
    expect(third).toHaveBeenCalledTimes(1)
    expect(hub.subscriberCount).toBe(1)
  })
})
