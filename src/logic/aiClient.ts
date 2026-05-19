import { findCandidateByText, programmerVocabulary } from './vocabularyBank'
import { recordAiCall } from './analytics'
import type { AiConnectionConfig, AiTestResult, FeatureScene, GitHubDigestResult, LexiSettings, SelectionTranslation, TranslationDirection, VocabularyCandidate } from './types'

interface AiReplacementResponse {
  items?: VocabularyCandidate[]
}

interface AiTranslationResponse {
  translation?: string
  explanation?: string
  candidate?: VocabularyCandidate
}

interface AiSelectionDetailResponse {
  explanation?: string
  context?: string
  terms?: Array<{
    term: string
    explanation: string
  }>
  translationReview?: string
  advice?: string
  aiSuggestion?: string
  candidate?: VocabularyCandidate
}

interface AiPageTranslationBatchResponse {
  items?: Array<{
    id?: string
    translation?: string
  }>
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  usage?: OpenAiUsage
}

interface OpenAiUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

interface OpenAiChatStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string
    }
    message?: {
      content?: string
    }
  }>
}

type ChatMessageContentPart =
  | { type: 'text', text: string }
  | { type: 'image_url', image_url: { url: string, detail?: 'auto' | 'low' | 'high' } }

type ChatMessageContent = string | ChatMessageContentPart[]

interface MediaAnalysisInput {
  kind: 'image' | 'video' | 'audio' | 'media'
  src: string
  pageUrl: string
  pageTitle: string
  title?: string
  alt?: string
  mimeType?: string
  currentTime?: number
  duration?: number
  width?: number
  height?: number
  poster?: string
  frameDataUrl?: string
  mediaDataUrl?: string
  context?: string
}

interface AiRequestContext {
  providerId: string
  providerLabel: string
  priority: number
  delayMs: number
  endpoint: string
  headers: Record<string, string>
  apiKey: string
  startedAt: number
  model: string
  prompt: string
}

interface ResolvedAiConfig extends AiConnectionConfig {
  providerId: string
  providerLabel: string
  priority: number
  delayMs: number
  prompt: string
}

function mergeConnection(...connections: Array<Partial<AiConnectionConfig> | undefined>): AiConnectionConfig {
  const result: AiConnectionConfig = {
    endpoint: '',
    apiKey: '',
    model: '',
  }

  for (const connection of connections) {
    if (!connection)
      continue

    if (connection.endpoint?.trim())
      result.endpoint = connection.endpoint.trim()
    if (connection.apiKey?.trim())
      result.apiKey = connection.apiKey.trim()
    if (connection.model?.trim())
      result.model = connection.model.trim()
  }

  return result
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

  const sourceProviders = providers.length
    ? providers
    : [{ id: 'legacy', label: 'Legacy / Global', enabled: true, priority: 1, delayMs: 0, ...settings.ai.global }]

  const resolved = sourceProviders
    .map((provider, index): ResolvedAiConfig | undefined => {
      const connection = mergeConnection(settings.ai.global, provider, config)
      if (!connection.endpoint)
        return undefined

      return {
        ...connection,
        providerId: provider.id || `provider-${index + 1}`,
        providerLabel: provider.label || `Provider ${index + 1}`,
        priority: Number.isFinite(provider.priority) ? provider.priority : index + 1,
        delayMs: Math.max(0, Number.isFinite(provider.delayMs) ? provider.delayMs : index * 450),
        prompt: config.prompt,
      }
    })
    .filter((item): item is ResolvedAiConfig => item != null)
    .sort((a, b) => a.priority - b.priority || a.delayMs - b.delayMs)

  return resolved.length ? resolved : undefined
}

function resolveEndpoint(endpoint: string) {
  const trimmed = endpoint.trim().replace(/\/$/, '')
  if (trimmed.endsWith('/chat/completions'))
    return trimmed

  if (trimmed.endsWith('/v1'))
    return `${trimmed}/chat/completions`

  return `${trimmed}/v1/chat/completions`
}

function normalizeApiKey(value: string) {
  return value.trim().replace(/^Bearer\s+/i, '').trim()
}

function getKeyHint(apiKey: string) {
  const normalized = normalizeApiKey(apiKey)
  return normalized ? `...${normalized.slice(-4)}` : undefined
}

function createRequestContextFromConfig(config: ResolvedAiConfig): AiRequestContext {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }

  const apiKey = normalizeApiKey(config.apiKey)
  if (apiKey)
    headers.authorization = `Bearer ${apiKey}`

  return {
    providerId: config.providerId,
    providerLabel: config.providerLabel,
    priority: config.priority,
    delayMs: config.delayMs,
    endpoint: resolveEndpoint(config.endpoint),
    headers,
    apiKey,
    startedAt: performance.now(),
    model: config.model,
    prompt: config.prompt,
  }
}

function createAiRequestContext(settings: LexiSettings, scene: FeatureScene): AiRequestContext | undefined {
  const config = getAiConfigs(settings, scene)?.[0]
  return config ? createRequestContextFromConfig(config) : undefined
}

function createAiRequestContexts(settings: LexiSettings, scene: FeatureScene): AiRequestContext[] {
  return getAiConfigs(settings, scene)?.map(createRequestContextFromConfig) ?? []
}

function createProviderErrorPrefix(request: AiRequestContext) {
  return request.providerLabel ? `${request.providerLabel}: ` : ''
}

const reasoningModelPattern = /(?:^|[\W_])(?:o1|o3|o4|r1|reasoner|reasoning|thinking)(?:$|[\W_])/i

function modelPrefersNonStreaming(model: string) {
  return reasoningModelPattern.test(model)
}

function modelAcceptsTemperature(model: string) {
  return !modelPrefersNonStreaming(model)
}

function buildChatBody(model: string, system: string, user: ChatMessageContent, stream: boolean) {
  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: 'system',
        content: system,
      },
      {
        role: 'user',
        content: user,
      },
    ],
    stream,
  }

  if (modelAcceptsTemperature(model))
    body.temperature = 0.2

  return JSON.stringify(body)
}

function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4))
}

function getUsageLog(usage: OpenAiUsage | undefined, promptText: string, completionText = '') {
  if (usage?.total_tokens) {
    return {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
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

function parseJsonContent<T>(content: string): T {
  const cleaned = stripThinkingText(content)
  const fenceStart = cleaned.indexOf('```')
  const fenceEnd = fenceStart >= 0 ? cleaned.indexOf('```', fenceStart + 3) : -1
  const fenced = fenceStart >= 0 && fenceEnd > fenceStart
    ? cleaned.slice(fenceStart + 3, fenceEnd).replace(/^json\s*/i, '')
    : cleaned

  try {
    return JSON.parse(fenced.trim()) as T
  }
  catch {
    const start = fenced.indexOf('{')
    const end = fenced.lastIndexOf('}')
    if (start >= 0 && end > start)
      return JSON.parse(fenced.slice(start, end + 1).trim()) as T

    throw new Error('AI response JSON parse failed')
  }
}

function extractJsonObject<T>(value: unknown): T {
  if (typeof value !== 'object' || value == null)
    throw new Error('AI response is not an object')

  const direct = value as T
  const content = (value as OpenAiChatResponse).choices?.[0]?.message?.content
  return content ? parseJsonContent<T>(content) : direct
}

function appendStreamLine(line: string) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:'))
    return ''

  const data = trimmed.slice(5).trim()
  if (!data || data === '[DONE]')
    return ''

  const chunk = JSON.parse(data) as OpenAiChatStreamChunk
  return chunk.choices
    ?.map(choice => choice.delta?.content ?? choice.message?.content ?? '')
    .join('') ?? ''
}

async function readStreamContent(response: Response) {
  const reader = response.body?.getReader()
  if (!reader)
    throw new Error('AI stream is empty')

  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''

  while (true) {
    const { done, value } = await reader.read()
    if (value)
      buffer += decoder.decode(value, { stream: !done })

    if (done)
      buffer += decoder.decode()

    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines)
      content += appendStreamLine(line)

    if (done)
      break
  }

  if (buffer)
    content += appendStreamLine(buffer)

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

async function readAiResponseJson<T>(response: Response): Promise<{ data: T, streamed: boolean }> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream')) {
    const content = await readStreamContent(response)
    return {
      data: parseJsonContent<T>(content),
      streamed: true,
    }
  }

  return {
    data: extractJsonObject<T>(await response.json()),
    streamed: false,
  }
}

function stripThinkingText(value: string) {
  return value
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/<thinking>[\s\S]*$/gi, '')
    .trim()
}

function stripMarkdownFence(value: string) {
  const trimmed = value.trim()
  const fenceStart = trimmed.indexOf('```')
  const fenceEnd = fenceStart >= 0 ? trimmed.indexOf('```', fenceStart + 3) : -1
  if (fenceStart === 0 && fenceEnd > fenceStart)
    return trimmed.slice(fenceStart + 3, fenceEnd).replace(/^[a-z]+\s*/i, '').trim()

  return trimmed
}

function normalizeTranslationText(value: string) {
  const content = stripMarkdownFence(stripThinkingText(value))
  if (!content)
    return ''

  const partialJsonTranslation = content.match(/"translation"\s*:\s*"((?:\\.|[^"\\])*)/)
  if (partialJsonTranslation) {
    try {
      return JSON.parse(`"${partialJsonTranslation[1]}"`).trim()
    }
    catch {
      return partialJsonTranslation[1].trim()
    }
  }

  try {
    const parsed = JSON.parse(content) as AiTranslationResponse
    if (parsed?.translation)
      return parsed.translation.trim()
  }
  catch {}

  return content.replace(/^(译文|翻译|translation)\s*[:：]\s*/i, '').trim()
}

async function fetchChatCompletion(request: AiRequestContext, system: string, user: ChatMessageContent, stream: boolean, signal?: AbortSignal) {
  return fetch(request.endpoint, {
    method: 'POST',
    headers: request.headers,
    signal,
    body: buildChatBody(
      request.model,
      system,
      user,
      stream,
    ),
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown) {
  return (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError')
}

function getRawAiText(value: unknown) {
  try {
    return normalizeTranslationText(extractTextContent(value))
  }
  catch {
    return JSON.stringify(value)
  }
}

function parseRawAiText(value: string) {
  if (!value.trim())
    return ''

  try {
    return getRawAiText(JSON.parse(value))
  }
  catch {
    return normalizeTranslationText(value)
  }
}

function getTranslationDirectionInstruction(direction: TranslationDirection) {
  if (direction === 'zh-to-en')
    return 'Translate from Chinese to English. Output natural English only.'

  if (direction === 'en-to-zh')
    return 'Translate from English to Simplified Chinese. The final answer MUST be Simplified Chinese only.'

  return 'Auto-detect direction: if the selected text is mostly Chinese, translate it into natural English; otherwise translate it into Simplified Chinese. For English, mixed-language, code comments, UI text or any non-Chinese text, the final answer MUST be Simplified Chinese only.'
}

async function readStreamText(response: Response, onText?: (text: string) => void) {
  const reader = response.body?.getReader()
  if (!reader)
    throw new Error('AI stream is empty')

  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''

  while (true) {
    const { done, value } = await reader.read()
    if (value)
      buffer += decoder.decode(value, { stream: !done })

    if (done)
      buffer += decoder.decode()

    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      content += appendStreamLine(line)
      const visible = normalizeTranslationText(content)
      if (visible)
        onText?.(visible)
    }

    if (done)
      break
  }

  if (buffer) {
    content += appendStreamLine(buffer)
    const visible = normalizeTranslationText(content)
    if (visible)
      onText?.(visible)
  }

  const text = normalizeTranslationText(content)
  if (!text)
    throw new Error('AI stream response is empty')

  return text
}

function extractTextContent(value: unknown) {
  if (typeof value === 'string')
    return value

  if (typeof value !== 'object' || value == null)
    throw new Error('AI response is not an object')

  return (value as OpenAiChatResponse).choices?.[0]?.message?.content ?? JSON.stringify(value)
}

async function readAiResponseTextWithUsage(response: Response, promptText: string, onText?: (text: string) => void): Promise<{ text: string, streamed: boolean, usageLog: ReturnType<typeof getUsageLog> }> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream')) {
    const text = await readStreamText(response, onText)
    return {
      text,
      streamed: true,
      usageLog: getUsageLog(undefined, promptText, text),
    }
  }

  const json = await response.json() as OpenAiChatResponse
  const text = normalizeTranslationText(extractTextContent(json))
  if (!text)
    throw new Error('AI response text is empty')

  onText?.(text)
  return {
    text,
    streamed: false,
    usageLog: getUsageLog(json.usage, promptText, text),
  }
}

async function delayProviderStart(delayMs: number, signal: AbortSignal) {
  if (delayMs <= 0)
    return

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, delayMs)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer)
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
        .catch((error) => {
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

async function postAiJsonWithRequest<T>(
  request: AiRequestContext,
  scene: FeatureScene,
  payload: Record<string, unknown>,
  promptOverride: string | undefined,
  signal: AbortSignal,
): Promise<T> {
  let failureLogged = false

  try {
    const user = JSON.stringify({ scene, ...payload })
    const system = promptOverride ?? request.prompt
    const stream = !modelPrefersNonStreaming(request.model)
    let response = await fetchChatCompletion(request, system, user, stream, signal)
    let retryError: string | undefined
    let firstError: string | undefined

    if (!response.ok) {
      firstError = await readErrorText(response)
      if (stream && shouldRetryWithoutStream(response.status, firstError)) {
        retryError = firstError
        firstError = undefined
        response = await fetchChatCompletion(request, system, user, false, signal)
      }
    }

    if (!response.ok) {
      const rawError = firstError ?? await readErrorText(response)
      const error = normalizeAiErrorMessage(response.status, rawError)
      failureLogged = true
      await recordAiCall({
        scene,
        endpoint: request.endpoint,
        model: request.model,
        authSent: Boolean(request.apiKey),
        keyHint: getKeyHint(request.apiKey),
        streamed: false,
        ok: false,
        status: response.status,
        error: retryError ? `${retryError}; retry: ${error}` : error,
        durationMs: Math.round(performance.now() - request.startedAt),
      })
      throw new Error(error)
    }

    let data: T
    let streamed = false
    try {
      const result = await readAiResponseJson<T>(response)
      data = result.data
      streamed = result.streamed
    }
    catch (error) {
      if (!stream)
        throw error

      retryError = getErrorMessage(error)
      response = await fetchChatCompletion(request, system, user, false, signal)
      if (!response.ok) {
        const responseError = await readErrorText(response)
        throw new Error(normalizeAiErrorMessage(response.status, `${retryError}; retry: ${responseError}`))
      }

      const result = await readAiResponseJson<T>(response)
      data = result.data
      streamed = result.streamed
    }
    const usageLog = getUsageLog(undefined, `${system}\n${user}`, JSON.stringify(data))

    await recordAiCall({
      scene,
      endpoint: request.endpoint,
      model: request.model,
      authSent: Boolean(request.apiKey),
      keyHint: getKeyHint(request.apiKey),
      streamed,
      ok: true,
      status: response.status,
      ...usageLog,
      durationMs: Math.round(performance.now() - request.startedAt),
    })

    return data
  }
  catch (error) {
    if (isAbortError(error))
      throw error

    if (!failureLogged && error instanceof Error) {
      await recordAiCall({
        scene,
        endpoint: request.endpoint,
        model: request.model,
        authSent: Boolean(request.apiKey),
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

async function postAiJson<T>(
  settings: LexiSettings,
  scene: FeatureScene,
  payload: Record<string, unknown>,
  promptOverride?: string,
): Promise<T | undefined> {
  const requests = createAiRequestContexts(settings, scene)
  return runProviderRace(requests, (request, signal) => postAiJsonWithRequest<T>(request, scene, payload, promptOverride, signal))
}

async function postAiTextWithRequest(
  request: AiRequestContext,
  scene: FeatureScene,
  text: ChatMessageContent,
  onText: ((text: string) => void) | undefined,
  promptOverride: string | undefined,
  signal: AbortSignal,
) {
  let failureLogged = false

  try {
    const system = promptOverride ?? request.prompt
    const promptText = typeof text === 'string'
      ? `${system}\n${text}`
      : `${system}\n${JSON.stringify(text)}`
    const stream = !modelPrefersNonStreaming(request.model)
    let response = await fetchChatCompletion(request, system, text, stream, signal)
    let retryError: string | undefined
    let firstError: string | undefined

    if (!response.ok) {
      firstError = await readErrorText(response)
      if (stream && shouldRetryWithoutStream(response.status, firstError)) {
        retryError = firstError
        firstError = undefined
        response = await fetchChatCompletion(request, system, text, false, signal)
      }
    }

    if (!response.ok) {
      const rawError = firstError ?? await readErrorText(response)
      const error = normalizeAiErrorMessage(response.status, rawError)
      failureLogged = true
      await recordAiCall({
        scene,
        endpoint: request.endpoint,
        model: request.model,
        authSent: Boolean(request.apiKey),
        keyHint: getKeyHint(request.apiKey),
        streamed: false,
        ok: false,
        status: response.status,
        error: retryError ? `${retryError}; retry: ${error}` : error,
        durationMs: Math.round(performance.now() - request.startedAt),
      })
      throw new Error(error)
    }

    let translated: string
    let streamed = false
    let usageLog: ReturnType<typeof getUsageLog>
    try {
      const result = await readAiResponseTextWithUsage(response, promptText, onText)
      translated = result.text
      streamed = result.streamed
      usageLog = result.usageLog
    }
    catch (error) {
      if (!stream)
        throw error

      retryError = getErrorMessage(error)
      response = await fetchChatCompletion(request, system, text, false, signal)
      if (!response.ok) {
        const responseError = await readErrorText(response)
        throw new Error(normalizeAiErrorMessage(response.status, `${retryError}; retry: ${responseError}`))
      }

      const result = await readAiResponseTextWithUsage(response, promptText, onText)
      translated = result.text
      streamed = result.streamed
      usageLog = result.usageLog
    }
    await recordAiCall({
      scene,
      endpoint: request.endpoint,
      model: request.model,
      authSent: Boolean(request.apiKey),
      keyHint: getKeyHint(request.apiKey),
      streamed,
      ok: true,
      status: response.status,
      ...usageLog,
      durationMs: Math.round(performance.now() - request.startedAt),
    })

    return translated
  }
  catch (error) {
    if (isAbortError(error))
      throw error

    if (!failureLogged && error instanceof Error) {
      await recordAiCall({
        scene,
        endpoint: request.endpoint,
        model: request.model,
        authSent: Boolean(request.apiKey),
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

async function postAiText(
  settings: LexiSettings,
  scene: FeatureScene,
  text: ChatMessageContent,
  onText?: (text: string) => void,
  promptOverride?: string,
): Promise<string | undefined> {
  const requests = createAiRequestContexts(settings, scene)
  return runProviderRace(requests, (request, signal, index) => postAiTextWithRequest(
    request,
    scene,
    text,
    index === 0 ? onText : undefined,
    promptOverride,
    signal,
  ))
}

export async function requestLexiDialogAnswer(
  settings: LexiSettings,
  question: string,
  context: {
    selected?: string
    translation?: string
    detail?: string
    page?: string
  },
  onText?: (text: string) => void,
) {
  return postAiText(
    settings,
    'selection',
    [
      `用户问题：${question}`,
      context.selected ? `当前选区：${context.selected}` : '',
      context.translation ? `最近翻译：${context.translation}` : '',
      context.detail ? `翻译说明：${context.detail}` : '',
      context.page ? `页面上下文：${context.page}` : '',
    ].filter(Boolean).join('\n\n'),
    onText,
    [
      '你是 Lexi 的网页上下文助手。',
      '基于用户选区、最近翻译和页面上下文回答。',
      '回答要简洁、直接、中文优先；如涉及术语，给出短解释。',
      '不要输出 JSON、Markdown 标题或思考过程。',
    ].join(' '),
  )
}

export async function requestReplacementCandidates(
  settings: LexiSettings,
  text: string,
  context: string,
) {
  const data = await postAiJson<AiReplacementResponse>(settings, 'replacement', {
    text,
    context,
    instruction: [
      'Extract two kinds of reusable vocabulary entries from the page text.',
      '1) Chinese programming/AI terms that are useful for learning English: set original to the Chinese term and replacement to a natural English expression.',
      '2) Product, brand, model, platform, library, framework, CLI or service names such as Codex, ChatGPT, Claude, GitHub Actions, Vite, React, Next.js: record them as product knowledge, but DO NOT translate or rename them. For product entries set original and replacement to the exact same surface name from the page.',
      'Add tag "product" for product/name entries; add "technical" for general technical terms. You may add more concise tags such as ai, cli, framework, platform.',
      'Product entries will be reused by Lexi for hover explanations only, not for text replacement.',
      'Write meaning with Chinese first and English if useful, e.g. "反向代理；英文：a server that forwards client requests to backend servers" so the hover tooltip is understandable to Chinese readers.',
      'Return compact JSON only: {"items":[{"original":"","replacement":"","meaning":"","example":"","tags":["technical"],"difficulty":2}]}',
    ].join(' '),
  }, [
    'You are Lexi vocabulary extractor for programmer English learning.',
    'Return only valid compact JSON. No markdown, no explanations, no hidden reasoning.',
    'Write all meaning fields in Chinese first; include brief English explanation only if useful.',
    'Preserve product names exactly. Never translate product names; mark them with tag "product".',
  ].join(' '))

  return data?.items?.filter(item => item.original && item.replacement) ?? []
}

export async function requestSelectionTranslation(
  settings: LexiSettings,
  text: string,
  context: string,
  onTranslation?: (translation: SelectionTranslation) => void,
): Promise<SelectionTranslation | undefined> {
  const translated = await postAiText(
    settings,
    'selection',
    [
      getTranslationDirectionInstruction(settings.selection.translationDirection),
      'Translate ONLY the text between <selected> and </selected>.',
      'Use context only to disambiguate meaning, tone, speaker intent and subtext; do not translate or paraphrase the context.',
      'Make the final translation accurate, natural and human-sounding. Avoid translationese; rewrite sentence order when needed.',
      'Return only the final polished translation, with no explanation.',
      `<selected>${text}</selected>`,
      `<context>${context.slice(0, 360)}</context>`,
    ].join('\n'),
    value => onTranslation?.({
      original: text,
      translation: value,
      explanation: '由已配置 AI 服务生成。',
      source: 'ai',
    }),
  )

  if (!translated)
    return undefined

  return {
    original: text,
    translation: translated,
    explanation: '由已配置 AI 服务生成。',
    source: 'ai',
  }
}

export async function requestPageTranslationBatch(
  settings: LexiSettings,
  items: Array<{ id: string, text: string }>,
  context: string,
) {
  if (!items.length)
    return []

  const data = await postAiJson<AiPageTranslationBatchResponse>(settings, 'selection', {
    items: items.map(item => ({ id: item.id, text: item.text.slice(0, 900) })),
    context: context.slice(0, 900),
    direction: settings.selection.translationDirection,
    instruction: [
      getTranslationDirectionInstruction(settings.selection.translationDirection),
      'Translate every item independently for page auto-translation.',
      'Keep ids exactly unchanged. Preserve code, URLs, product names and Markdown-like tokens.',
      'Use context only to disambiguate; do not translate context itself.',
      'Return compact JSON only: {"items":[{"id":"same-id","translation":"translated text"}]}',
    ].join(' '),
  }, [
    'You are Lexi page auto-translator. Return only compact JSON matching the requested schema.',
    'Translations must be natural, concise and human-sounding. No markdown, no hidden reasoning.',
  ].join(' '))

  return data?.items
    ?.filter(item => item.id && item.translation)
    .map(item => ({ id: item.id!, translation: item.translation!.trim() })) ?? []
}

export async function requestSelectionDetail(
  settings: LexiSettings,
  text: string,
  translation: string,
  context: string,
) {
  const data = await postAiJson<AiSelectionDetailResponse>(settings, 'selection', {
    text,
    translation,
    context: context.slice(0, 240),
    instruction: [
      'Explain only terms that help understand the selected text.',
      'Put each term explanation into terms as one short item.',
      'For Chinese terms, terms[].term must be the short Chinese term from the selected text; the matching English expression must be in candidate.replacement, not in terms[].term.',
      'For English terms, terms[].term must be the short English term itself, never the whole selected sentence.',
      'Give a brief context comment about tone, intent, relationship or subtext after considering the surrounding context.',
      'Give one short translation optimization suggestion: how to make the translation more natural and human-sounding, avoiding translationese.',
      'Keep explanation, context, translationReview and advice under 60 Chinese characters each.',
      'If the selected text contains a reusable technical term, return a candidate dictionary entry. candidate.original must be the exact short source term, and candidate.replacement must be a concise translation/name, not a full sentence.',
      'Return JSON: {"explanation":"","terms":[{"term":"","explanation":""}],"context":"","translationReview":"","advice":"","candidate":{"original":"","replacement":"","meaning":"","example":"","tags":["technical"],"difficulty":2}}.',
    ].join(' '),
  }, [
    'You are Lexi. Return only compact JSON matching the requested schema.',
    'Use plain Chinese. Keep comments short, specific and useful.',
    'Do not include markdown or hidden reasoning.',
  ].join(' '))

  return data
}

export async function requestGitHubDigest(
  settings: LexiSettings,
  context: {
    repo: string
    description?: string
    topics: string[]
    languages: string[]
    files: string[]
    readme: string
    pageText?: string
    mode?: 'quick' | 'detail'
  },
) {
  const isDetail = context.mode === 'detail'
  const data = await postAiJson<Partial<GitHubDigestResult>>(settings, 'daily', {
    scene: isDetail ? 'github-digest-detail' : 'github-digest-quick',
    ...context,
    readme: context.readme.slice(0, isDetail ? 5200 : 2200),
    instruction: isDetail
      ? [
          'Create a detailed GitHub repository overview for a developer reader.',
          'Use README plus current page content, topics, languages and visible files.',
          'Include practical AI-style comments: what looks valuable, possible use cases, what to inspect first, and any caveats or learning angle.',
          'Keep it concise and scannable. Use Chinese for oneLine, details, audience and startHere. Keep techStack and terms as concise technical names when appropriate.',
          'Return JSON only: {"oneLine":"","details":"","audience":[""],"techStack":[""],"startHere":[""],"terms":[""]}.',
        ].join(' ')
      : [
          'Create a quick GitHub repository digest for a developer reader.',
          'Translate and explain the project description in Chinese, infer the project purpose from metadata and README excerpt, and give one short AI-style comment or suggestion in details.',
          'Keep it very short. Use Chinese for oneLine and details. Keep techStack and terms as concise technical names when appropriate.',
          'Return JSON only: {"oneLine":"","details":"","audience":[""],"techStack":[""],"startHere":[""],"terms":[""]}.',
        ].join(' '),
  }, [
    'You are Lexi GitHub Digest. Return only compact JSON matching the requested schema.',
    'No markdown, no hidden reasoning. Prefer concise Chinese explanations and practical developer-oriented comments.',
  ].join(' '))

  if (!data?.oneLine)
    return undefined

  return {
    oneLine: data.oneLine,
    details: typeof data.details === 'string' ? data.details.trim() : undefined,
    audience: Array.isArray(data.audience) ? data.audience.filter(Boolean).slice(0, 4) : [],
    techStack: Array.isArray(data.techStack) ? data.techStack.filter(Boolean).slice(0, 8) : [],
    startHere: Array.isArray(data.startHere) ? data.startHere.filter(Boolean).slice(0, 5) : [],
    terms: Array.isArray(data.terms) ? data.terms.filter(Boolean).slice(0, 8) : [],
  }
}

export async function requestMediaAnalysis(
  settings: LexiSettings,
  input: MediaAnalysisInput,
  onText?: (text: string) => void,
) {
  const metadata = [
    `媒体类型：${input.kind}`,
    input.title ? `标题：${input.title}` : '',
    input.alt ? `替代文本：${input.alt}` : '',
    input.mimeType ? `MIME：${input.mimeType}` : '',
    input.width && input.height ? `尺寸：${input.width}x${input.height}` : '',
    Number.isFinite(input.duration) ? `时长：${Math.round(input.duration ?? 0)} 秒` : '',
    Number.isFinite(input.currentTime) ? `当前时间：${Math.round(input.currentTime ?? 0)} 秒` : '',
    `媒体 URL：${input.src}`,
    input.poster ? `封面 URL：${input.poster}` : '',
    `页面：${input.pageTitle || input.pageUrl}`,
    `页面 URL：${input.pageUrl}`,
    input.context ? `页面上下文：${input.context.slice(0, 900)}` : '',
  ].filter(Boolean).join('\n')

  const images = [input.frameDataUrl, input.mediaDataUrl, input.poster]
    .filter((value): value is string => Boolean(value && (/^data:image\//i.test(value) || /^https?:\/\//i.test(value))))
    .slice(0, 2)
  const content: ChatMessageContent = images.length
    ? [
        {
          type: 'text',
          text: [
            '请观察这个网页媒体，并提取一段用于还原该图像/画面的纯文本 prompt。',
            input.kind === 'video'
              ? '已附上当前视频帧或封面；只基于可见帧提取画面还原 prompt，不要分析剧情。'
              : input.kind === 'audio'
                ? '如果没有可见内容，只能根据封面/元数据输出视觉还原 prompt，不要声称听到了音频。'
                : '已附上图片；请描述主体、场景、构图、颜色、光照、材质、UI/文字细节、风格、比例和氛围。',
            '只输出 prompt 正文，纯文本一段或多句。不要输出“可复制提示词”、解释、标题、Markdown、代码块、列表或分析报告。',
            metadata,
          ].join('\n\n'),
        },
        ...images.map(url => ({
          type: 'image_url' as const,
          image_url: { url, detail: 'auto' as const },
        })),
      ]
    : [
        '请基于这个网页媒体生成一段用于还原该图像/画面的纯文本 prompt。',
        '当前没有可直接传入模型的图片帧；只能根据媒体元数据、URL、文件名和页面上下文谨慎描述，不要编造不可见内容。',
        '只输出 prompt 正文。不要输出解释、标题、Markdown、代码块、列表或分析报告。',
        metadata,
      ].join('\n\n')

  return postAiText(settings, 'omni', content, onText)
}

export async function testAiScene(settings: LexiSettings, scene: FeatureScene) {
  const request = createAiRequestContext(settings, scene)
  if (!request)
    throw new Error('AI 场景未启用或 Endpoint 未配置')

  const user = scene === 'selection'
    ? [
        getTranslationDirectionInstruction(settings.selection.translationDirection),
        'Translate only the selected text. Make it natural and human-sounding; avoid translationese.',
        'Selected text: optimistic update',
        'Context: The UI applies an optimistic update before the server confirms the change.',
      ].join('\n')
    : scene === 'omni'
      ? [
          {
            type: 'text' as const,
            text: 'Connection test for Lexi AI Omni. 请用简体中文说明：这是一张用于测试多模态连接的 1x1 图片，并返回一句简短分析。',
          },
          {
            type: 'image_url' as const,
            image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', detail: 'low' as const },
          },
        ]
      : JSON.stringify({
        scene,
        text: '上下文',
        context: '模型需要足够的上下文才能给出稳定结果。',
        instruction: 'Connection test. Return a minimal valid result for this scene.',
      })

  const requestUser = typeof user === 'string' ? user : JSON.stringify(user)
  const body = buildChatBody(request.model, request.prompt, user, false)

  try {
    const response = await fetch(request.endpoint, {
      method: 'POST',
      headers: request.headers,
      body,
    })

    const durationMs = Math.round(performance.now() - request.startedAt)
    const rawResponse = await response.text()
    const responseText = parseRawAiText(rawResponse)
    const usageLog = getUsageLog(undefined, `${request.prompt}\n${requestUser}`, responseText)
    const result: AiTestResult = {
      ok: response.ok,
      request: {
        endpoint: request.endpoint,
        model: request.model,
        system: request.prompt,
        user: requestUser,
        stream: false,
        authSent: Boolean(request.apiKey),
        keyHint: getKeyHint(request.apiKey),
      },
      response: responseText,
      status: response.status,
      durationMs,
    }

    await recordAiCall({
      scene,
      endpoint: request.endpoint,
      model: request.model,
      authSent: Boolean(request.apiKey),
      keyHint: getKeyHint(request.apiKey),
      streamed: false,
      ok: response.ok,
      status: response.status,
      ...usageLog,
      error: response.ok ? undefined : responseText.slice(0, 240),
      durationMs,
    })

    return result
  }
  catch (error) {
    if (error instanceof Error) {
      const durationMs = Math.round(performance.now() - request.startedAt)
      await recordAiCall({
        scene,
        endpoint: request.endpoint,
        model: request.model,
        authSent: Boolean(request.apiKey),
        keyHint: getKeyHint(request.apiKey),
        streamed: false,
        ok: false,
        error: error.message,
        durationMs,
      })

      return {
        ok: false,
        request: {
          endpoint: request.endpoint,
          model: request.model,
          system: request.prompt,
          user: requestUser,
          stream: false,
          authSent: Boolean(request.apiKey),
          keyHint: getKeyHint(request.apiKey),
        },
        response: error.message,
        durationMs,
      }
    }

    throw error
  }
}

export function localTranslateSelection(text: string): SelectionTranslation {
  const exact = findCandidateByText(text)
  if (exact) {
    return {
      original: text,
      translation: exact.replacement,
      explanation: `${exact.meaning} 示例：${exact.example}`,
      source: 'local',
      candidate: exact,
    }
  }

  const matched = programmerVocabulary.find(item => text.includes(item.original) || text.toLowerCase().includes(item.replacement.toLowerCase()))
  if (matched) {
    return {
      original: text,
      translation: text.replace(matched.original, matched.replacement),
      explanation: `${matched.original} 可理解为 ${matched.replacement}。${matched.meaning}`,
      source: 'local',
      candidate: matched,
    }
  }

  return {
    original: text,
    translation: text,
    explanation: '暂未命中本地术语库。可在选项页为划词翻译配置 AI 后端。',
    source: 'local',
  }
}
