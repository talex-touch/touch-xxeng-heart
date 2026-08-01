import { describe, expect, it } from 'vitest'
import { appendBoundedLog } from './analyticsQueue'
import { createSerializedTaskQueue } from './asyncQueue'

describe('analytics queue', () => {
  it('prepends one log and enforces the limit', () => {
    expect(appendBoundedLog([2, 1], 3, 3)).toEqual([3, 2, 1])
    expect(appendBoundedLog([3, 2, 1], 4, 3)).toEqual([4, 3, 2])
  })

  it('runs concurrent tasks in submission order', async () => {
    const enqueue = createSerializedTaskQueue()
    const order: string[] = []

    const first = enqueue(async () => {
      await Promise.resolve()
      order.push('first')
    })
    const second = enqueue(async () => {
      order.push('second')
    })

    await Promise.all([first, second])
    expect(order).toEqual(['first', 'second'])
  })

  it('continues after a rejected task', async () => {
    const enqueue = createSerializedTaskQueue()
    await expect(enqueue(async () => Promise.reject(new Error('failed')))).rejects.toThrow('failed')
    await expect(enqueue(async () => 'recovered')).resolves.toBe('recovered')
  })
})
