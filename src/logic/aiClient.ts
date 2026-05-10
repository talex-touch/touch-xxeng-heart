import { findCandidateByText, programmerVocabulary } from './vocabularyBank'
import { recordAiCall } from './analytics'
import type { FeatureScene, LexiSettings, SelectionTranslation, VocabularyCandidate } from './types'

interface AiReplacementResponse {
  items?: VocabularyCandidate[]
}

interface AiTranslationResponse {
  translation?: string
  explanation?: string
  candidate?: VocabularyCandidate
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

function getAiConfig(settings: LexiSettings, scene: FeatureScene) {
  const config = settings.ai[scene]
  if (!config.enabled || !config.endpoint.trim())
    return undefined

  return config
}

function resolveEndpoint(endpoint: string) {
  const trimmed = endpoint.trim().replace(/\/$/, '')
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/v1/chat/completions`
}

function extractJsonObject<T>(value: unknown): T {
  if (typeof value !== 'object' || value == null)
    throw new Error('AI response is not an object')

  const direct = value as T
  const content = (value as OpenAiChatResponse).choices?.[0]?.message?.content
  if (!content)
    return direct

  const fenceStart = content.indexOf('```')
  const fenceEnd = fenceStart >= 0 ? content.indexOf('```', fenceStart + 3) : -1
  const fenced = fenceStart >= 0 && fenceEnd > fenceStart
    ? content.slice(fenceStart + 3, fenceEnd).replace(/^json\s*/i, '')
    : content
  return JSON.parse(fenced.trim()) as T
}

async function postAiJson<T>(
  settings: LexiSettings,
  scene: FeatureScene,
  payload: Record<string, unknown>,
): Promise<T | undefined> {
  const config = getAiConfig(settings, scene)
  if (!config)
    return undefined

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }

  if (config.apiKey)
    headers.authorization = `Bearer ${config.apiKey}`

  const startedAt = performance.now()
  const endpoint = resolveEndpoint(config.endpoint)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'system',
            content: 'You are Lexi. Return only valid compact JSON matching the user requested schema. Do not wrap in markdown unless unavoidable.',
          },
          {
            role: 'user',
            content: JSON.stringify({ scene, ...payload }),
          },
        ],
        temperature: 0.2,
      }),
    })

    const durationMs = Math.round(performance.now() - startedAt)
    const json = await response.json()

    if (!response.ok) {
      await recordAiCall({
        scene,
        endpoint,
        model: config.model,
        ok: false,
        status: response.status,
        error: JSON.stringify(json).slice(0, 240),
        durationMs,
      })
      throw new Error(`AI request failed: ${response.status}`)
    }

    await recordAiCall({
      scene,
      endpoint,
      model: config.model,
      ok: true,
      status: response.status,
      durationMs,
    })

    return extractJsonObject<T>(json)
  }
  catch (error) {
    if (error instanceof Error && !error.message.startsWith('AI request failed')) {
      await recordAiCall({
        scene,
        endpoint,
        model: config.model,
        ok: false,
        error: error.message,
        durationMs: Math.round(performance.now() - startedAt),
      })
    }

    throw error
  }
}

export async function requestReplacementCandidates(
  settings: LexiSettings,
  text: string,
  context: string,
) {
  const data = await postAiJson<AiReplacementResponse>(settings, 'replacement', {
    text,
    context,
    instruction: 'Return rare or technical Chinese terms with English replacements, meanings, examples, tags and difficulty.',
  })

  return data?.items?.filter(item => item.original && item.replacement) ?? []
}

export async function requestSelectionTranslation(
  settings: LexiSettings,
  text: string,
  context: string,
): Promise<SelectionTranslation | undefined> {
  const data = await postAiJson<AiTranslationResponse>(settings, 'selection', {
    text,
    context,
    instruction: 'Translate the selected text and explain the most useful technical English term if any.',
  })

  if (!data?.translation)
    return undefined

  return {
    original: text,
    translation: data.translation,
    explanation: data.explanation || '由已配置 AI 服务生成。',
    source: 'ai',
    candidate: data.candidate,
  }
}

export async function testAiScene(settings: LexiSettings, scene: FeatureScene) {
  if (scene === 'selection') {
    const result = await requestSelectionTranslation(
      settings,
      '上下文配置',
      '这个页面需要根据上下文配置模型并缓存结果。',
    )
    return Boolean(result?.translation)
  }

  const result = await requestReplacementCandidates(
    settings,
    '这个页面需要根据上下文配置模型，并在缓存命中后降低依赖。',
    'Lexi AI scene test',
  )
  return result.length > 0
}

export function localTranslateSelection(text: string): SelectionTranslation {
  const exact = findCandidateByText(text)
  if (exact) {
    return {
      original: text,
      translation: exact.replacement,
      explanation: `${exact.meaning} 示例：${exact.example}`,
      source: 'local',
      candidate: exact,
    }
  }

  const matched = programmerVocabulary.find(item => text.includes(item.original) || text.toLowerCase().includes(item.replacement.toLowerCase()))
  if (matched) {
    return {
      original: text,
      translation: text.replace(matched.original, matched.replacement),
      explanation: `${matched.original} 可理解为 ${matched.replacement}。${matched.meaning}`,
      source: 'local',
      candidate: matched,
    }
  }

  return {
    original: text,
    translation: text,
    explanation: '暂未命中本地术语库。可在选项页为划词翻译配置 AI 后端。',
    source: 'local',
  }
}
