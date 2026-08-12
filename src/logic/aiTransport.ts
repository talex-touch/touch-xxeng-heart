import browser from 'webextension-polyfill'
import type { Runtime } from 'webextension-polyfill'
import { aiPortName } from './aiPort'
import type { AiCommand, AiEvent } from './aiPort'
import type { AiChatMessage, ChatMessageContent, ProviderModel } from './providers'
import type { AiProviderConfig, AiTestResult, FeatureScene } from './types'

/**
 * Client half of the AI channel.
 *
 * Every caller — content script, options page, side panel — sends a command and consumes
 * the worker's answer. Nothing here knows an endpoint, builds a request or holds a key.
 */

export interface AiRunOutcome {
  text: string
  streamed: boolean
}

function toError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value))
}

function createAbortError() {
  return new DOMException('AI request aborted', 'AbortError')
}

/**
 * Runs one command to completion over a dedicated port.
 *
 * `onEvent` sees every message; resolving is left to it so each command can settle on the
 * event that carries its own result. The port is dropped as soon as the call settles,
 * which is what tells the worker to abort a request the caller no longer wants.
 */
function sendAiCommand<T>(
  command: AiCommand,
  onEvent: (event: AiEvent, resolve: (value: T) => void) => void,
  signal?: AbortSignal,
) {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }

    let port: Runtime.Port
    try {
      port = browser.runtime.connect({ name: aiPortName })
    }
    catch (error) {
      reject(toError(error))
      return
    }

    let closed = false

    const onAbort = () => settle(() => reject(createAbortError()))

    function settle(finish: () => void) {
      if (closed)
        return

      closed = true
      signal?.removeEventListener('abort', onAbort)
      try {
        port.disconnect()
      }
      catch {}
      finish()
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    port.onMessage.addListener((raw: unknown) => {
      const event = raw as AiEvent
      if (closed || !event || typeof event !== 'object')
        return

      if (event.type === 'error') {
        const error = new Error(event.message)
        if (event.name)
          error.name = event.name

        settle(() => reject(error))
        return
      }

      onEvent(event, value => settle(() => resolve(value)))
    })

    port.onDisconnect.addListener(() => {
      settle(() => reject(new Error('AI 后台连接已断开，请重试。')))
    })

    try {
      port.postMessage(command)
    }
    catch (error) {
      settle(() => reject(toError(error)))
    }
  })
}

/**
 * One scene turn. `onText` receives the assistant text so far, so a caller can render a
 * streaming answer without tracking deltas itself.
 */
export function runAiScene(
  request: { scene: FeatureScene, messages: AiChatMessage[], system?: string },
  onText?: (text: string) => void,
  signal?: AbortSignal,
): Promise<AiRunOutcome | undefined> {
  return sendAiCommand<AiRunOutcome | undefined>(
    { type: 'run', ...request },
    (event, resolve) => {
      if (event.type === 'delta')
        onText?.(event.text)
      else if (event.type === 'done')
        resolve({ text: event.text, streamed: event.streamed })
      else if (event.type === 'empty')
        resolve(undefined)
    },
    signal,
  )
}

export function testAiConnection(provider: AiProviderConfig | undefined, scene: FeatureScene, user: ChatMessageContent) {
  return sendAiCommand<AiTestResult>(
    { type: 'test', provider, scene, user },
    (event, resolve) => {
      if (event.type === 'test')
        resolve(event.result)
    },
  )
}

export function requestProviderModels(provider: AiProviderConfig) {
  return sendAiCommand<ProviderModel[]>(
    { type: 'models', provider },
    (event, resolve) => {
      if (event.type === 'models')
        resolve(event.models)
    },
  )
}
