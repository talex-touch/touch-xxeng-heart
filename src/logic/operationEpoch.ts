export interface OperationEpochHandle {
  id: number
  signal: AbortSignal
  isCurrent: () => boolean
}

export function createOperationEpoch() {
  let currentId = 0
  let controller: AbortController | undefined

  return {
    begin(): OperationEpochHandle {
      controller?.abort()
      controller = new AbortController()
      const id = ++currentId
      const currentController = controller
      return {
        id,
        signal: currentController.signal,
        isCurrent: () => id === currentId && controller === currentController && !currentController.signal.aborted,
      }
    },
    invalidate() {
      currentId += 1
      controller?.abort()
      controller = undefined
    },
  }
}
