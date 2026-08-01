export function createSerializedTaskQueue() {
  let tail: Promise<unknown> = Promise.resolve()

  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
}
