/**
 * Text shaping shared by the worker-side runner and the scene helpers.
 *
 * The runner needs the fence and thinking strippers to report a readable connection test;
 * the scenes need them to turn one assistant turn into a translation, an answer or JSON.
 */

export function stripThinkingText(value: string) {
  return value
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/<thinking>[\s\S]*$/gi, '')
    .trim()
}

export function stripMarkdownFence(value: string) {
  const trimmed = value.trim()
  const fenceStart = trimmed.indexOf('```')
  const fenceEnd = fenceStart >= 0 ? trimmed.indexOf('```', fenceStart + 3) : -1
  if (fenceStart === 0 && fenceEnd > fenceStart)
    return trimmed.slice(fenceStart + 3, fenceEnd).replace(/^[a-z]+\s*/i, '').trim()

  return trimmed
}

export function parseJsonContent<T>(content: string): T {
  const cleaned = stripThinkingText(content)
  const fenceStart = cleaned.indexOf('```')
  const fenceEnd = fenceStart >= 0 ? cleaned.indexOf('```', fenceStart + 3) : -1
  const fenced = fenceStart >= 0 && fenceEnd > fenceStart
    ? cleaned.slice(fenceStart + 3, fenceEnd).replace(/^json\s*/i, '')
    : cleaned

  try {
    return JSON.parse(fenced.trim()) as T
  }
  catch {
    const start = fenced.indexOf('{')
    const end = fenced.lastIndexOf('}')
    if (start >= 0 && end > start)
      return JSON.parse(fenced.slice(start, end + 1).trim()) as T

    throw new Error('AI response JSON parse failed')
  }
}

export function normalizeTranslationText(value: string) {
  const content = stripMarkdownFence(stripThinkingText(value))
  if (!content)
    return ''

  const partialJsonTranslation = content.match(/"translation"\s*:\s*"((?:\\.|[^"\\])*)/)
  if (partialJsonTranslation) {
    try {
      return (JSON.parse(`"${partialJsonTranslation[1]}"`) as string).trim()
    }
    catch {
      return partialJsonTranslation[1].trim()
    }
  }

  try {
    const parsed = JSON.parse(content) as { translation?: string }
    if (parsed?.translation)
      return parsed.translation.trim()
  }
  catch {}

  return content.replace(/^(译文|翻译|translation)\s*[:：]\s*/i, '').trim()
}

export function normalizeMarkdownAnswerText(value: string) {
  const content = stripThinkingText(value).trim()
  if (!content)
    return ''

  try {
    const parsed = JSON.parse(content) as { answer?: unknown, content?: unknown, text?: unknown }
    const answer = [parsed.answer, parsed.content, parsed.text].find(item => typeof item === 'string')
    if (typeof answer === 'string')
      return answer.trim()
  }
  catch {}

  return content.replace(/^(回答|answer)\s*[:：]\s*/i, '').trim()
}
