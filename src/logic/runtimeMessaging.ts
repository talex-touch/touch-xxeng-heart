import browser from 'webextension-polyfill'

export type LexiRuntimeMessageType =
  | 'lexi-acquire-digest-lease'
  | 'lexi-context-translate'
  | 'lexi-download-media'
  | 'lexi-fetch-subtitle-resource'
  | 'lexi-fetch-youtube-caption-track'
  | 'lexi-read-subtitle-cache'
  | 'lexi-write-subtitle-cache'
  | 'lexi-nexus-auth-status'
  | 'lexi-nexus-credits'
  | 'lexi-nexus-device-poll'
  | 'lexi-nexus-device-start'
  | 'lexi-nexus-logout'
  | 'lexi-resolve-bilibili-subtitles'
  | 'lexi-page-entities'
  | 'lexi-page-stats'
  | 'lexi-page-translate-start'
  | 'lexi-page-translate-status'
  | 'lexi-page-translate-stop'
  | 'lexi-page-translate-pause'
  | 'lexi-record-analytics'
  | 'lexi-release-digest-lease'
  | 'lexi-test-translation-engine'
  | 'lexi-translate-text'
  | 'lexi-write-page-translation-cache'

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
  // Chrome's structured clone drops object properties whose value is `undefined`.
  // Payload-less commands therefore arrive without an own `data` field.
  return Boolean(
    message
    && typeof message === 'object'
    && 'channel' in message
    && message.channel === 'lexi'
    && 'type' in message
    && typeof message.type === 'string',
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
