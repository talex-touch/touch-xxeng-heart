import browser from 'webextension-polyfill'

export type LexiRuntimeMessageType =
  | 'lexi-context-translate'
  | 'lexi-download-media'
  | 'lexi-page-stats'
  | 'lexi-page-translate-start'
  | 'lexi-page-translate-status'
  | 'lexi-page-translate-stop'

interface LexiRuntimeMessage<T = unknown> {
  channel: 'lexi'
  type: LexiRuntimeMessageType
  data: T
}

type RuntimeMessageHandler<TData, TResult> = (data: TData) => TResult | Promise<TResult>

function createRuntimeMessage<T>(type: LexiRuntimeMessageType, data: T): LexiRuntimeMessage<T> {
  return {
    channel: 'lexi',
    type,
    data,
  }
}

function isLexiRuntimeMessage(message: unknown): message is LexiRuntimeMessage {
  return Boolean(
    message
    && typeof message === 'object'
    && 'channel' in message
    && message.channel === 'lexi'
    && 'type' in message
    && typeof message.type === 'string'
    && 'data' in message,
  )
}

export function listenRuntimeMessage<TData = unknown, TResult = unknown>(
  type: LexiRuntimeMessageType,
  handler: RuntimeMessageHandler<TData, TResult>,
) {
  const listener = (message: unknown) => {
    if (!isLexiRuntimeMessage(message) || message.type !== type)
      return undefined

    return Promise.resolve().then(() => handler(message.data as TData))
  }

  browser.runtime.onMessage.addListener(listener)
  return () => browser.runtime.onMessage.removeListener(listener)
}

export function sendRuntimeMessage<TResult = void, TData = unknown>(
  type: LexiRuntimeMessageType,
  data: TData,
) {
  return browser.runtime.sendMessage(createRuntimeMessage(type, data)) as Promise<TResult>
}

export function sendTabRuntimeMessage<TResult = void, TData = unknown>(
  tabId: number,
  type: LexiRuntimeMessageType,
  data: TData,
) {
  return browser.tabs.sendMessage(tabId, createRuntimeMessage(type, data)) as Promise<TResult>
}
