import {
  isRecord,
  normalizeApiKey,
  parseDataUrl,
  parseEventData,
  readNumber,
  readString,
  resolveApiUrl,
  splitSystemMessages,
  toContentParts,
} from './protocol'
import { readOpenAiModels } from './openaiChat'
import type { AiChatMessage, ProtocolAdapter } from './protocol'

const anthropicVersion = '2023-06-01'
const defaultMaxTokens = 4096

interface AnthropicPayload {
  content?: Array<{ type?: string, text?: unknown }>
  usage?: { input_tokens?: number, output_tokens?: number }
}

function buildAnthropicHeaders(apiKey: string) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': anthropicVersion,
    // Without this opt-in Anthropic refuses browser-origin requests outright.
    'anthropic-dangerous-direct-browser-access': 'true',
  }

  const key = normalizeApiKey(apiKey)
  if (key)
    headers['x-api-key'] = key

  return headers
}

function toAnthropicContent(message: AiChatMessage) {
  return toContentParts(message.content).map((part) => {
    if (part.type === 'text')
      return { type: 'text', text: part.text }

    const url = part.image_url.url
    const dataUrl = parseDataUrl(url)
    return dataUrl
      ? { type: 'image', source: { type: 'base64', media_type: dataUrl.mediaType, data: dataUrl.data } }
      : { type: 'image', source: { type: 'url', url } }
  })
}

export const anthropicAdapter: ProtocolAdapter = {
  id: 'anthropic-messages',
  label: 'Anthropic Messages',

  resolveChatUrl(endpoint) {
    return resolveApiUrl(endpoint, '/messages')
  },

  buildChatRequest(input) {
    const { system, messages } = splitSystemMessages(input.messages)
    // Anthropic rejects an empty conversation, so a system-only prompt is promoted.
    const turns = messages.length
      ? messages.map(message => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: toAnthropicContent(message),
      }))
      : [{ role: 'user', content: [{ type: 'text', text: system || '' }] }]

    const body: Record<string, unknown> = {
      model: input.model,
      max_tokens: defaultMaxTokens,
      messages: turns,
      stream: input.stream,
    }

    if (system && messages.length)
      body.system = system
    if (input.temperature != null)
      body.temperature = input.temperature

    return {
      url: this.resolveChatUrl(input.endpoint),
      method: 'POST',
      headers: buildAnthropicHeaders(input.apiKey),
      body: JSON.stringify(body),
    }
  },

  readText(payload) {
    if (!isRecord(payload))
      return ''

    return ((payload as AnthropicPayload).content ?? [])
      .filter(block => block.type == null || block.type === 'text')
      .map(block => readString(block.text))
      .join('')
  },

  readUsage(payload) {
    if (!isRecord(payload))
      return undefined

    const usage = (payload as AnthropicPayload).usage
    if (!usage)
      return undefined

    const promptTokens = readNumber(usage.input_tokens)
    const completionTokens = readNumber(usage.output_tokens)
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens != null || completionTokens != null
        ? (promptTokens ?? 0) + (completionTokens ?? 0)
        : undefined,
    }
  },

  readStreamDelta(event) {
    const payload = parseEventData(event.data)
    if (!isRecord(payload))
      return ''

    const type = event.event || readString(payload.type)
    if (type !== 'content_block_delta')
      return ''

    const delta = payload.delta
    return isRecord(delta) ? readString(delta.text) : ''
  },

  buildModelsRequest(input) {
    return {
      url: resolveApiUrl(input.endpoint, '/models'),
      method: 'GET',
      headers: buildAnthropicHeaders(input.apiKey),
    }
  },

  readModels: readOpenAiModels,
}
