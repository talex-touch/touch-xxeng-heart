import { describe, expect, it } from 'vitest'
import { createSseParser } from './sse'
import type { AiChatMessage, SseEvent } from './protocol'
import { detectProtocol, getProtocolAdapter } from './index'

const messages: AiChatMessage[] = [
  { role: 'system', content: '你是 Lexi。' },
  { role: 'user', content: [
    { type: 'text', text: '这张图是什么？' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
  ] },
]

function collect(chunks: string[], adapter = getProtocolAdapter('openai-chat')) {
  const events: SseEvent[] = []
  const parser = createSseParser(event => events.push(event))
  for (const chunk of chunks)
    parser.push(chunk)

  parser.end()
  return events.map(event => adapter.readStreamDelta(event)).join('')
}

describe('protocol detection', () => {
  it('trusts an explicit route over the model name', () => {
    expect(detectProtocol('https://gateway.example.com/v1/chat/completions', 'claude-sonnet-4-5')).toBe('openai-chat')
    expect(detectProtocol('https://gateway.example.com/v1/responses', 'gpt-4.1-mini')).toBe('openai-responses')
  })

  it('falls back to host and model name for bare base URLs', () => {
    expect(detectProtocol('https://api.anthropic.com', '')).toBe('anthropic-messages')
    expect(detectProtocol('https://generativelanguage.googleapis.com', '')).toBe('gemini')
    expect(detectProtocol('https://router.example.com', 'claude-sonnet-4-5')).toBe('anthropic-messages')
    expect(detectProtocol('https://router.example.com', 'gemini-2.5-pro')).toBe('gemini')
    expect(detectProtocol('https://router.example.com', 'gpt-5.6-luna')).toBe('openai-chat')
  })
})

describe('openai chat adapter', () => {
  const adapter = getProtocolAdapter('openai-chat')

  it('keeps a configured base, versioned base and full route on one URL', () => {
    expect(adapter.resolveChatUrl('https://api.example.com')).toBe('https://api.example.com/v1/chat/completions')
    expect(adapter.resolveChatUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1/chat/completions')
    expect(adapter.resolveChatUrl('https://api.example.com/v1/chat/completions')).toBe('https://api.example.com/v1/chat/completions')
  })

  it('passes messages through untouched', () => {
    const plan = adapter.buildChatRequest({ endpoint: 'https://api.example.com', apiKey: 'Bearer sk-1', model: 'm', messages, stream: true, temperature: 0.2 })
    const body = JSON.parse(plan.body ?? '{}')

    expect(plan.headers.authorization).toBe('Bearer sk-1')
    expect(body.messages).toEqual(messages)
    expect(body.temperature).toBe(0.2)
  })

  it('reads deltas out of a chat stream', () => {
    expect(collect([
      'data: {"choices":[{"delta":{"content":"乐观"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"更新"}}]}\n\ndata: [DONE]\n\n',
    ])).toBe('乐观更新')
  })
})

describe('openai responses adapter', () => {
  const adapter = getProtocolAdapter('openai-responses')

  it('moves the system prompt into instructions and types the input parts', () => {
    const plan = adapter.buildChatRequest({ endpoint: 'https://api.openai.com/v1', apiKey: 'sk-1', model: 'gpt-5', messages, stream: false })
    const body = JSON.parse(plan.body ?? '{}')

    expect(plan.url).toBe('https://api.openai.com/v1/responses')
    expect(body.instructions).toBe('你是 Lexi。')
    expect(body.input).toEqual([{
      role: 'user',
      content: [
        { type: 'input_text', text: '这张图是什么？' },
        { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
      ],
    }])
  })

  it('reads text from output items and from the convenience field', () => {
    expect(adapter.readText({ output: [
      { type: 'reasoning' },
      { type: 'message', content: [{ type: 'output_text', text: '你好' }] },
    ] })).toBe('你好')
    expect(adapter.readText({ output_text: '你好' })).toBe('你好')
    expect(adapter.readUsage({ usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } })).toEqual({
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
    })
  })

  it('counts only delta events so a completed snapshot is not appended twice', () => {
    expect(collect([
      'event: response.output_text.delta\ndata: {"delta":"乐观"}\n\n',
      'event: response.output_text.delta\ndata: {"delta":"更新"}\n\n',
      'event: response.completed\ndata: {"response":{"output_text":"乐观更新"}}\n\n',
    ], adapter)).toBe('乐观更新')
  })
})

describe('anthropic adapter', () => {
  const adapter = getProtocolAdapter('anthropic-messages')

  it('lifts the system prompt out and converts a data URL image', () => {
    const plan = adapter.buildChatRequest({ endpoint: 'https://api.anthropic.com', apiKey: 'sk-ant', model: 'claude-sonnet-4-5', messages, stream: false })
    const body = JSON.parse(plan.body ?? '{}')

    expect(plan.url).toBe('https://api.anthropic.com/v1/messages')
    expect(plan.headers['x-api-key']).toBe('sk-ant')
    expect(body.system).toBe('你是 Lexi。')
    expect(body.max_tokens).toBeGreaterThan(0)
    expect(body.messages[0].content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    })
  })

  it('adds input and output tokens into a total', () => {
    expect(adapter.readUsage({ usage: { input_tokens: 7, output_tokens: 3 } })).toMatchObject({ totalTokens: 10 })
  })

  it('reads content_block_delta events', () => {
    expect(collect([
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"乐观"}}\n\n',
      'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"更新"}}\n\n',
    ], adapter)).toBe('乐观更新')
  })
})

describe('gemini adapter', () => {
  const adapter = getProtocolAdapter('gemini')

  it('puts the model and streaming mode in the path', () => {
    expect(adapter.resolveChatUrl('https://generativelanguage.googleapis.com', { model: 'gemini-2.5-flash' }))
      .toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
    expect(adapter.resolveChatUrl('https://generativelanguage.googleapis.com', { model: 'models/gemini-2.5-flash', stream: true }))
      .toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse')
  })

  it('maps roles and inline image data', () => {
    const plan = adapter.buildChatRequest({ endpoint: 'https://generativelanguage.googleapis.com', apiKey: 'key', model: 'gemini-2.5-flash', messages, stream: false })
    const body = JSON.parse(plan.body ?? '{}')

    expect(plan.headers['x-goog-api-key']).toBe('key')
    expect(body.systemInstruction).toEqual({ parts: [{ text: '你是 Lexi。' }] })
    expect(body.contents[0].role).toBe('user')
    expect(body.contents[0].parts[1]).toEqual({ inline_data: { mime_type: 'image/png', data: 'AAAA' } })
  })

  it('reads candidate parts from the stream', () => {
    expect(collect([
      'data: {"candidates":[{"content":{"parts":[{"text":"乐观"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"更新"}]}}]}\n\n',
    ], adapter)).toBe('乐观更新')
  })

  it('strips the models/ prefix from the catalogue', () => {
    expect(adapter.readModels({ models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' }] }))
      .toEqual([{ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }])
  })
})

describe('sse parser', () => {
  it('reassembles events split across chunk boundaries', () => {
    expect(collect(['data: {"choices":[{"delta":{"con', 'tent":"乐观更新"}}]}\n\n'])).toBe('乐观更新')
  })

  it('flushes a final event that never got its blank line', () => {
    expect(collect(['data: {"choices":[{"delta":{"content":"乐观更新"}}]}'])).toBe('乐观更新')
  })

  it('ignores comments and malformed payloads instead of throwing', () => {
    expect(collect([': keep-alive\n\ndata: not json\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\n'])).toBe('ok')
  })
})
