import { isChineseText } from './languageDetection'
import { protectTerms, restoreTerms } from './termProtection'
import type { TranslationDirection, TranslationEngineConfig, TranslationEngineKind } from './types'

export interface TranslationRequest {
  text: string
  direction: TranslationDirection
}

export interface TranslationResult {
  text: string
  engineId: string
  engineLabel: string
}

type FetchLike = typeof fetch

/** No provider should hold a slot longer than this; none of them stream. */
const engineTimeoutMs = 20_000

export function getTranslationTarget(direction: TranslationDirection, kind: TranslationEngineKind, text: string) {
  // Under `auto`, only Chinese translates out to English. Japanese and Korean carry Han
  // characters too, and a bare ideograph test read them as Chinese \u2014 which sent a reader
  // who wanted a Japanese page in Chinese an English translation instead.
  const target = direction === 'zh-to-en' || (direction === 'auto' && isChineseText(text)) ? 'en' : 'zh'
  if (kind === 'microsoft' || kind === 'bing-web')
    return target === 'zh' ? 'zh-Hans' : target
  if (kind === 'chrome-ai')
    return target === 'zh' ? 'zh' : target
  return target === 'zh' ? 'zh-CN' : target
}

let bingAuthCache: { key: string, token: string, ig: string, iid: string, expiresAt: number } | undefined

function toError(response: Response, label: string) {
  return new Error(`${label} 请求失败：${response.status} ${response.statusText}`.trim())
}

async function translateMicrosoft(engine: TranslationEngineConfig, request: TranslationRequest, fetchImpl: FetchLike) {
  const key = engine.apiKey.trim()
  const region = engine.region.trim()
  if (!key || !region)
    throw new Error('Microsoft Translator 需要订阅 Key 和 Region。')

  const target = getTranslationTarget(request.direction, 'microsoft', request.text)
  const url = new URL('https://api.cognitive.microsofttranslator.com/translate')
  url.searchParams.set('api-version', '3.0')
  url.searchParams.set('to', target)
  // Source stays unset on purpose. `en-to-zh` used to assert `from=en`, which broke the
  // moment the page was Japanese or Korean rather than English — the engine was told a
  // source language the text did not have. Engines detect this better than we can, per
  // request rather than per page, and it costs nothing.

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Ocp-Apim-Subscription-Key': key,
      'Ocp-Apim-Subscription-Region': region,
    },
    body: JSON.stringify([{ Text: request.text }]),
    signal: AbortSignal.timeout(engineTimeoutMs),
  })
  if (!response.ok)
    throw toError(response, engine.label)

  const data = await response.json() as Array<{ translations?: Array<{ text?: string }> }>
  const text = data[0]?.translations?.[0]?.text?.trim()
  if (!text)
    throw new Error(`${engine.label} 返回了空译文。`)
  return text
}

async function translateGoogleWeb(engine: TranslationEngineConfig, request: TranslationRequest, fetchImpl: FetchLike) {
  const target = getTranslationTarget(request.direction, 'google-web', request.text)
  const url = new URL('https://translate.googleapis.com/translate_a/single')
  url.searchParams.set('client', 'gtx')
  url.searchParams.set('sl', 'auto')
  url.searchParams.set('tl', target)
  url.searchParams.set('dt', 't')
  url.searchParams.set('q', request.text)

  const response = await fetchImpl(url, { signal: AbortSignal.timeout(engineTimeoutMs) })
  if (!response.ok)
    throw toError(response, engine.label)

  const data = await response.json() as Array<Array<[string]>>
  const text = data[0]?.map(part => part[0]).join('').trim()
  if (!text)
    throw new Error(`${engine.label} 返回了空译文。`)
  return text
}

async function getBingAuth(fetchImpl: FetchLike) {
  if (bingAuthCache && Date.now() < bingAuthCache.expiresAt)
    return bingAuthCache

  const initRes = await fetchImpl('https://cn.bing.com/translator', {
    headers: {
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(engineTimeoutMs),
  })
  if (!initRes.ok)
    throw toError(initRes, 'Bing Translator 鉴权')

  const html = await initRes.text()
  const tokenMatch = html.match(/var params_AbusePreventionHelper\s*=\s*(\[[^;]+\]);/)
  if (!tokenMatch)
    throw new Error('未能在 Bing 页面解析出校验参数。')

  const [key, token] = JSON.parse(tokenMatch[1]) as [number, string]
  const igMatch = html.match(/IG:"([^"]+)"/)
  const iidMatch = html.match(/data-iid="([^"]+)"/)

  bingAuthCache = {
    key: String(key),
    token,
    ig: igMatch?.[1] || '',
    iid: iidMatch?.[1] || 'translator.5028',
    expiresAt: Date.now() + 10 * 60 * 1000,
  }
  return bingAuthCache
}

async function translateBingWeb(engine: TranslationEngineConfig, request: TranslationRequest, fetchImpl: FetchLike) {
  const target = getTranslationTarget(request.direction, 'bing-web', request.text)
  const auth = await getBingAuth(fetchImpl)

  const form = new URLSearchParams()
  form.set('text', request.text)
  form.set('fromLang', 'auto-detect')
  form.set('to', target)
  form.set('token', auth.token)
  form.set('key', auth.key)
  form.set('tryFetchingGenderDebiasedTranslations', 'true')

  const url = `https://cn.bing.com/ttranslatev3?isVertical=1&IG=${encodeURIComponent(auth.ig)}&IID=${encodeURIComponent(auth.iid)}`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    },
    body: form.toString(),
    signal: AbortSignal.timeout(engineTimeoutMs),
  })
  if (!response.ok)
    throw toError(response, engine.label)

  const data = await response.json() as Array<{ translations?: Array<{ text?: string }> }>
  const text = data[0]?.translations?.[0]?.text?.trim()
  if (!text) {
    bingAuthCache = undefined // clear stale auth
    throw new Error(`${engine.label} 返回了空译文。`)
  }
  return text
}

interface ChromeTranslationSession {
  translate: (text: string) => Promise<string>
  destroy?: () => void
}

interface ChromeTranslationAPI {
  canTranslate?: (options: { sourceLanguage: string, targetLanguage: string }) => Promise<string>
  createTranslator?: (options: { sourceLanguage: string, targetLanguage: string }) => Promise<ChromeTranslationSession>
}

interface ChromeAIAvailability {
  availability: (options: { sourceLanguage: string, targetLanguage: string }) => Promise<string>
  create: (options: { sourceLanguage: string, targetLanguage: string }) => Promise<ChromeTranslationSession>
}

async function translateChromeAI(engine: TranslationEngineConfig, request: TranslationRequest) {
  const globalScope = globalThis as unknown as {
    translation?: ChromeTranslationAPI
    Translator?: ChromeAIAvailability
  }

  const target = getTranslationTarget(request.direction, 'chrome-ai', request.text)
  const source = target === 'en' ? 'zh' : 'en'

  // Pattern 1: modern standard `translation.createTranslator`
  if (globalScope.translation?.createTranslator) {
    const status = await globalScope.translation.canTranslate?.({ sourceLanguage: source, targetLanguage: target })
    if (status === 'no')
      throw new Error(`Chrome AI 不支持当前语言方向 (${source} -> ${target})。`)
    const session = await globalScope.translation.createTranslator({ sourceLanguage: source, targetLanguage: target })
    try {
      return await session.translate(request.text)
    }
    finally {
      session.destroy?.()
    }
  }

  // Pattern 2: `window.Translator`
  if (globalScope.Translator?.create) {
    const status = await globalScope.Translator.availability({ sourceLanguage: source, targetLanguage: target })
    if (status === 'no')
      throw new Error(`Chrome Translator 不支持当前语言方向 (${source} -> ${target})。`)
    const session = await globalScope.Translator.create({ sourceLanguage: source, targetLanguage: target })
    try {
      return await session.translate(request.text)
    }
    finally {
      session.destroy?.()
    }
  }

  throw new Error('当前浏览器环境未提供 Chrome 内置 AI (window.translation / window.Translator) 接口。需 Chrome 131+ 并开启 Built-in AI 试验标志。')
}

export function defaultEngineLabel(kind: TranslationEngineKind): string {
  switch (kind) {
    case 'microsoft':
      return 'Microsoft Translator'
    case 'google-web':
      return 'Google Translate Web'
    case 'bing-web':
      return 'Bing 网页翻译（免 Key）'
    case 'chrome-ai':
      return 'Chrome 内置 AI 翻译'
  }
}

export function normalizeTranslationEngines(value?: Partial<TranslationEngineConfig>[]): TranslationEngineConfig[] {
  return (value ?? []).map((engine, index): TranslationEngineConfig => {
    const kind: TranslationEngineKind = engine.kind === 'microsoft' || engine.kind === 'bing-web' || engine.kind === 'chrome-ai'
      ? engine.kind
      : 'google-web'
    return {
      id: engine.id || `translation-engine-${index + 1}`,
      label: engine.label?.trim() || defaultEngineLabel(kind),
      kind,
      enabled: engine.enabled ?? true,
      priority: Number.isFinite(engine.priority) ? Math.max(1, Number(engine.priority)) : index + 1,
      apiKey: engine.apiKey ?? '',
      region: engine.region ?? '',
      acceptedRisk: kind === 'google-web' || kind === 'bing-web' ? Boolean(engine.acceptedRisk) : true,
      updatedAt: Number.isFinite(engine.updatedAt) ? Number(engine.updatedAt) : 0,
      dailyLimit: Number.isFinite(engine.dailyLimit) ? Math.max(0, Math.floor(Number(engine.dailyLimit))) : 0,
    }
  })
}

export async function translateWithEngines(
  engines: TranslationEngineConfig[],
  request: TranslationRequest,
  fetchImpl: FetchLike = fetch,
  beforeEngine?: (engine: TranslationEngineConfig) => Promise<void>,
): Promise<TranslationResult> {
  const { text: protectedText, terms: protectedTerms } = protectTerms(request.text)
  const protectedRequest = { ...request, text: protectedText }
  const candidates = normalizeTranslationEngines(engines)
    .filter(engine => engine.enabled && (
      (engine.kind !== 'google-web' && engine.kind !== 'bing-web') || engine.acceptedRisk
    ))
    .sort((a, b) => a.priority - b.priority)
  if (!candidates.length)
    throw new Error('没有启用可用的翻译引擎。')

  const failures: string[] = []
  for (const engine of candidates) {
    try {
      await beforeEngine?.(engine)
      let translated: string
      if (engine.kind === 'microsoft')
        translated = await translateMicrosoft(engine, protectedRequest, fetchImpl)
      else if (engine.kind === 'bing-web')
        translated = await translateBingWeb(engine, protectedRequest, fetchImpl)
      else if (engine.kind === 'chrome-ai')
        translated = await translateChromeAI(engine, protectedRequest)
      else
        translated = await translateGoogleWeb(engine, protectedRequest, fetchImpl)
      return { text: restoreTerms(translated, protectedTerms), engineId: engine.id, engineLabel: engine.label }
    }
    catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }

  throw new Error(failures.join('；') || '翻译引擎未返回结果。')
}
