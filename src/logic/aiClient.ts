import { findCandidateByText, programmerVocabulary } from './vocabularyBank'
import type { FeatureScene, LexiSettings, SelectionTranslation, VocabularyCandidate } from './types'

interface AiReplacementResponse {
  items?: VocabularyCandidate[]
}

interface AiTranslationResponse {
  translation?: string
  explanation?: string
  candidate?: VocabularyCandidate
}

function getAiConfig(settings: LexiSettings, scene: FeatureScene) {
  const config = settings.ai[scene]
  if (!config.enabled || !config.endpoint.trim())
    return undefined

  return config
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

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      scene,
      ...payload,
    }),
  })

  if (!response.ok)
    throw new Error(`AI request failed: ${response.status}`)

  return await response.json() as T
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
