import { isProductVocabularyCandidate } from './vocabularyRecords'
import type { SelectionTranslation, VocabularyCandidate } from './types'

const commonEnglishWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'do',
  'for',
  'from',
  'get',
  'go',
  'has',
  'have',
  'he',
  'her',
  'his',
  'i',
  'in',
  'is',
  'it',
  'its',
  'me',
  'my',
  'not',
  'of',
  'on',
  'or',
  'our',
  'so',
  'that',
  'the',
  'their',
  'this',
  'to',
  'was',
  'we',
  'will',
  'with',
  'you',
  'your',
])

export function hasCjkText(text: string) {
  return /[\u3400-\u9FFF]/.test(text)
}

export function countCjkCharacters(text: string) {
  return Array.from(text).filter(char => /[\u3400-\u9FFF]/.test(char)).length
}

export function isAmbiguousSingleCharacterTerm(text: string) {
  const normalized = text.replace(/\s+/g, '').trim()
  return normalized.length === 1 && hasCjkText(normalized)
}

export function isConciseEnglishReplacement(original: string, replacement: string) {
  const normalized = replacement.replace(/\s+/g, ' ').trim()
  if (!normalized || hasCjkText(normalized))
    return false

  if (/Selected on page|[。！？；]/i.test(normalized))
    return false

  const maxLength = Math.max(32, countCjkCharacters(original) * 8)
  const wordCount = normalized.split(/[\s/]+/).filter(Boolean).length
  return normalized.length <= maxLength && wordCount <= 6
}

function normalizeToken(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function hasTechnicalShape(text: string) {
  const normalized = normalizeToken(text)
  return /[A-Z][a-z]+[A-Z]/.test(normalized)
    || /^[A-Z][A-Z0-9-]+$/.test(normalized)
    || /[_./:-]/.test(normalized)
    || /\d/.test(normalized)
    || /\b(?:api|cli|sdk|http|https|json|yaml|sql|ui|ux|css|html|dom|url|uri|jwt|oauth|cdn|dns|tls|ssl|llm|gpu|cpu|k8s|rpc|grpc|ide|ci|cd)\b/i.test(normalized)
}

export function isLikelyTechnicalSelectionTerm(text: string) {
  const normalized = normalizeToken(text)
  if (!normalized)
    return false

  if (hasCjkText(normalized))
    return countCjkCharacters(normalized) >= 3 || /[\w./-]/.test(normalized)

  if (commonEnglishWords.has(normalized.toLowerCase()))
    return false

  const words = normalized.split(/\s+/).filter(Boolean)
  return hasTechnicalShape(normalized)
    || words.length >= 2
    || normalized.length >= 8
}

export function isLowValueShortChineseCandidate(candidate: Pick<VocabularyCandidate, 'difficulty' | 'original'>) {
  return candidate.difficulty <= 2
    && hasCjkText(candidate.original)
    && countCjkCharacters(candidate.original) <= 3
}

export function canAutoReplaceCandidate(candidate: VocabularyCandidate) {
  if (isProductVocabularyCandidate(candidate))
    return candidate.original.trim() === candidate.replacement.trim()

  if (isAmbiguousSingleCharacterTerm(candidate.original))
    return false

  return hasCjkText(candidate.original) && isConciseEnglishReplacement(candidate.original, candidate.replacement)
}

export function shouldRecordSelectionCandidate(candidate: VocabularyCandidate, selectedText: string) {
  if (isProductVocabularyCandidate(candidate))
    return candidate.original.trim() === candidate.replacement.trim()

  const original = normalizeToken(candidate.original)
  const selected = normalizeToken(selectedText)
  if (!original || !selected)
    return false

  if (isAmbiguousSingleCharacterTerm(original))
    return false

  if (hasCjkText(original)) {
    return countCjkCharacters(original) >= 4
      && isConciseEnglishReplacement(original, candidate.replacement)
  }

  return isLikelyTechnicalSelectionTerm(original)
}

export function createManualCandidate(translation: SelectionTranslation): VocabularyCandidate | undefined {
  const candidate = translation.candidate ?? {
    original: translation.original,
    replacement: translation.translation,
    meaning: translation.explanation,
    example: `Selected on page: ${translation.original}`,
    tags: ['manual'],
    difficulty: 2,
  }

  return shouldRecordSelectionCandidate(candidate, translation.original)
    ? candidate
    : undefined
}

export function createTechnicalCandidate(translation: SelectionTranslation, explanation: string): VocabularyCandidate | undefined {
  const candidate = translation.candidate ?? {
    original: translation.original,
    replacement: translation.translation,
    meaning: explanation || translation.explanation,
    example: `Selected on page: ${translation.original}`,
    tags: ['technical', 'manual'],
    difficulty: 2,
  }

  return shouldRecordSelectionCandidate(candidate, translation.original)
    ? candidate
    : undefined
}

export function createCandidateFromTerm(translation: SelectionTranslation, term: { term: string, explanation: string }): VocabularyCandidate | undefined {
  const isChineseTerm = hasCjkText(term.term)
  const replacement = isChineseTerm ? translation.translation : term.term
  const candidate: VocabularyCandidate = {
    original: term.term,
    replacement,
    meaning: term.explanation,
    example: `Selected on page: ${translation.original}`,
    tags: ['technical', 'selection'],
    difficulty: 2,
  }

  return shouldRecordSelectionCandidate(candidate, translation.original)
    ? candidate
    : undefined
}
