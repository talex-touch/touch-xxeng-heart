import { describe, expect, it } from 'vitest'
import {
  NEXUS_AUDIT_METADATA,
  NEXUS_INVOKE_PATH,
  NEXUS_PROTOCOL_ID,
  buildNexusInvokeRequest,
  buildNexusTranslateEnvelope,
  nexusAdapter,
  readNexusBilling,
  readNexusInvocation,
  readNexusModels,
  readNexusText,
  readNexusUsage,
} from './nexus'
import type { AiChatMessage } from './protocol'
import { getProtocolAdapter, protocolOptions } from './index'

/**
 * The Nexus adapter speaks a capability envelope, not an OpenAI route.
 *
 * What matters here: the route stays relative so only the token-carrying worker fetch can
 * resolve it, the envelope names the right capability, inline images become attachments and
 * nothing else does, the invoke reply is decoded fail-closed, and the adapter never streams.
 */

const adapter = getProtocolAdapter(NEXUS_PROTOCOL_ID)

const chatMessages: AiChatMessage[] = [
  { role: 'system', content: '你是 Lexi。' },
  { role: 'user', content: '把这句话翻译一下。' },
]

describe('nexus protocol registration', () => {
  it('registers the protocol under nexus-intelligence', () => {
    expect(adapter).toBe(nexusAdapter)
    expect(adapter.id).toBe('nexus-intelligence')
    expect(protocolOptions.some(option => option.value === 'nexus-intelligence')).toBe(true)
  })

  it('resolves a relative canonical route whatever endpoint is configured', () => {
    expect(adapter.resolveChatUrl('https://evil.example/v1')).toBe(NEXUS_INVOKE_PATH)
    expect(adapter.resolveChatUrl('')).toBe(NEXUS_INVOKE_PATH)
    expect(adapter.resolveChatUrl('https://evil.example/v1')).not.toMatch(/^https?:/)
  })
})

describe('nexus chat envelope', () => {
  it('builds the exact invoke plan and never streams', () => {
    const plan = adapter.buildChatRequest({
      endpoint: 'https://tuff.tagzxia.com',
      apiKey: '',
      model: 'auto',
      messages: chatMessages,
      stream: true,
    })

    expect(plan).toEqual({
      url: '/api/v1/intelligence/invoke',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'text.chat',
        payload: {
          messages: [
            { role: 'system', content: '你是 Lexi。' },
            { role: 'user', content: '把这句话翻译一下。' },
          ],
        },
        options: { stream: false, metadata: { ...NEXUS_AUDIT_METADATA } },
      }),
    })
  })

  it('carries a caller key only when one is configured', () => {
    const plan = adapter.buildChatRequest({
      endpoint: 'https://tuff.tagzxia.com',
      apiKey: 'Bearer sk-nexus',
      model: 'auto',
      messages: chatMessages,
      stream: false,
    })

    expect(plan.headers.authorization).toBe('Bearer sk-nexus')
  })

  it('moves a data-URL image into attachments and refuses anything else', () => {
    const plan = adapter.buildChatRequest({
      endpoint: 'https://tuff.tagzxia.com',
      apiKey: '',
      model: 'auto',
      stream: false,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '看看这张图' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      }],
    })

    const body = JSON.parse(plan.body as string)
    expect(body.payload.messages).toEqual([{
      role: 'user',
      content: '看看这张图',
      attachments: [{ type: 'image', dataUrl: 'data:image/png;base64,AAAA' }],
    }])

    expect(() => adapter.buildChatRequest({
      endpoint: 'https://tuff.tagzxia.com',
      apiKey: '',
      model: 'auto',
      stream: false,
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://evil.example/a.png' } }] }],
    })).toThrow()
  })

  it('refuses an empty message list rather than sending an empty envelope', () => {
    expect(() => adapter.buildChatRequest({
      endpoint: 'https://tuff.tagzxia.com',
      apiKey: '',
      model: 'auto',
      messages: [],
      stream: false,
    })).toThrow()
  })
})

describe('nexus translate envelope', () => {
  it('names the translate capability and pins the target language', () => {
    const envelope = buildNexusTranslateEnvelope({ text: '  optimistic update  ', targetLang: 'zh' })

    expect(envelope).toEqual({
      capabilityId: 'text.translate',
      payload: { text: 'optimistic update', targetLang: 'zh' },
      options: { stream: false, metadata: { ...NEXUS_AUDIT_METADATA } },
    })

    const pinned = buildNexusTranslateEnvelope({ text: '乐观更新', targetLang: 'en', sourceLang: 'zh' })
    expect(pinned.payload).toEqual({ text: '乐观更新', targetLang: 'en', sourceLang: 'zh' })
  })

  it('refuses an envelope without text or target language', () => {
    expect(() => buildNexusTranslateEnvelope({ text: '   ', targetLang: 'zh' })).toThrow()
    expect(() => buildNexusTranslateEnvelope({ text: 'hi', targetLang: '' })).toThrow()
  })

  it('builds the same relative invoke route for translate requests', () => {
    const plan = buildNexusInvokeRequest(buildNexusTranslateEnvelope({ text: 'hi', targetLang: 'zh' }))

    expect(plan.url).toBe('/api/v1/intelligence/invoke')
    expect(plan.method).toBe('POST')
  })
})

describe('nexus invoke decoding', () => {
  const payload = {
    invocation: {
      capabilityId: 'text.translate',
      result: '乐观更新',
      usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
      model: 'auto',
      provider: 'deepseek',
      traceId: 'trace-1',
      latency: 1200,
      metadata: {
        fallbackCount: 1,
        retryCount: 0,
        attemptedProviders: ['deepseek', 'openai'],
        billing: {
          chargedCredits: 5,
          reservedCredits: 8,
          unit: 'token',
          quantity: 16,
          reserveId: 'reserve-1',
          billable: true,
          reason: 'settled',
        },
      },
    },
  }

  it('reads text, usage and the credit settlement out of the envelope', () => {
    expect(readNexusText(payload)).toBe('乐观更新')
    expect(readNexusUsage(payload)).toEqual({ promptTokens: 12, completionTokens: 4, totalTokens: 16 })
    expect(readNexusBilling(payload)).toMatchObject({
      chargedCredits: 5,
      reservedCredits: 8,
      unit: 'token',
      billable: true,
    })
    expect(adapter.readText(payload)).toBe('乐观更新')
    expect(adapter.readUsage(payload)).toEqual({ promptTokens: 12, completionTokens: 4, totalTokens: 16 })
    expect(readNexusInvocation(payload)?.attemptedProviders).toEqual(['deepseek', 'openai'])
  })

  it('decodes a bare invocation object but fails closed on anything else', () => {
    const bare = { result: 'ok', usage: { totalTokens: 3 } }
    expect(readNexusText(bare)).toBe('ok')
    expect(readNexusText({ invocation: { usage: {} } })).toBe('')
    expect(readNexusText(null)).toBe('')
    expect(readNexusText('not-json')).toBe('')
    expect(readNexusUsage({ invocation: {} })).toBeUndefined()
    expect(readNexusBilling({ invocation: { result: 'ok' } })).toBeUndefined()
  })

  it('never streams deltas', () => {
    expect(adapter.readStreamDelta({ event: 'message', data: '{"delta":"x"}' })).toBe('')
  })

  it('offers only the local auto model and never fetches a catalogue', () => {
    expect(adapter.readModels({ data: [{ id: 'gpt-5' }] })).toEqual([{ id: 'auto', label: 'Nexus 自动路由' }])
    expect(readNexusModels()).toEqual([{ id: 'auto', label: 'Nexus 自动路由' }])
    expect(() => adapter.buildModelsRequest({ endpoint: 'https://tuff.tagzxia.com', apiKey: '' })).toThrow()
  })
})
