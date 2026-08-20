import { describe, expect, it } from 'vitest'
import { createConcurrentTaskQueue } from './asyncQueue'

function deferred() {
  let resolvePromise!: () => void
  let rejectPromise!: (reason?: unknown) => void
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

describe('concurrent task queue', () => {
  it('limits running tasks and admits queued work in submission order when a slot settles', async () => {
    const enqueue = createConcurrentTaskQueue(2)
    const firstGate = deferred()
    const secondGate = deferred()
    const thirdGate = deferred()
    const thirdStarted = deferred()
    const started: string[] = []
    let active = 0
    let peakActive = 0

    function task(name: string, gate: ReturnType<typeof deferred>, startedSignal?: ReturnType<typeof deferred>) {
      return async () => {
        active += 1
        peakActive = Math.max(peakActive, active)
        started.push(name)
        startedSignal?.resolve()
        await gate.promise
        active -= 1
        return name
      }
    }

    const first = enqueue(task('first', firstGate))
    const second = enqueue(task('second', secondGate))
    const third = enqueue(task('third', thirdGate, thirdStarted))

    await Promise.resolve()
    expect(started).toEqual(['first', 'second'])
    expect(peakActive).toBe(2)

    firstGate.resolve()
    await thirdStarted.promise
    expect(started).toEqual(['first', 'second', 'third'])
    expect(peakActive).toBe(2)

    secondGate.resolve()
    thirdGate.resolve()
    await expect(Promise.all([first, second, third])).resolves.toEqual(['first', 'second', 'third'])
  })

  it('continues scheduling queued work after a task rejects', async () => {
    const enqueue = createConcurrentTaskQueue(2)
    const failedGate = deferred()
    const runningGate = deferred()
    const thirdStarted = deferred()
    const started: string[] = []

    const failed = enqueue(async () => {
      started.push('failed')
      await failedGate.promise
      throw new Error('provider failed')
    })
    const running = enqueue(async () => {
      started.push('running')
      await runningGate.promise
      return 'running'
    })
    const recovered = enqueue(async () => {
      started.push('recovered')
      thirdStarted.resolve()
      return 'recovered'
    })

    await Promise.resolve()
    expect(started).toEqual(['failed', 'running'])

    failedGate.resolve()
    await thirdStarted.promise
    expect(started).toEqual(['failed', 'running', 'recovered'])
    await expect(failed).rejects.toThrow('provider failed')
    await expect(recovered).resolves.toBe('recovered')

    runningGate.resolve()
    await expect(running).resolves.toBe('running')
  })
})
