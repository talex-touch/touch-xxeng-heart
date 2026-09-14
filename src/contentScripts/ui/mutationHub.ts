/**
 * One `MutationObserver` per document, shared by every content-script surface that watches
 * the DOM.
 *
 * Each surface used to construct its own `MutationObserver` over `document.body`, so N
 * mounted surfaces meant N subtree observers receiving N copies of every mutation. The hub
 * keeps a single `childList`/`subtree` observer per `Document` and fans its records out to
 * each subscriber, which keeps its own gating and debounce. The observer is attached when
 * the first subscriber registers and disconnected the moment the last one leaves, so an
 * idle page pays nothing.
 */

export type MutationSubscriber = (records: MutationRecord[]) => void

export interface MutationHub {
  /** Register a subscriber; the returned function unsubscribes it (idempotent). */
  subscribe: (subscriber: MutationSubscriber) => () => void
  /** Active subscribers on this document. */
  readonly subscriberCount: number
  /** Whether the shared observer is currently attached. */
  readonly observing: boolean
}

const hubs = new WeakMap<Document, MutationHub>()

function createHub(doc: Document): MutationHub {
  const subscribers = new Set<MutationSubscriber>()
  let observer: MutationObserver | undefined

  const deliver: MutationCallback = (records) => {
    // Snapshot so a subscriber that unsubscribes mid-dispatch cannot shift the iteration,
    // and isolate every callback so one failure cannot starve the rest.
    for (const subscriber of [...subscribers]) {
      try {
        subscriber(records)
      }
      catch (error) {
        console.warn('[Lexi] mutation hub subscriber failed', error)
      }
    }
  }

  const attach = () => {
    if (observer)
      return

    observer = new MutationObserver(deliver)
    // `body` is the normal target. Before it exists, observing the document element (or the
    // document itself for exotic documents) still delivers the mutation that inserts the
    // body, because the body lands inside the observed subtree.
    observer.observe(doc.body ?? doc.documentElement ?? doc, { childList: true, subtree: true })
  }

  const detach = () => {
    observer?.disconnect()
    observer = undefined
  }

  return {
    subscribe(subscriber) {
      subscribers.add(subscriber)
      attach()

      let active = true
      return () => {
        if (!active)
          return

        active = false
        subscribers.delete(subscriber)
        if (subscribers.size === 0)
          detach()
      }
    },
    get subscriberCount() {
      return subscribers.size
    },
    get observing() {
      return observer !== undefined
    },
  }
}

/** The singleton hub for `doc` (the current document by default). */
export function getMutationHub(doc: Document = document): MutationHub {
  let hub = hubs.get(doc)
  if (!hub) {
    hub = createHub(doc)
    hubs.set(doc, hub)
  }

  return hub
}
