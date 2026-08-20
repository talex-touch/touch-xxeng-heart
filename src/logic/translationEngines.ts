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

function hasCjk(text: string) {
  return /[\u3400-\u9FFF]/.test(text)
}

export function getTranslationTarget(direction: TranslationDirection, kind: TranslationEngineKind, text: string) {
  const target = direction === 'zh-to-en' || (direction === 'auto' && hasCjk(text)) ? 'en' : 'zh'
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
  if (request.direction !== 'auto')
    url.searchParams.set('from', request.direction === 'zh-to-en' ? 'zh-Hans' : 'en')

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Ocp-Apim-Subscription-Key': key,
      'Ocp-Apim-Subscription-Region': region,
    },
    body: JSON.stringify([{ Text: request.text }]),
    signal: undefined,
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
  url.searchParams.set('sl', request.direction === 'auto' ? 'auto' : request.direction === 'zh-to-en' ? 'zh-CN' : 'en')
  url.searchParams.set('tl', target)
  url.searchParams.set('dt', 't')
  url.searchParams.set('q', request.text)

  const response = await fetchImpl(url)
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
  const protectedTerms: string[] = []
  const protectedText = request.text.replace(/`[^`]+`|https?:\/\/\S+|\b(?:[A-Z]{2,}|[A-Za-z]*[a-z][A-Z][A-Za-z0-9]*)\b/g, (term) => {
    const token = `__LEXI_TERM_${protectedTerms.length}__`
    protectedTerms.push(term)
    return token
  })
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
      const text = protectedTerms.reduce((value, term, index) => value.replaceAll(`__LEXI_TERM_${index}__`, term), translated)
      return { text, engineId: engine.id, engineLabel: engine.label }
    }
    catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }

  throw new Error(failures.join('；') || '翻译引擎未返回结果。')
}
