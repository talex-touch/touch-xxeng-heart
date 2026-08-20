import browser from 'webextension-polyfill'
import type { Runtime } from 'webextension-polyfill'
import { aiPortName } from '~/logic/aiPort'
import { isAbortError, listProviderModels, runAiChat, runAiTest } from '~/logic/aiRunner'
import type { AiCommand, AiEvent } from '~/logic/aiPort'
import { createConcurrentTaskQueue } from '~/logic/asyncQueue'
import { reserveTranslationQuota } from '~/logic/translationQuota'
import { readLocalSettings } from '~/logic/settingsSync'

const keepAliveIntervalMs = 20_000
const maxConcurrentAiRequests = 3
const enqueueAiRequest = createConcurrentTaskQueue(maxConcurrentAiRequests)

/**
 * Holds the worker open for the length of one request.
 *
 * An in-flight `fetch` does not count as activity for an MV3 service worker — only
 * extension API calls reset the 30s idle timer. A reasoning model answering without
 * streaming can easily take longer than that, and the worker going down mid-request would
 * drop the answer, so tick a trivial API until the request settles.
 */
function startKeepAlive() {
  const timer = setInterval(() => {
    void browser.runtime.getPlatformInfo().catch(() => {})
  }, keepAliveIntervalMs)

  return () => clearInterval(timer)
}

function post(port: Runtime.Port, event: AiEvent) {
  try {
    port.postMessage(event)
    return true
  }
  catch {
    // The tab navigated away mid-stream; there is nobody left to answer.
    return false
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

const aiTranslationFallbackChannel = {
  id: 'ai-translation-fallback',
  label: 'AI 翻译回退',
  dailyLimit: 0,
}
async function execute(port: Runtime.Port, command: AiCommand, signal: AbortSignal) {
  if (command.type === 'models') {
    post(port, { type: 'models', models: await listProviderModels(command.provider) })
    return
  }

  if (command.type === 'test') {
    post(port, { type: 'test', result: await runAiTest(command.scene, command.user, command.provider) })
    return
  }

  if (command.type === 'run' && command.scene === 'selection') {
    const settings = await readLocalSettings()
    await reserveTranslationQuota(settings.translation.rateLimit, aiTranslationFallbackChannel)
  }

  const result = await runAiChat(
    { scene: command.scene, messages: command.messages, system: command.system },
    text => post(port, { type: 'delta', text }),
    signal,
  )

  if (!result) {
    post(port, { type: 'empty' })
    return
  }

  post(port, { type: 'done', text: result.text, streamed: result.streamed })
}

async function handle(port: Runtime.Port, command: AiCommand, signal: AbortSignal) {
  const stopKeepAlive = startKeepAlive()

  try {
    await execute(port, command, signal)
  }
  catch (error) {
    if (signal.aborted || isAbortError(error))
      return

    post(port, {
      type: 'error',
      message: getErrorMessage(error),
      name: error instanceof Error ? error.name : undefined,
    })
  }
  finally {
    stopKeepAlive()
  }
}

function isAiCommand(value: unknown): value is AiCommand {
  if (!value || typeof value !== 'object')
    return false

  const { type } = value as { type?: unknown }
  return type === 'run' || type === 'test' || type === 'models'
}

/**
 * Serves AI work for content scripts and extension pages alike.
 *
 * Both go through here so the connection test in settings exercises the same context as a
 * real page does — a check that runs somewhere more privileged than production is not a
 * check. The client disconnects when it is done, which aborts whatever is still in flight.
 */
export function startAiService() {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== aiPortName)
      return

    const controller = new AbortController()
    let started = false

    port.onDisconnect.addListener(() => controller.abort())
    port.onMessage.addListener((raw: unknown) => {
      if (started || !isAiCommand(raw))
        return

      started = true
      void enqueueAiRequest(() => handle(port, raw, controller.signal))
    })
  })
}
