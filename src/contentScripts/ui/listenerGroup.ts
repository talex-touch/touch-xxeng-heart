/**
 * Registers DOM listeners and remembers exactly how to remove them.
 *
 * Hand-written teardown drifts: `addEventListener(x, h, { capture: true })` paired with
 * `removeEventListener(x, h)` silently leaks, and the mismatch is invisible in review.
 * Every `add` here returns its own disposer and is replayed verbatim by `removeAll`.
 */
export interface ListenerGroup {
  add: <T extends Event>(
    target: EventTarget,
    type: string,
    handler: (event: T) => void,
    options?: AddEventListenerOptions | boolean,
  ) => () => void
  removeAll: () => void
  readonly size: number
}

export function createListenerGroup(): ListenerGroup {
  let disposers: Array<() => void> = []

  return {
    add<T extends Event>(
      target: EventTarget,
      type: string,
      handler: (event: T) => void,
      options?: AddEventListenerOptions | boolean,
    ) {
      const listener = handler as EventListener
      target.addEventListener(type, listener, options)

      let removed = false
      const dispose = () => {
        if (removed)
          return

        removed = true
        target.removeEventListener(type, listener, options)
      }

      disposers.push(dispose)
      return dispose
    },
    removeAll() {
      const pending = disposers
      disposers = []
      for (const dispose of pending)
        dispose()
    },
    get size() {
      return disposers.length
    },
  }
}

/**
 * Browsers fire both pointer and mouse events for mouse input, so registering
 * `pointermove` *and* `mousemove` runs every handler twice on the hottest path there is.
 * Prefer pointer events and only fall back where they don't exist.
 */
export const supportsPointerEvents = typeof window !== 'undefined' && 'PointerEvent' in window

export function pointerEventName(kind: 'down' | 'up' | 'move' | 'over' | 'out' | 'cancel') {
  if (supportsPointerEvents)
    return `pointer${kind}`

  return kind === 'cancel' ? 'mouseout' : `mouse${kind}`
}

/**
 * Guards a handler against the same physical interaction being delivered twice
 * (e.g. a listener bound on both the capture and bubble phase as a compatibility net).
 */
export function once<T extends Event>(handler: (event: T) => void) {
  let lastEvent: Event | undefined

  return (event: T) => {
    if (lastEvent === event)
      return

    lastEvent = event
    handler(event)
  }
}
