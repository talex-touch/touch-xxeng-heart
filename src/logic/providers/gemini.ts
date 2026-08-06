import {
  isRecord,
  normalizeApiKey,
  parseDataUrl,
  parseEventData,
  readNumber,
  readString,
  splitSystemMessages,
  toContentParts,
  trimEndpoint,
} from './protocol'
import type { AiChatMessage, ProtocolAdapter, ProviderModel } from './protocol'

const defaultGeminiEndpoint = 'https://generativelanguage.googleapis.com'
const versionedPathPattern = /\/v\d[a-z0-9]*$/i

interface GeminiPayload {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

function buildGeminiHeaders(apiKey: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const key = normalizeApiKey(apiKey)
  if (key)
    headers['x-goog-api-key'] = key

  return headers
}

function resolveVersionedBase(endpoint: string) {
  const trimmed = trimEndpoint(endpoint) || defaultGeminiEndpoint
  return versionedPathPattern.test(trimmed) ? trimmed : `${trimmed}/v1beta`
}

function normalizeModelId(model: string) {
  return model.trim().replace(/^models\//, '')
}

function toGeminiParts(message: AiChatMessage) {
  return toContentParts(message.content).map((part) => {
    if (part.type === 'text')
      return { text: part.text }

    const dataUrl = parseDataUrl(part.image_url.url)
    // Remote files need the Files API, so a plain URL is passed through as text
    // rather than silently dropped.
    return dataUrl
      ? { inline_data: { mime_type: dataUrl.mediaType, data: dataUrl.data } }
      : { text: part.image_url.url }
  })
}

function readGeminiText(payload: GeminiPayload) {
  return (payload.candidates ?? [])
    .flatMap(candidate => candidate.content?.parts ?? [])
    .map(part => readString(part.text))
    .join('')
}

export const geminiAdapter: ProtocolAdapter = {
  id: 'gemini',
  label: 'Google Gemini',

  resolveChatUrl(endpoint, input) {
    const model = normalizeModelId(input?.model ?? '')
    const method = input?.stream ? 'streamGenerateContent' : 'generateContent'
    const url = `${resolveVersionedBase(endpoint)}/models/${model}:${method}`
    return input?.stream ? `${url}?alt=sse` : url
  },

  buildChatRequest(input) {
    const { system, messages } = splitSystemMessages(input.messages)
    const body: Record<string, unknown> = {
      contents: messages.map(message => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: toGeminiParts(message),
      })),
    }

    if (system)
      body.systemInstruction = { parts: [{ text: system }] }
    if (input.temperature != null)
      body.generationConfig = { temperature: input.temperature }

    return {
      url: this.resolveChatUrl(input.endpoint, { model: input.model, stream: input.stream }),
      method: 'POST',
      headers: buildGeminiHeaders(input.apiKey),
      body: JSON.stringify(body),
    }
  },

  readText(payload) {
    return isRecord(payload) ? readGeminiText(payload as GeminiPayload) : ''
  },

  readUsage(payload) {
    if (!isRecord(payload))
      return undefined

    const usage = (payload as GeminiPayload).usageMetadata
    if (!usage)
      return undefined

    return {
      promptTokens: readNumber(usage.promptTokenCount),
      completionTokens: readNumber(usage.candidatesTokenCount),
      totalTokens: readNumber(usage.totalTokenCount),
    }
  },

  readStreamDelta(event) {
    const payload = parseEventData(event.data)
    return isRecord(payload) ? readGeminiText(payload as GeminiPayload) : ''
  },

  buildModelsRequest(input) {
    return {
      url: `${resolveVersionedBase(input.endpoint)}/models`,
      method: 'GET',
      headers: buildGeminiHeaders(input.apiKey),
    }
  },

  readModels(payload) {
    if (!isRecord(payload) || !Array.isArray(payload.models))
      return []

    return payload.models
      .map((item): ProviderModel | undefined => {
        if (!isRecord(item))
          return undefined

        const id = normalizeModelId(readString(item.name))
        if (!id)
          return undefined

        const label = readString(item.displayName)
        return label && label !== id ? { id, label } : { id }
      })
      .filter((item): item is ProviderModel => item != null)
  },
}
