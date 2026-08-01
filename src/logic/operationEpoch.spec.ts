import { describe, expect, it, vi } from 'vitest'
import { createOperationEpoch } from './operationEpoch'

describe('operation epoch', () => {
  it('invalidates and aborts an active operation', () => {
    const epoch = createOperationEpoch()
    const operation = epoch.begin()
    const aborted = vi.fn()
    operation.signal.addEventListener('abort', aborted)

    expect(operation.isCurrent()).toBe(true)
    epoch.invalidate()

    expect(operation.signal.aborted).toBe(true)
    expect(operation.isCurrent()).toBe(false)
    expect(aborted).toHaveBeenCalledOnce()
  })

  it('aborts the previous operation when a new one begins', () => {
    const epoch = createOperationEpoch()
    const first = epoch.begin()
    const second = epoch.begin()

    expect(first.signal.aborted).toBe(true)
    expect(first.isCurrent()).toBe(false)
    expect(second.signal.aborted).toBe(false)
    expect(second.isCurrent()).toBe(true)
  })
})
