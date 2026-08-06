import { anthropicAdapter } from './anthropic'
import { geminiAdapter } from './gemini'
import { openAiChatAdapter } from './openaiChat'
import { openAiResponsesAdapter } from './openaiResponses'
import { trimEndpoint } from './protocol'
import type { AiProtocol, ProtocolAdapter, ResolvedAiProtocol } from './protocol'

export * from './protocol'
export { createSseParser } from './sse'

const adapters: Record<ResolvedAiProtocol, ProtocolAdapter> = {
  'openai-chat': openAiChatAdapter,
  'openai-responses': openAiResponsesAdapter,
  'anthropic-messages': anthropicAdapter,
  'gemini': geminiAdapter,
}

export const protocolOptions: Array<{ value: AiProtocol, label: string, hint: string }> = [
  { value: 'auto', label: '自动识别', hint: '按 Endpoint 与模型名推断，识别不出时按 OpenAI Chat 处理。' },
  { value: 'openai-chat', label: 'OpenAI Chat', hint: 'POST /v1/chat/completions，兼容 OpenAI 的网关大多用这个。' },
  { value: 'openai-responses', label: 'OpenAI Responses', hint: 'POST /v1/responses，GPT-5 与 o 系列的新接口。' },
  { value: 'anthropic-messages', label: 'Anthropic', hint: 'POST /v1/messages，Claude 官方接口。' },
  { value: 'gemini', label: 'Google Gemini', hint: 'POST /v1beta/models/{model}:generateContent。' },
]

export function getProtocolAdapter(protocol: ResolvedAiProtocol) {
  return adapters[protocol] ?? openAiChatAdapter
}

/**
 * Infers the wire protocol from how the backend was configured.
 *
 * The explicit route always wins: a full URL says exactly which API it is. Host and model
 * name are only consulted when the endpoint is a bare base URL.
 */
export function detectProtocol(endpoint: string, model: string): ResolvedAiProtocol {
  const trimmed = trimEndpoint(endpoint)
  const normalizedModel = model.trim().toLowerCase()

  if (trimmed.endsWith('/chat/completions'))
    return 'openai-chat'
  if (trimmed.endsWith('/responses'))
    return 'openai-responses'
  if (trimmed.endsWith('/messages'))
    return 'anthropic-messages'
  if (/:(?:stream)?generatecontent/i.test(trimmed))
    return 'gemini'

  let host = ''
  try {
    host = new URL(trimmed).host.toLowerCase()
  }
  catch {
    host = ''
  }

  if (host.endsWith('anthropic.com'))
    return 'anthropic-messages'
  if (host.endsWith('googleapis.com'))
    return 'gemini'

  if (normalizedModel.startsWith('claude'))
    return 'anthropic-messages'
  if (normalizedModel.startsWith('gemini') || normalizedModel.startsWith('models/gemini'))
    return 'gemini'

  return 'openai-chat'
}

export function resolveProtocol(protocol: AiProtocol | undefined, endpoint: string, model: string): ResolvedAiProtocol {
  return !protocol || protocol === 'auto' ? detectProtocol(endpoint, model) : protocol
}

export function getProtocolLabel(protocol: AiProtocol | undefined) {
  return protocolOptions.find(option => option.value === (protocol ?? 'auto'))?.label ?? '自动识别'
}
