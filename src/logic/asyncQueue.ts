export function createSerializedTaskQueue() {
  let tail: Promise<unknown> = Promise.resolve()

  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
}

/** Runs no more than `maxConcurrent` tasks at once while preserving FIFO admission. */
export function createConcurrentTaskQueue(maxConcurrent: number) {
  const limit = Math.max(1, Math.floor(maxConcurrent) || 1)
  const pending: Array<() => void> = []
  let active = 0

  function drain() {
    while (active < limit && pending.length) {
      const start = pending.shift()
      if (!start)
        return

      active += 1
      start()
    }
  }

  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      pending.push(() => {
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active -= 1
            drain()
          })
      })
      drain()
    })
  }
}
