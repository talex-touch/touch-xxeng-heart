import { nexusAuthorizedFetch } from '../background/nexusAuth'
import { recordAiCall } from './analytics'
import { normalizeTranslationText } from './aiText'
import { promptDefaults } from './defaults'
import { assertEndpointAllowed } from './endpointPolicy'
import { createSseParser, getProtocolAdapter, normalizeApiKey, resolveProtocol } from './providers'
import {
  NEXUS_INVOKE_PATH,
  NEXUS_PROTOCOL_ID,
  buildNexusInvokeRequest,
  buildNexusTranslateEnvelope,
  nexusAdapter,
  readNexusBilling,
  readNexusModels,
} from './providers/nexus'
import { NEXUS_BASE_URL } from './nexusClient'
import { readLocalSettings } from './settingsSync'
import type { AiChatMessage, ChatMessageContent, ProtocolAdapter, ProtocolUsage, ProviderModel, ResolvedAiProtocol } from './providers'
import type { AiProviderConfig, AiTestResult, FeatureScene, LexiSettings, TranslationDirection } from './types'
import type { DirectTranslationDescriptor } from './aiPort'

/**
 * Everything that needs a credential to run.
 *
 * This module only ever executes in the extension worker. Content scripts hand it a scene
 * and a message list over a port and get assistant text back, so an API key — or, once
 * sign-in lands, an OAuth access token — never has to exist in a page's world.
 */

interface AiRequestContext {
  providerId: string
  providerLabel: string
  priority: number
  delayMs: number
  protocol: ResolvedAiProtocol
  adapter: ProtocolAdapter
  /** Configured base URL; the adapter derives the real route from it. */
  endpointBase: string
  /** Resolved route, used for logs and diagnostics. */
  endpoint: string
  apiKey: string
  startedAt: number
  model: string
  prompt: string
}

interface ResolvedAiConfig {
  providerId: string
  providerLabel: string
  protocol: ResolvedAiProtocol
  endpoint: string
  apiKey: string
  model: string
  priority: number
  delayMs: number
  prompt: string
}

export interface AiRunRequest {
  scene: FeatureScene
  messages: AiChatMessage[]
  /** Replaces the scene prompt for callers that need a task-specific system message. */
  system?: string
  /** Translation must use one provider attempt at a time to respect the shared request cap. */
  translation?: boolean
  /** Set when the turn is direct translation; a Nexus provider answers it per item. */
  directTranslation?: DirectTranslationDescriptor
}

export interface AiRunResult {
  text: string
  streamed: boolean
}

/**
 * Nexus is a capability gateway, not an OpenAI-compatible endpoint: its requests carry an
 * envelope, its auth is a device token the credential store never hands out, and
 * translation is a capability of its own rather than a chat turn.
 */
const nexusEndpointLog = `${NEXUS_BASE_URL}${NEXUS_INVOKE_PATH}`

/** Nexus bills in credits; only the two settlement numbers are ever written to a log. */
interface NexusBillingLog {
  chargedCredits?: number
  reservedCredits?: number
}

function readNexusBillingLog(payload: unknown): NexusBillingLog | undefined {
  const billing = readNexusBilling(payload)
  if (!billing)
    return undefined

  return {
    chargedCredits: billing.chargedCredits,
    reservedCredits: billing.reservedCredits,
  }
}

/**
 * Target language for one translation item.
 *
 * A fixed direction pins both ends. `auto` cannot be sent as-is — the gateway needs a target
 * — so it follows the same rule the prompt states: mostly-Chinese text goes to English,
 * everything else to Chinese. The source is left for the gateway to detect.
 */
function getTranslationLangs(direction: TranslationDirection, text: string): { sourceLang?: string, targetLang: string } {
  if (direction === 'zh-to-en')
    return { sourceLang: 'zh', targetLang: 'en' }

  if (direction === 'en-to-zh')
    return { sourceLang: 'en', targetLang: 'zh' }

  const chinese = text.match(/[\u4E00-\u9FFF]/g)?.length ?? 0
  const latin = text.match(/[A-Z]/gi)?.length ?? 0
  return { targetLang: chinese > latin ? 'en' : 'zh' }
}

function toResolvedConfig(provider: AiProviderConfig, index: number, prompt: string): ResolvedAiConfig | undefined {
  const endpoint = provider.endpoint?.trim() ?? ''
  if (!endpoint)
    return undefined

  const model = provider.model?.trim() ?? ''

  return {
    providerId: provider.id || `provider-${index + 1}`,
    providerLabel: provider.label || `Provider ${index + 1}`,
    protocol: resolveProtocol(provider.protocol, endpoint, model),
    endpoint,
    apiKey: provider.apiKey?.trim() ?? '',
    model,
    priority: Number.isFinite(provider.priority) ? provider.priority : index + 1,
    delayMs: Math.max(0, Number.isFinite(provider.delayMs) ? provider.delayMs : index * 450),
    prompt,
  }
}

function getAiConfigs(settings: LexiSettings, scene: FeatureScene) {
  const config = settings.ai[scene]
  if (!config.enabled)
    return undefined

  const enabledProviders = (settings.ai.providers ?? []).filter(provider => provider.enabled)
  const selectedProviderIds = new Set(config.providerIds ?? [])
  const providers = selectedProviderIds.size
    ? enabledProviders.filter(provider => selectedProviderIds.has(provider.id))
    : enabledProviders

  const resolved = providers
    .map((provider, index) => toResolvedConfig(provider, index, config.prompt))
    .filter((item): item is ResolvedAiConfig => item != null)
    .sort((a, b) => a.priority - b.priority || a.delayMs - b.delayMs)

  for (const item of resolved)
    assertEndpointAllowed(item.endpoint, settings.ai.approvedHttpEndpoints ?? [])

  return resolved.length ? resolved : undefined
}

function getKeyHint(apiKey: string) {
  const normalized = normalizeApiKey(apiKey)
  return normalized ? `...${normalized.slice(-4)}` : undefined
}

function createRequestContextFromConfig(config: ResolvedAiConfig): AiRequestContext {
  const adapter = config.protocol === NEXUS_PROTOCOL_ID ? nexusAdapter : getProtocolAdapter(config.protocol)

  return {
    providerId: config.providerId,
    providerLabel: config.providerLabel,
    priority: config.priority,
    delayMs: config.delayMs,
    protocol: config.protocol,
    adapter,
    endpointBase: config.endpoint,
    endpoint: adapter.resolveChatUrl(config.endpoint, { model: config.model }),
    apiKey: normalizeApiKey(config.apiKey),
    startedAt: performance.now(),
    model: config.model,
    prompt: config.prompt,
  }
}

function createProviderErrorPrefix(request: AiRequestContext) {
  return request.providerLabel ? `${request.providerLabel}: ` : ''
}

const reasoningModelPattern = /(?:^|[\W_])(?:o1|o3|o4|r1|reasoner|reasoning|thinking)(?:$|[\W_])/i

function modelPrefersNonStreaming(model: string) {
  return reasoningModelPattern.test(model)
}

function getTemperature(model: string) {
  return modelPrefersNonStreaming(model) ? undefined : 0.2
}

function buildChatPlan(request: AiRequestContext, messages: AiChatMessage[], stream: boolean) {
  return request.adapter.buildChatRequest({
    endpoint: request.endpointBase,
    apiKey: request.apiKey,
    model: request.model,
    messages,
    stream,
    temperature: getTemperature(request.model),
  })
}

/** Scene prompts stay the default system message unless the caller supplied its own. */
function withSystemMessage(messages: AiChatMessage[], system: string): AiChatMessage[] {
  return messages[0]?.role === 'system' ? messages : [{ role: 'system', content: system }, ...messages]
}

function getPromptText(messages: AiChatMessage[]) {
  return messages
    .map(message => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
    .join('\n')
}

function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4))
}

/** Token accounting for one call; `tokenEstimate` marks numbers Lexi derived itself. */
interface AiUsageLog {
  promptTokens: number
  completionTokens?: number
  totalTokens: number
  tokenEstimate: boolean
}

function getUsageLog(usage: ProtocolUsage | undefined, promptText: string, completionText = ''): AiUsageLog {
  if (usage?.totalTokens) {
    // A backend may report a total without breaking it down; the log still needs a number.
    const completionTokens = usage.completionTokens
    return {
      promptTokens: usage.promptTokens ?? Math.max(0, usage.totalTokens - (completionTokens ?? 0)),
      completionTokens,
      totalTokens: usage.totalTokens,
      tokenEstimate: false,
    }
  }

  const promptTokens = estimateTokens(promptText)
  const completionTokens = completionText ? estimateTokens(completionText) : undefined
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + (completionTokens ?? 0),
    tokenEstimate: true,
  }
}

/**
 * Streams the response body, handing every SSE event to the protocol adapter.
 *
 * `onContent` sees the accumulated text after each event so callers can render partial
 * output without re-implementing the delta bookkeeping.
 */
async function readStreamedText(
  response: Response,
  adapter: ProtocolAdapter,
  onContent?: (content: string) => void,
) {
  const reader = response.body?.getReader()
  if (!reader)
    throw new Error('AI stream is empty')

  const decoder = new TextDecoder()
  let content = ''
  const parser = createSseParser((event) => {
    const delta = adapter.readStreamDelta(event)
    if (!delta)
      return

    content += delta
    onContent?.(content)
  })

  while (true) {
    const { done, value } = await reader.read()
    if (value)
      parser.push(decoder.decode(value, { stream: !done }))

    if (done) {
      parser.push(decoder.decode())
      parser.end()
      break
    }
  }

  if (!content.trim())
    throw new Error('AI stream response is empty')

  return content
}

async function readErrorText(response: Response) {
  const text = await response.text()
  if (!text.trim())
    return response.statusText || `HTTP ${response.status}`

  try {
    return JSON.stringify(JSON.parse(text)).slice(0, 240)
  }
  catch {
    return text.trim().slice(0, 240)
  }
}

/** Assistant text, falling back to the whole body so JSON-only gateways still parse. */
function extractTextContent(adapter: ProtocolAdapter, value: unknown) {
  if (typeof value === 'string')
    return value

  if (typeof value !== 'object' || value == null)
    throw new Error('AI response is not an object')

  return adapter.readText(value) || JSON.stringify(value)
}

/** One decoded reply: the visible text, how it arrived, its token log and any credit settle. */
interface AiResponseRead {
  text: string
  streamed: boolean
  usageLog: AiUsageLog
  billing?: NexusBillingLog
}

async function readAiResponse(
  response: Response,
  adapter: ProtocolAdapter,
  promptText: string,
  onText?: (text: string) => void,
  readBilling?: (payload: unknown) => NexusBillingLog | undefined,
): Promise<AiResponseRead> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream')) {
    const text = await readStreamedText(response, adapter, onText)
    return { text, streamed: true, usageLog: getUsageLog(undefined, promptText, text), billing: undefined }
  }

  const payload = await response.json()
  const text = extractTextContent(adapter, payload)
  if (!text)
    throw new Error('AI response text is empty')

  onText?.(text)
  return {
    text,
    streamed: false,
    usageLog: getUsageLog(adapter.readUsage(payload), promptText, text),
    billing: readBilling?.(payload),
  }
}

function fetchChatCompletion(request: AiRequestContext, messages: AiChatMessage[], stream: boolean, signal?: AbortSignal) {
  const plan = buildChatPlan(request, messages, stream)
  if (request.protocol === NEXUS_PROTOCOL_ID)
    return nexusAuthorizedFetch(plan.url, { method: plan.method, headers: plan.headers, body: plan.body, signal })

  return fetch(plan.url, {
    method: plan.method,
    headers: plan.headers,
    redirect: 'error',
    signal,
    body: plan.body,
  })
}

function shouldRetryWithoutStream(status: number, error: string) {
  return status === 400 && /stream|temperature|unsupported|not support|does not support|invalid parameter/i.test(error)
}

function normalizeAiErrorMessage(status: number | undefined, error: string) {
  if (/insufficient[_\s-]*(?:user[_\s-]*)?quota|quota|余额不足|额度不足|剩余额度|balance/i.test(error))
    return `AI 额度不足，请充值或更换 API Key。${error}`

  if (status === 401 || /unauthorized|invalid[_\s-]*api[_\s-]*key|incorrect[_\s-]*api[_\s-]*key|认证|鉴权|api key/i.test(error))
    return `AI API Key 无效或未授权，请检查配置。${error}`

  if (status === 429 || /rate[_\s-]*limit|too many requests|请求过多/i.test(error))
    return `AI 请求过于频繁，请稍后重试。${error}`

  return error
}

/**
 * Nexus failures are session and quota failures, not key failures.
 *
 * The device token is refreshed by the worker and there is no API key for the user to fix,
 * so telling them to check a key would send them somewhere that does not exist.
 */
function normalizeNexusErrorMessage(status: number | undefined, error: string) {
  if (status === 401 || status === 403 || /unauthorized|no-token|登录|授权/i.test(error))
    return `Nexus 登录已失效，请重新登录后重试，或改用其他 Provider。${error}`

  if (status === 429 || /rate[_\s-]*limit|too many requests|请求过于频繁/i.test(error))
    return `Nexus 请求过于频繁，请稍后重试，或改用其他 Provider。${error}`

  if (/insufficient[_\s-]*(?:user[_\s-]*)?quota|quota|credits?|余额|额度|balance/i.test(error))
    return `Nexus 额度不足，请检查 Nexus 账户额度，或改用其他 Provider。${error}`

  return normalizeAiErrorMessage(status, error)
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function isAbortError(error: unknown) {
  return (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError')
}

async function delayProviderStart(delayMs: number, signal: AbortSignal) {
  if (delayMs <= 0)
    return

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Provider race aborted', 'AbortError'))
    }, { once: true })
  })
}

async function runProviderRace<T>(
  requests: AiRequestContext[],
  runner: (request: AiRequestContext, signal: AbortSignal, index: number) => Promise<T>,
): Promise<T | undefined> {
  if (!requests.length)
    return undefined

  if (requests.length === 1) {
    const controller = new AbortController()
    return runner(requests[0], controller.signal, 0)
  }

  return new Promise<T>((resolve, reject) => {
    const controllers = requests.map(() => new AbortController())
    const errors: string[] = []
    let failed = 0
    let settled = false

    requests.forEach((request, index) => {
      const controller = controllers[index]
      const startedAt = performance.now()
      delayProviderStart(request.delayMs, controller.signal)
        .then(() => {
          request.startedAt = performance.now()
          return runner(request, controller.signal, index)
        })
        .then((result) => {
          if (settled)
            return

          settled = true
          controllers.forEach((item, itemIndex) => {
            if (itemIndex !== index)
              item.abort()
          })
          resolve(result)
        })
        .catch((error: unknown) => {
          if (settled || isAbortError(error))
            return

          failed += 1
          const elapsed = Math.round(performance.now() - startedAt)
          errors.push(`${createProviderErrorPrefix(request)}${getErrorMessage(error)} (${elapsed}ms)`)
          if (failed >= requests.length) {
            settled = true
            reject(new Error(errors.join('；') || '所有 AI Provider 均不可用'))
          }
        })
    })
  })
}

async function runProvidersSequentially<T>(
  requests: AiRequestContext[],
  runner: (request: AiRequestContext, signal: AbortSignal, index: number) => Promise<T>,
): Promise<T | undefined> {
  const errors: string[] = []
  for (const [index, request] of requests.entries()) {
    const controller = new AbortController()
    try {
      return await runner(request, controller.signal, index)
    }
    catch (error) {
      errors.push(`${createProviderErrorPrefix(request)}${getErrorMessage(error)}`)
    }
  }
  throw new Error(errors.join('；') || '所有 AI Provider 均不可用')
}

/**
 * One provider attempt: request, one retry without streaming, then the usage log.
 *
 * Backends that reject `stream` or `temperature` answer 400 with a readable reason, and a
 * streamed body that turns out to be unparsable is the same failure one layer later — both
 * are worth exactly one buffered retry before the provider is called dead.
 */
async function runProviderChat(
  request: AiRequestContext,
  scene: FeatureScene,
  inputMessages: AiChatMessage[],
  onText: ((text: string) => void) | undefined,
  signal: AbortSignal,
): Promise<AiRunResult> {
  let failureLogged = false
  const isNexus = request.protocol === NEXUS_PROTOCOL_ID
  const readBilling = isNexus ? readNexusBillingLog : undefined
  // Nexus has no key to hint at and its route is relative on the wire; the log shows the
  // canonical endpoint and says a credential was attached without ever naming one.
  const visibleEndpoint = isNexus ? nexusEndpointLog : request.endpoint
  const authSent = isNexus || Boolean(request.apiKey)
  const normalizeError = isNexus ? normalizeNexusErrorMessage : normalizeAiErrorMessage

  try {
    const messages = withSystemMessage(inputMessages, request.prompt)
    const promptText = getPromptText(messages)
    // Nexus answers JSON envelopes and bills in credits; streaming belongs to its chat
    // capability alone, and the invoke reply is what carries the settlement.
    const stream = !isNexus && !modelPrefersNonStreaming(request.model)
    let response = await fetchChatCompletion(request, messages, stream, signal)
    let retryError: string | undefined
    let firstError: string | undefined

    if (!response.ok) {
      firstError = await readErrorText(response)
      if (stream && shouldRetryWithoutStream(response.status, firstError)) {
        retryError = firstError
        firstError = undefined
        response = await fetchChatCompletion(request, messages, false, signal)
      }
    }

    if (!response.ok) {
      const rawError = firstError ?? await readErrorText(response)
      const error = normalizeError(response.status, rawError)
      failureLogged = true
      await recordAiCall({
        scene,
        endpoint: visibleEndpoint,
        model: request.model,
        authSent,
        keyHint: getKeyHint(request.apiKey),
        streamed: false,
        ok: false,
        status: response.status,
        error: retryError ? `${retryError}; retry: ${error}` : error,
        durationMs: Math.round(performance.now() - request.startedAt),
      })
      throw new Error(error)
    }

    let result: AiResponseRead
    try {
      result = await readAiResponse(response, request.adapter, promptText, onText, readBilling)
    }
    catch (error) {
      if (!stream || isAbortError(error))
        throw error

      retryError = getErrorMessage(error)
      response = await fetchChatCompletion(request, messages, false, signal)
      if (!response.ok) {
        const responseError = await readErrorText(response)
        throw new Error(normalizeError(response.status, `${retryError}; retry: ${responseError}`))
      }

      result = await readAiResponse(response, request.adapter, promptText, onText, readBilling)
    }

    await recordAiCall({
      scene,
      endpoint: visibleEndpoint,
      model: request.model,
      authSent,
      keyHint: getKeyHint(request.apiKey),
      streamed: result.streamed,
      ok: true,
      status: response.status,
      ...result.usageLog,
      ...(result.billing ?? {}),
      durationMs: Math.round(performance.now() - request.startedAt),
    })

    return { text: result.text, streamed: result.streamed }
  }
  catch (error) {
    if (isAbortError(error))
      throw error

    if (!failureLogged && error instanceof Error) {
      await recordAiCall({
        scene,
        endpoint: visibleEndpoint,
        model: request.model,
        authSent,
        keyHint: getKeyHint(request.apiKey),
        streamed: false,
        ok: false,
        error: error.message,
        durationMs: Math.round(performance.now() - request.startedAt),
      })
    }

    throw error
  }
}

/**
 * One `text.translate` invoke for one item, logged with its credit settlement.
 *
 * The credential never appears here: `nexusAuthorizedFetch` attaches the device token to a
 * relative canonical path. A reply without usable text is not an error — it is one item the
 * gateway declined to translate — but a transport failure throws so the caller can move on
 * to the next Nexus provider.
 */
async function translateWithNexus(
  context: AiRequestContext,
  scene: FeatureScene,
  text: string,
  direction: TranslationDirection,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const startedAt = performance.now()
  const plan = buildNexusInvokeRequest(
    buildNexusTranslateEnvelope({ text, ...getTranslationLangs(direction, text) }),
    { apiKey: context.apiKey },
  )

  let response: Response
  try {
    response = await nexusAuthorizedFetch(plan.url, {
      method: plan.method,
      headers: plan.headers,
      body: plan.body,
      signal,
    })
  }
  catch (error) {
    if (isAbortError(error))
      throw error

    await recordAiCall({
      scene,
      endpoint: nexusEndpointLog,
      model: context.model,
      authSent: true,
      streamed: false,
      ok: false,
      error: getErrorMessage(error),
      durationMs: Math.round(performance.now() - startedAt),
    })
    throw error
  }

  if (!response.ok) {
    const error = normalizeNexusErrorMessage(response.status, await readErrorText(response))
    await recordAiCall({
      scene,
      endpoint: nexusEndpointLog,
      model: context.model,
      authSent: true,
      streamed: false,
      ok: false,
      status: response.status,
      error,
      durationMs: Math.round(performance.now() - startedAt),
    })
    throw new Error(error)
  }

  const payload = await response.json()
  // Strict decode on purpose: `extractTextContent`'s JSON fallback would turn a malformed
  // envelope into a "translation", and a wrong string is worse than one retried item.
  const translation = normalizeTranslationText(nexusAdapter.readText(payload)).trim()
  await recordAiCall({
    scene,
    endpoint: nexusEndpointLog,
    model: context.model,
    authSent: true,
    streamed: false,
    ok: true,
    status: response.status,
    ...(readNexusBillingLog(payload) ?? {}),
    durationMs: Math.round(performance.now() - startedAt),
  })

  return translation || undefined
}

interface NexusTranslatedItem {
  id: string
  translation: string
}

/**
 * Translates one descriptor through one Nexus provider, item by item.
 *
 * Returns only the items that actually came back. `undefined` means this provider translated
 * none of them, which is the signal to move on to the next configured provider — not to retry
 * this one, and not to hand the same work to `text.chat`.
 */
async function translateItemsWithNexus(
  context: AiRequestContext,
  scene: FeatureScene,
  descriptor: DirectTranslationDescriptor,
  signal?: AbortSignal,
): Promise<AiRunResult | undefined> {
  // A plain-text answer is one item by definition; batching it would hide which text won.
  const targets = descriptor.output === 'text' ? descriptor.items.slice(0, 1) : descriptor.items
  const translated: NexusTranslatedItem[] = []
  let lastError: unknown

  for (const item of targets) {
    try {
      const translation = await translateWithNexus(context, scene, item.text, descriptor.direction, signal)
      if (translation)
        translated.push({ id: item.id, translation })
    }
    catch (error) {
      // One item failing does not discard the ones that already succeeded; the caller
      // leaving is the only thing that stops the batch.
      if (isAbortError(error))
        throw error

      lastError = error
    }
  }

  if (translated.length) {
    if (descriptor.output === 'text')
      return { text: translated[0].translation, streamed: false }

    return { text: JSON.stringify({ items: translated }), streamed: false }
  }

  // Nothing came back: a transport failure is worth reporting, a gateway that merely
  // returned no text is not — both leave the batch to the next configured provider.
  if (lastError)
    throw lastError

  return undefined
}

/**
 * Direct translation walks the configured providers in order, exactly once each.
 *
 * A Nexus provider answers with `text.translate` per item — never `text.chat` — and a partial
 * result returns immediately, because replaying the items that already succeeded would pay for
 * them twice. A generic provider keeps its unchanged prompt path and answers the whole batch.
 * Only when every provider has been spent without an answer does this throw, aggregating the
 * failures the way the sequential path does.
 */
async function runDirectTranslation(
  request: AiRunRequest,
  contexts: AiRequestContext[],
  genericRunner: (context: AiRequestContext, providerSignal: AbortSignal, index: number) => Promise<AiRunResult>,
  signal?: AbortSignal,
): Promise<AiRunResult> {
  const descriptor = request.directTranslation
  if (!descriptor)
    throw new Error('直接翻译缺少翻译描述符')

  const errors: string[] = []

  for (const [index, context] of contexts.entries()) {
    const controller = new AbortController()
    try {
      if (context.protocol === NEXUS_PROTOCOL_ID) {
        const direct = await translateItemsWithNexus(context, request.scene, descriptor, signal)
        if (direct)
          return direct

        continue
      }

      return await genericRunner(context, controller.signal, index)
    }
    catch (error) {
      if (isAbortError(error))
        throw error

      errors.push(`${createProviderErrorPrefix(context)}${getErrorMessage(error)}`)
    }
  }

  throw new Error(errors.join('；') || '所有 AI Provider 均不可用')
}

/**
 * Runs one scene turn against its providers and returns the raw assistant text.
 *
 * Interpreting that text — JSON, translation, markdown answer — belongs to the caller;
 * this side only knows how to reach a backend and read one turn out of it.
 */
export async function runAiChat(
  request: AiRunRequest,
  onText?: (text: string) => void,
  signal?: AbortSignal,
): Promise<AiRunResult | undefined> {
  const settings = await readLocalSettings()
  const configs = getAiConfigs(settings, request.scene)
  if (!configs)
    return undefined

  const contexts = configs
    .map(config => (request.system ? { ...config, prompt: request.system } : config))
    .map(createRequestContextFromConfig)

  const runner = (context: AiRequestContext, providerSignal: AbortSignal, index: number) => {
    // Only the first provider paints: two racing streams would interleave on screen.
    const listener = index === 0 ? onText : undefined
    if (!signal)
      return runProviderChat(context, request.scene, request.messages, listener, providerSignal)

    const controller = new AbortController()
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    providerSignal.addEventListener('abort', abort, { once: true })
    if (signal.aborted || providerSignal.aborted)
      controller.abort()

    return runProviderChat(context, request.scene, request.messages, listener, controller.signal)
      .finally(() => {
        signal.removeEventListener('abort', abort)
        providerSignal.removeEventListener('abort', abort)
      })
  }

  const run = async () => {
    // Direct translation walks the providers itself so a Nexus provider never becomes a
    // `text.chat` call and a partial batch is never replayed; everything else keeps the
    // existing race/sequential semantics untouched.
    if (request.directTranslation)
      return runDirectTranslation(request, contexts, runner, signal)

    return request.translation
      ? runProvidersSequentially(contexts, runner)
      : runProviderRace(contexts, runner)
  }

  const pending = run()

  if (!signal)
    return pending

  return Promise.race([
    pending,
    new Promise<undefined>((_, reject) => {
      if (signal.aborted)
        reject(new DOMException('AI request aborted', 'AbortError'))
      else
        signal.addEventListener('abort', () => reject(new DOMException('AI request aborted', 'AbortError')), { once: true })
    }),
  ])
}

function parseRawAiText(adapter: ProtocolAdapter, value: string) {
  if (!value.trim())
    return ''

  try {
    return normalizeTranslationText(extractTextContent(adapter, JSON.parse(value)))
  }
  catch {
    return normalizeTranslationText(value)
  }
}

/**
 * One buffered round trip against a provider the user is still editing.
 *
 * The connection test takes the same path as a real turn — worker context, same adapter,
 * same endpoint policy — so a green result means a content script would also get through.
 */
export async function runAiTest(
  scene: FeatureScene,
  user: ChatMessageContent,
  provider?: AiProviderConfig,
): Promise<AiTestResult> {
  const settings = await readLocalSettings()
  const config = provider
    ? toResolvedConfig(provider, 0, settings.ai[scene].prompt || promptDefaults[scene])
    : getAiConfigs(settings, scene)?.[0]

  if (!config)
    throw new Error(provider ? '请先填写 Endpoint' : 'AI 场景未启用，或绑定的 Provider 没有填写 Endpoint')

  // Nexus authenticates with a device token and picks its own model; only a keyed provider
  // has to supply a model name.
  const isNexus = config.protocol === NEXUS_PROTOCOL_ID
  if (!isNexus && !config.model)
    throw new Error('请先填写或选择模型')

  // Scene-bound providers were already checked while being resolved.
  if (provider)
    assertEndpointAllowed(config.endpoint, settings.ai.approvedHttpEndpoints ?? [])

  const request = createRequestContextFromConfig(config)
  const requestUser = typeof user === 'string' ? user : JSON.stringify(user)
  const messages: AiChatMessage[] = [{ role: 'system', content: request.prompt }, { role: 'user', content: user }]
  const plan = buildChatPlan(request, messages, false)
  // The Nexus route is relative on the wire; the test should show the canonical endpoint.
  const visibleEndpoint = isNexus ? nexusEndpointLog : plan.url
  const describeRequest = () => ({
    endpoint: visibleEndpoint,
    protocol: request.protocol,
    model: request.model,
    system: request.prompt,
    user: requestUser,
    stream: false,
    authSent: isNexus || Boolean(request.apiKey),
    keyHint: getKeyHint(request.apiKey),
  })

  try {
    const response = isNexus
      ? await nexusAuthorizedFetch(plan.url, { method: 'POST', headers: plan.headers, body: plan.body })
      : await fetch(plan.url, {
        method: plan.method,
        headers: plan.headers,
        redirect: 'error',
        body: plan.body,
      })

    const durationMs = Math.round(performance.now() - request.startedAt)
    const responseText = parseRawAiText(request.adapter, await response.text())
    const usageLog = getUsageLog(undefined, `${request.prompt}\n${requestUser}`, responseText)

    await recordAiCall({
      scene,
      endpoint: visibleEndpoint,
      model: request.model,
      authSent: isNexus || Boolean(request.apiKey),
      keyHint: getKeyHint(request.apiKey),
      streamed: false,
      ok: response.ok,
      status: response.status,
      ...usageLog,
      error: response.ok ? undefined : responseText.slice(0, 240),
      durationMs,
    })

    return {
      ok: response.ok,
      request: describeRequest(),
      response: responseText,
      status: response.status,
      durationMs,
    }
  }
  catch (error) {
    if (!(error instanceof Error))
      throw error

    const durationMs = Math.round(performance.now() - request.startedAt)
    await recordAiCall({
      scene,
      endpoint: visibleEndpoint,
      model: request.model,
      authSent: isNexus || Boolean(request.apiKey),
      keyHint: getKeyHint(request.apiKey),
      streamed: false,
      ok: false,
      error: error.message,
      durationMs,
    })

    return {
      ok: false,
      request: describeRequest(),
      response: error.message,
      durationMs,
    }
  }
}

/** Model catalogue for the provider editor; throws with a readable reason on failure. */
export async function listProviderModels(provider: AiProviderConfig): Promise<ProviderModel[]> {
  // Nexus routes to a model on the server and needs no key or model from the client, so
  // there is nothing to enumerate and nothing to validate.
  if (provider.protocol === NEXUS_PROTOCOL_ID)
    return readNexusModels()

  const endpoint = provider.endpoint?.trim() ?? ''
  if (!endpoint)
    throw new Error('请先填写 Endpoint')

  const settings = await readLocalSettings()
  assertEndpointAllowed(endpoint, settings.ai.approvedHttpEndpoints ?? [])

  const adapter = getProtocolAdapter(resolveProtocol(provider.protocol, endpoint, provider.model ?? ''))
  const plan = adapter.buildModelsRequest({ endpoint, apiKey: provider.apiKey ?? '' })
  const response = await fetch(plan.url, {
    method: plan.method,
    headers: plan.headers,
    redirect: 'error',
  })

  if (!response.ok)
    throw new Error(normalizeAiErrorMessage(response.status, await readErrorText(response)))

  const models = adapter.readModels(await response.json())
  if (!models.length)
    throw new Error('该 Endpoint 没有返回可用模型列表，请手动填写模型名。')

  return models.sort((a, b) => a.id.localeCompare(b.id))
}
