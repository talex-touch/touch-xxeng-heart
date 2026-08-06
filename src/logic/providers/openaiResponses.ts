import { buildOpenAiHeaders, readOpenAiModels } from './openaiChat'
import {
  isRecord,
  parseEventData,
  readNumber,
  readString,
  resolveApiUrl,
  splitSystemMessages,
  toContentParts,
} from './protocol'
import type { AiChatMessage, ProtocolAdapter } from './protocol'

interface ResponsesOutputContent {
  type?: string
  text?: unknown
}

interface ResponsesOutputItem {
  type?: string
  content?: ResponsesOutputContent[]
}

interface ResponsesUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

interface ResponsesPayload {
  output_text?: unknown
  output?: ResponsesOutputItem[]
  /** Streaming `response.completed` events nest the whole response one level down. */
  response?: { output_text?: unknown, output?: ResponsesOutputItem[], usage?: ResponsesUsage }
  usage?: ResponsesUsage
}

/** Responses uses `input_*` parts for prompts and `output_text` for prior assistant turns. */
function toResponsesInput(messages: AiChatMessage[]) {
  return messages.map((message) => {
    const parts = toContentParts(message.content).map((part) => {
      if (part.type === 'image_url') {
        return {
          type: 'input_image',
          image_url: part.image_url.url,
          ...part.image_url.detail ? { detail: part.image_url.detail } : {},
        }
      }

      return {
        type: message.role === 'assistant' ? 'output_text' : 'input_text',
        text: part.text,
      }
    })

    return { role: message.role, content: parts }
  })
}

function readOutputItems(payload: ResponsesPayload) {
  return payload.output ?? payload.response?.output ?? []
}

function readOutputText(payload: ResponsesPayload) {
  const direct = payload.output_text ?? payload.response?.output_text
  if (typeof direct === 'string' && direct)
    return direct

  if (Array.isArray(direct))
    return direct.map(item => readString(item)).join('')

  return readOutputItems(payload)
    .filter(item => item.type == null || item.type === 'message')
    .flatMap(item => item.content ?? [])
    .filter(content => content.type == null || content.type === 'output_text')
    .map(content => readString(content.text))
    .join('')
}

export const openAiResponsesAdapter: ProtocolAdapter = {
  id: 'openai-responses',
  label: 'OpenAI Responses',

  resolveChatUrl(endpoint) {
    return resolveApiUrl(endpoint, '/responses')
  },

  buildChatRequest(input) {
    const { system, messages } = splitSystemMessages(input.messages)
    const body: Record<string, unknown> = {
      model: input.model,
      input: toResponsesInput(messages),
      stream: input.stream,
    }

    if (system)
      body.instructions = system
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
    return isRecord(payload) ? readOutputText(payload as ResponsesPayload) : ''
  },

  readUsage(payload) {
    if (!isRecord(payload))
      return undefined

    const usage = (payload as ResponsesPayload).usage ?? (payload as ResponsesPayload).response?.usage
    if (!usage)
      return undefined

    return {
      promptTokens: readNumber(usage.input_tokens),
      completionTokens: readNumber(usage.output_tokens),
      totalTokens: readNumber(usage.total_tokens),
    }
  },

  readStreamDelta(event) {
    const payload = parseEventData(event.data)
    if (!isRecord(payload))
      return ''

    // Gateways sometimes drop the `event:` line, so the payload type is the fallback.
    const type = event.event || readString(payload.type)
    if (type !== 'response.output_text.delta')
      return ''

    return readString(payload.delta)
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
