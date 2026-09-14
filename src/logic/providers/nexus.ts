import {
  isRecord,
  normalizeApiKey,
  parseDataUrl,
  readNumber,
  readString,
  toContentParts,
} from './protocol'
import type { AiChatMessage, HttpRequestPlan, ProtocolAdapter, ProtocolUsage, ProviderModel } from './protocol'

/**
 * Tuff Nexus is a capability gateway, not an OpenAI-compatible endpoint.
 *
 * Its chat call is `POST /api/v1/intelligence/invoke` with a `{capabilityId, payload, options}`
 * envelope, its auth is a device token the credential store never hands to this layer (the worker
 * attaches it inside `nexusAuthorizedFetch`), and translation is a capability of its own rather
 * than a chat turn. The adapter therefore builds envelopes and reads `{invocation}` replies, and
 * keeps every non-streaming: only `text.chat` has a streaming route, and the invoke reply is what
 * carries the credit settlement.
 */

/** Canonical invoke route. Origin pinning belongs to `nexusAuthorizedFetch`, not to a URL literal. */
export const NEXUS_INVOKE_PATH = '/api/v1/intelligence/invoke'
/** The `AiProtocol` member this adapter registers under. Distinct from the provider id `tuff-nexus`. */
export const NEXUS_PROTOCOL_ID = 'nexus-intelligence'
export const NEXUS_CHAT_CAPABILITY = 'text.chat'
export const NEXUS_TRANSLATE_CAPABILITY = 'text.translate'

/** Audit labels the worker sends so Nexus can tell a Lexi call from a Tuff one. */
export const NEXUS_AUDIT_METADATA = { source: 'lexi', caller: 'browser-extension' } as const

/** Nexus routes by capability, so its catalogue is one local placeholder and never fetched. */
export const NEXUS_LOCAL_MODELS: ProviderModel[] = [{ id: 'auto', label: 'Nexus 自动路由' }]

export function readNexusModels(_payload?: unknown): ProviderModel[] {
  return NEXUS_LOCAL_MODELS.map(model => ({ ...model }))
}

export interface NexusAttachment {
  type: 'image'
  /** `data:image/…;base64,…`; nothing else can ride a Nexus attachment. */
  dataUrl: string
}

/** A message as the gateway's `text.chat` payload expects it. */
export interface NexusChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  attachments?: NexusAttachment[]
}

export interface NexusInvokeOptions {
  stream: false
  metadata: typeof NEXUS_AUDIT_METADATA
}

export interface NexusChatEnvelope {
  capabilityId: typeof NEXUS_CHAT_CAPABILITY
  payload: { messages: NexusChatMessage[] }
  options: NexusInvokeOptions
}

export interface NexusTranslateEnvelope {
  capabilityId: typeof NEXUS_TRANSLATE_CAPABILITY
  payload: { text: string, targetLang: string, sourceLang?: string }
  options: NexusInvokeOptions
}

export type NexusInvokeEnvelope = NexusChatEnvelope | NexusTranslateEnvelope

/**
 * The relative canonical route.
 *
 * `endpoint` is accepted for signature parity only: a Nexus provider is locked to the canonical
 * origin, and `nexusAuthorizedFetch` refuses anything but a relative `/api/` path, so returning an
 * absolute URL here would break the only call path that can carry the token.
 */
export function resolveNexusInvokeUrl(_endpoint?: string): string {
  return NEXUS_INVOKE_PATH
}

export function buildNexusHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const key = normalizeApiKey(apiKey)
  if (key)
    headers.authorization = `Bearer ${key}`

  return headers
}

/**
 * Maps Lexi messages onto the gateway's message shape.
 *
 * Text parts become the message body; image parts that carry a `data:` URL move out of the content
 * into `attachments`. An image part without inline bytes has no Nexus representation, so it is a
 * malformed envelope and fails closed instead of being dropped silently.
 */
export function toNexusMessages(messages: AiChatMessage[]): NexusChatMessage[] {
  const mapped: NexusChatMessage[] = []

  for (const message of messages) {
    let content = ''
    const attachments: NexusAttachment[] = []

    for (const part of toContentParts(message.content)) {
      if (part.type === 'text') {
        content = content ? `${content}\n${part.text}` : part.text
        continue
      }

      const url = part.image_url.url
      if (!parseDataUrl(url))
        throw new Error('Nexus 只能发送内联图片，无法发送该图片地址。')

      attachments.push({ type: 'image', dataUrl: url })
    }

    if (!content && !attachments.length)
      continue

    mapped.push(attachments.length
      ? { role: message.role, content, attachments }
      : { role: message.role, content })
  }

  if (!mapped.length)
    throw new Error('Nexus 请求缺少可发送的消息。')

  return mapped
}

export function buildNexusChatEnvelope(messages: AiChatMessage[]): NexusChatEnvelope {
  return {
    capabilityId: NEXUS_CHAT_CAPABILITY,
    payload: { messages: toNexusMessages(messages) },
    options: { stream: false, metadata: { ...NEXUS_AUDIT_METADATA } },
  }
}

export function buildNexusTranslateEnvelope(input: { text: string, targetLang: string, sourceLang?: string }): NexusTranslateEnvelope {
  const text = input.text.trim()
  const targetLang = input.targetLang.trim()
  if (!text || !targetLang)
    throw new Error('Nexus 翻译请求缺少文本或目标语言。')

  const sourceLang = input.sourceLang?.trim()
  return {
    capabilityId: NEXUS_TRANSLATE_CAPABILITY,
    payload: sourceLang ? { text, targetLang, sourceLang } : { text, targetLang },
    options: { stream: false, metadata: { ...NEXUS_AUDIT_METADATA } },
  }
}

export function buildNexusInvokeRequest(
  envelope: NexusInvokeEnvelope,
  input?: { apiKey?: string },
): HttpRequestPlan {
  return {
    url: resolveNexusInvokeUrl(),
    method: 'POST',
    headers: buildNexusHeaders(input?.apiKey ?? ''),
    body: JSON.stringify(envelope),
  }
}

export interface NexusUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cost?: number
}

/** The credit settlement Nexus returns with an invoke. */
export interface NexusBilling {
  ledgerId?: string
  chargedCredits: number
  unit: string
  quantity: number
  reservedCredits: number
  reserveId: string
  billable: boolean
  settleFailed?: boolean
  unsettledCredits?: number
  reason: string
}

export interface NexusInvocation {
  capabilityId: string
  /** Assistant text; the gateway normalises `text.chat` and `text.translate` to a string. */
  result: string
  usage: NexusUsage
  model: string
  provider: string
  traceId: string
  latency: number
  fallbackCount: number
  retryCount: number
  attemptedProviders: string[]
  billing?: NexusBilling
}

/** The `{invocation}` envelope, or a bare invocation object for a hand-built fixture. */
function readInvocationRecord(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload))
    return undefined

  if (isRecord(payload.invocation))
    return payload.invocation

  return 'result' in payload ? payload : undefined
}

function readNexusBillingRecord(value: unknown): NexusBilling | undefined {
  if (!isRecord(value))
    return undefined

  const chargedCredits = readNumber(value.chargedCredits)
  const reservedCredits = readNumber(value.reservedCredits)
  if (chargedCredits == null || reservedCredits == null)
    return undefined

  const billing: NexusBilling = {
    chargedCredits,
    reservedCredits,
    unit: readString(value.unit),
    quantity: readNumber(value.quantity) ?? 0,
    reserveId: readString(value.reserveId),
    billable: value.billable === true,
    reason: readString(value.reason),
  }

  if (typeof value.ledgerId === 'string')
    billing.ledgerId = value.ledgerId
  if (typeof value.settleFailed === 'boolean')
    billing.settleFailed = value.settleFailed
  const unsettledCredits = readNumber(value.unsettledCredits)
  if (unsettledCredits != null)
    billing.unsettledCredits = unsettledCredits

  return billing
}

export function readNexusBilling(payload: unknown): NexusBilling | undefined {
  return readNexusBillingFromInvocation(readInvocationRecord(payload))
}

function readNexusBillingFromInvocation(invocation: Record<string, unknown> | undefined): NexusBilling | undefined {
  if (!invocation || !isRecord(invocation.metadata))
    return undefined

  return readNexusBillingRecord(invocation.metadata.billing)
}

export function readNexusUsage(payload: unknown): ProtocolUsage | undefined {
  const invocation = readInvocationRecord(payload)
  if (!invocation || !isRecord(invocation.usage))
    return undefined

  return {
    promptTokens: readNumber(invocation.usage.promptTokens) ?? 0,
    completionTokens: readNumber(invocation.usage.completionTokens) ?? 0,
    totalTokens: readNumber(invocation.usage.totalTokens) ?? 0,
  }
}

/** Trusted decoding of one `{invocation}` reply; `undefined` when the envelope is malformed. */
export function readNexusInvocation(payload: unknown): NexusInvocation | undefined {
  const invocation = readInvocationRecord(payload)
  if (!invocation || !('result' in invocation))
    return undefined

  const usageRecord = isRecord(invocation.usage) ? invocation.usage : undefined
  const usage: NexusUsage = {
    promptTokens: readNumber(usageRecord?.promptTokens) ?? 0,
    completionTokens: readNumber(usageRecord?.completionTokens) ?? 0,
    totalTokens: readNumber(usageRecord?.totalTokens) ?? 0,
  }
  const cost = readNumber(usageRecord?.cost)
  if (cost != null)
    usage.cost = cost

  const meta = isRecord(invocation.metadata) ? invocation.metadata : undefined

  return {
    capabilityId: readString(invocation.capabilityId),
    result: typeof invocation.result === 'string' ? invocation.result : '',
    usage,
    model: readString(invocation.model),
    provider: readString(invocation.provider),
    traceId: readString(invocation.traceId),
    latency: readNumber(invocation.latency) ?? 0,
    fallbackCount: readNumber(meta?.fallbackCount) ?? 0,
    retryCount: readNumber(meta?.retryCount) ?? 0,
    attemptedProviders: (meta && Array.isArray(meta.attemptedProviders) ? meta.attemptedProviders : [])
      .filter((item): item is string => typeof item === 'string'),
    billing: readNexusBillingFromInvocation(invocation),
  }
}

export function readNexusText(payload: unknown): string {
  return readNexusInvocation(payload)?.result ?? ''
}

export const nexusAdapter: ProtocolAdapter = {
  id: NEXUS_PROTOCOL_ID,
  label: 'Tuff Nexus',

  resolveChatUrl: resolveNexusInvokeUrl,

  buildChatRequest(input) {
    return buildNexusInvokeRequest(buildNexusChatEnvelope(input.messages), { apiKey: input.apiKey })
  },

  readText: readNexusText,
  readUsage: readNexusUsage,

  /** The invoke route is non-streaming by design; only `text.chat` has a stream, and Lexi never uses it. */
  readStreamDelta() {
    return ''
  },

  /**
   * Nexus routes by capability, so there is no model catalogue to fetch. The editor should show
   * the local `auto` entry rather than call this; fetching an unknown route would only 404.
   */
  buildModelsRequest() {
    throw new Error('Nexus 的模型由服务端按能力自动路由，无需也无法列出。')
  },

  readModels: readNexusModels,
}
