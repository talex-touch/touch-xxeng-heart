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
  return kind === 'microsoft' && target === 'zh' ? 'zh-Hans' : target === 'zh' ? 'zh-CN' : target
}

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

export function normalizeTranslationEngines(value?: Partial<TranslationEngineConfig>[]): TranslationEngineConfig[] {
  return (value ?? []).map((engine, index): TranslationEngineConfig => {
    const kind: TranslationEngineKind = engine.kind === 'microsoft' ? 'microsoft' : 'google-web'
    return {
      id: engine.id || `translation-engine-${index + 1}`,
      label: engine.label?.trim() || (kind === 'microsoft' ? 'Microsoft Translator' : 'Google Translate Web'),
      kind,
      enabled: engine.enabled ?? true,
      priority: Number.isFinite(engine.priority) ? Math.max(1, Number(engine.priority)) : index + 1,
      apiKey: engine.apiKey ?? '',
      region: engine.region ?? '',
      acceptedRisk: kind === 'google-web' ? Boolean(engine.acceptedRisk) : true,
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
    .filter(engine => engine.enabled && (engine.kind !== 'google-web' || engine.acceptedRisk))
    .sort((a, b) => a.priority - b.priority)
  if (!candidates.length)
    throw new Error('没有启用可用的翻译引擎。')

  const failures: string[] = []
  for (const engine of candidates) {
    try {
      await beforeEngine?.(engine)
      const translated = engine.kind === 'microsoft'
        ? await translateMicrosoft(engine, protectedRequest, fetchImpl)
        : await translateGoogleWeb(engine, protectedRequest, fetchImpl)
      return { text: restoreTerms(translated, protectedTerms), engineId: engine.id, engineLabel: engine.label }
    }
    catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }

  throw new Error(failures.join('；') || '翻译引擎未返回结果。')
}
