import { describe, expect, it } from 'vitest'
import { getTranslationTarget, normalizeTranslationEngines, translateWithEngines } from './translationEngines'
import type { TranslationEngineConfig } from './types'

function requestUrl(input: RequestInfo | URL) {
  return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
}

function engine(value: Partial<TranslationEngineConfig>): TranslationEngineConfig {
  return {
    id: 'engine',
    label: 'Engine',
    kind: 'microsoft',
    enabled: true,
    priority: 1,
    apiKey: 'subscription-key',
    region: 'eastasia',
    acceptedRisk: true,
    updatedAt: 1,
    ...value,
    dailyLimit: value.dailyLimit ?? 0,
  }
}

describe('traditional translation engines', () => {
  it('normalizes persisted engine priority and editable label before dispatch', () => {
    const [normalized] = normalizeTranslationEngines([engine({
      label: '  Web translator  ',
      kind: 'google-web',
      priority: 0,
      acceptedRisk: true,
    })])

    expect(normalized).toMatchObject({
      label: 'Web translator',
      kind: 'google-web',
      priority: 1,
      acceptedRisk: true,
    })
  })

  it('sends Microsoft subscription credentials, region, source language, and translation payload', async () => {
    const requests: Array<{ url: URL, init?: RequestInit }> = []
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: requestUrl(url), init })
      return new Response(JSON.stringify([{ translations: [{ text: '你好，世界' }] }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const result = await translateWithEngines([
      engine({ id: 'microsoft-f0', label: 'Microsoft Translator F0' }),
    ], { text: 'Hello, world', direction: 'en-to-zh' }, fetchImpl)

    expect(result).toEqual({
      text: '你好，世界',
      engineId: 'microsoft-f0',
      engineLabel: 'Microsoft Translator F0',
    })
    expect(requests).toHaveLength(1)
    expect(requests[0].url.origin + requests[0].url.pathname)
      .toBe('https://api.cognitive.microsofttranslator.com/translate')
    expect(Object.fromEntries(requests[0].url.searchParams)).toMatchObject({
      'api-version': '3.0',
      'from': 'en',
      'to': 'zh-Hans',
    })
    expect(requests[0].init).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Ocp-Apim-Subscription-Key': 'subscription-key',
        'Ocp-Apim-Subscription-Region': 'eastasia',
      },
    })
    expect(JSON.parse(requests[0].init?.body as string)).toEqual([{ Text: 'Hello, world' }])
  })

  it('encodes Google Web query text and resolves automatic CJK translation to English', async () => {
    let requestedUrl: URL | undefined
    const fetchImpl = async (url: RequestInfo | URL) => {
      requestedUrl = requestUrl(url)
      return new Response(JSON.stringify([[['Hello & welcome']]]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const result = await translateWithEngines([
      engine({
        id: 'google-web',
        label: 'Google Translate Web',
        kind: 'google-web',
        apiKey: '',
        acceptedRisk: true,
      }),
    ], { text: '你好 & 欢迎', direction: 'auto' }, fetchImpl)

    expect(result.text).toBe('Hello & welcome')
    expect(requestedUrl).toBeDefined()
    expect(requestedUrl!.origin + requestedUrl!.pathname)
      .toBe('https://translate.googleapis.com/translate_a/single')
    expect(Object.fromEntries(requestedUrl?.searchParams ?? [])).toMatchObject({
      client: 'gtx',
      sl: 'auto',
      tl: 'en',
      dt: 't',
      q: '你好 & 欢迎',
    })
    expect(requestedUrl?.href).toContain('q=%E4%BD%A0%E5%A5%BD+%26+%E6%AC%A2%E8%BF%8E')
  })

  it('tries enabled engines by priority and falls back after the preferred engine fails', async () => {
    const requestedHosts: string[] = []
    const fetchImpl = async (url: RequestInfo | URL) => {
      const requestedUrl = requestUrl(url)
      requestedHosts.push(requestedUrl.host)
      if (requestedUrl.host === 'api.cognitive.microsofttranslator.com')
        return new Response('unavailable', { status: 503 })
      return new Response(JSON.stringify([[['备用译文']]]), { status: 200 })
    }

    const result = await translateWithEngines([
      engine({ id: 'disabled', enabled: false, priority: 0 }),
      engine({ id: 'microsoft-first', priority: 1 }),
      engine({
        id: 'google-fallback',
        kind: 'google-web',
        apiKey: '',
        acceptedRisk: true,
        priority: 2,
      }),
    ], { text: 'fallback', direction: 'en-to-zh' }, fetchImpl)

    expect(result).toEqual({
      text: '备用译文',
      engineId: 'google-fallback',
      engineLabel: 'Engine',
    })
    expect(requestedHosts).toEqual([
      'api.cognitive.microsofttranslator.com',
      'translate.googleapis.com',
    ])
  })

  it('reports the observable unavailable-engine error when nothing is enabled', async () => {
    await expect(translateWithEngines([], { text: 'hello', direction: 'en-to-zh' }))
      .rejects.toThrow('没有启用可用的翻译引擎。')
  })

  it('uses engine-specific Chinese target tags', () => {
    expect(getTranslationTarget('en-to-zh', 'microsoft', 'hello')).toBe('zh-Hans')
    expect(getTranslationTarget('en-to-zh', 'google-web', 'hello')).toBe('zh-CN')
  })
})
