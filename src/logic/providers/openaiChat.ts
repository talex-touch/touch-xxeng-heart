import {
  isRecord,
  normalizeApiKey,
  parseEventData,
  readNumber,
  readString,
  resolveApiUrl,
} from './protocol'
import type { ProtocolAdapter, ProviderModel } from './protocol'

interface OpenAiChatResponse {
  choices?: Array<{
    message?: { content?: unknown }
    delta?: { content?: unknown }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export function buildOpenAiHeaders(apiKey: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const key = normalizeApiKey(apiKey)
  if (key)
    headers.authorization = `Bearer ${key}`

  return headers
}

/** `data[].id` is the shape both OpenAI and every compatible gateway return. */
export function readOpenAiModels(payload: unknown): ProviderModel[] {
  if (!isRecord(payload))
    return []

  const data = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : []
  return data
    .map((item): ProviderModel | undefined => {
      if (typeof item === 'string')
        return { id: item }

      if (!isRecord(item))
        return undefined

      const id = readString(item.id) || readString(item.name) || readString(item.model)
      if (!id)
        return undefined

      const label = readString(item.display_name) || readString((item as { displayName?: unknown }).displayName)
      return label && label !== id ? { id, label } : { id }
    })
    .filter((item): item is ProviderModel => item != null)
}

export const openAiChatAdapter: ProtocolAdapter = {
  id: 'openai-chat',
  label: 'OpenAI Chat Completions',

  resolveChatUrl(endpoint) {
    return resolveApiUrl(endpoint, '/chat/completions')
  },

  buildChatRequest(input) {
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
      stream: input.stream,
    }

    if (input.temperature != null)
      body.temperature = input.temperature

    return {
      url: this.resolveChatUrl(input.endpoint),
      method: 'POST',
      headers: buildOpenAiHeaders(input.apiKey),
      body: JSON.stringify(body),
    }
  },

  readText(payload) {
    if (!isRecord(payload))
      return ''

    const choices = (payload as OpenAiChatResponse).choices ?? []
    return choices
      .map(choice => readString(choice.message?.content) || readString(choice.delta?.content))
      .join('')
  },

  readUsage(payload) {
    if (!isRecord(payload))
      return undefined

    const usage = (payload as OpenAiChatResponse).usage
    if (!usage)
      return undefined

    return {
      promptTokens: readNumber(usage.prompt_tokens),
      completionTokens: readNumber(usage.completion_tokens),
      totalTokens: readNumber(usage.total_tokens),
    }
  },

  readStreamDelta(event) {
    const payload = parseEventData(event.data)
    if (!isRecord(payload))
      return ''

    const choices = (payload as OpenAiChatResponse).choices ?? []
    return choices
      .map(choice => readString(choice.delta?.content) || readString(choice.message?.content))
      .join('')
  },

  buildModelsRequest(input) {
    return {
      url: resolveApiUrl(input.endpoint, '/models'),
      method: 'GET',
      headers: buildOpenAiHeaders(input.apiKey),
    }
  },

  readModels: readOpenAiModels,
}
