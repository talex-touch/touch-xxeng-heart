export type AiProtocol = 'auto' | 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'gemini'
/** Every protocol except `auto`, which is resolved before a request is built. */
export type ResolvedAiProtocol = Exclude<AiProtocol, 'auto'>

export type ChatMessageContentPart =
  | { type: 'text', text: string }
  | { type: 'image_url', image_url: { url: string, detail?: 'auto' | 'low' | 'high' } }

export type ChatMessageContent = string | ChatMessageContentPart[]

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: ChatMessageContent
}

export interface ProtocolRequestInput {
  endpoint: string
  apiKey: string
  model: string
  messages: AiChatMessage[]
  stream: boolean
  /** Left undefined for models that reject the parameter. */
  temperature?: number
}

export interface HttpRequestPlan {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
}

export interface ProtocolUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

/** One dispatched `data:` block, with the `event:` name when the backend sends one. */
export interface SseEvent {
  event: string
  data: string
}

export interface ProviderModel {
  id: string
  label?: string
}

export interface ProtocolAdapter {
  id: ResolvedAiProtocol
  label: string
  /** Request URL as it will be logged; `stream` only matters where the path differs. */
  resolveChatUrl: (endpoint: string, input?: { model?: string, stream?: boolean }) => string
  buildChatRequest: (input: ProtocolRequestInput) => HttpRequestPlan
  /** Assistant text from a non-streaming response body. */
  readText: (payload: unknown) => string
  readUsage: (payload: unknown) => ProtocolUsage | undefined
  /** Incremental assistant text for one SSE event; '' when the event carries none. */
  readStreamDelta: (event: SseEvent) => string
  buildModelsRequest: (input: { endpoint: string, apiKey: string }) => HttpRequestPlan
  readModels: (payload: unknown) => ProviderModel[]
}

export function trimEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, '')
}

/**
 * Appends the protocol path unless the endpoint already carries it.
 *
 * Backends are configured either as a base (`https://api.example.com`), as a versioned
 * base (`.../v1`) or as the full route, so all three have to land on the same URL.
 */
export function resolveApiUrl(endpoint: string, path: string, version = 'v1') {
  const trimmed = trimEndpoint(endpoint)
  if (trimmed.endsWith(path))
    return trimmed

  if (trimmed.endsWith(`/${version}`))
    return `${trimmed}${path}`

  return `${trimmed}/${version}${path}`
}

export function normalizeApiKey(value: string) {
  return value.trim().replace(/^Bearer\s+/i, '').trim()
}

export function toContentParts(content: ChatMessageContent): ChatMessageContentPart[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content
}

export function joinTextParts(content: ChatMessageContent) {
  return toContentParts(content)
    .map(part => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
}

/** Protocols other than OpenAI chat carry the system prompt outside the message list. */
export function splitSystemMessages(messages: AiChatMessage[]) {
  const system = messages
    .filter(message => message.role === 'system')
    .map(message => joinTextParts(message.content))
    .filter(Boolean)
    .join('\n\n')

  return {
    system,
    messages: messages.filter(message => message.role !== 'system'),
  }
}

export interface ParsedDataUrl {
  mediaType: string
  data: string
}

export function parseDataUrl(url: string): ParsedDataUrl | undefined {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(url.trim())
  return match ? { mediaType: match[1], data: match[2] } : undefined
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null
}

export function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function readString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

/** SSE payloads are ordinary JSON; a malformed chunk must not abort the stream. */
export function parseEventData(data: string): unknown {
  if (!data || data === '[DONE]')
    return undefined

  try {
    return JSON.parse(data)
  }
  catch {
    return undefined
  }
}
