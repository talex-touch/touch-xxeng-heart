export interface SentenceSegment {
  text: string
  start: number
  end: number
}

const COMMON_ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'vs',
  'etc',
  'eg',
  'ie',
  'al',
  'approx',
  'app',
  'dept',
  'est',
  'fig',
  'figs',
  'inc',
  'corp',
  'ltd',
  'co',
  'no',
  'nos',
  'vol',
  'vols',
  'rev',
  'gen',
  'col',
  'maj',
  'capt',
  'lt',
  'sgt',
  'st',
])

const CLOSING_QUOTES_AND_BRACKETS = new Set([
  '"',
  '\'',
  '”',
  '’',
  '」',
  '』',
  '）',
  '》',
  '】',
  ')',
  ']',
  '}',
  '›',
  '»',
])

const CJK_TERMINATORS = new Set(['。', '！', '？', '；', '…'])

/**
 * Splits text into sentences and records the character offsets in the original string.
 *
 * Designed for bilingual sentence alignment in Lexi:
 * - Deterministic and fast (no external NLP model or WASM).
 * - Accurately handles Latin abbreviations (e.g., Dr., vs., 3.14, e.g., i.e.).
 * - Correctly groups trailing quotes/brackets with the preceding sentence.
 * - Handles full-width CJK punctuation (。！？；) which terminates without trailing spaces.
 */
export function segmentSentences(text: string): SentenceSegment[] {
  if (!text || !text.trim())
    return []

  const segments: SentenceSegment[] = []
  const len = text.length
  let cursor = 0

  while (cursor < len) {
    // Skip leading whitespace of the sentence
    while (cursor < len && /\s/.test(text[cursor]))
      cursor++

    if (cursor >= len)
      break

    const sentenceStart = cursor
    let sentenceEnd = len

    for (let i = cursor; i < len; i++) {
      const char = text[i]

      // Double newline always breaks a sentence
      if (char === '\n' && i + 1 < len && text[i + 1] === '\n') {
        sentenceEnd = i
        cursor = i + 2
        break
      }

      // CJK terminator check
      if (CJK_TERMINATORS.has(char)) {
        let endIdx = i + 1
        while (endIdx < len && CLOSING_QUOTES_AND_BRACKETS.has(text[endIdx]))
          endIdx++

        sentenceEnd = endIdx
        cursor = endIdx
        break
      }

      // Latin terminator check (. ! ?)
      if (char === '.' || char === '!' || char === '?') {
        // Skip ellipsis: ... or ..
        if (char === '.' && ((i + 1 < len && text[i + 1] === '.') || (i > 0 && text[i - 1] === '.')))
          continue

        // Skip numbers / versions like 3.14 or 1.0.0
        if (char === '.' && i > 0 && /\d/.test(text[i - 1]) && i + 1 < len && /\d/.test(text[i + 1]))
          continue

        // Check for common abbreviations if char is '.'
        if (char === '.') {
          // Look back at preceding word
          let wordStart = i - 1
          while (wordStart >= cursor && /[a-z0-9]/i.test(text[wordStart]))
            wordStart--
          const prevWord = text.slice(wordStart + 1, i).toLowerCase()

          // Single uppercase initial like "A." in "A. Smith"
          if (prevWord.length === 1 && /[a-z]/i.test(prevWord))
            continue

          // Common abbreviation like "Dr." or "etc."
          if (COMMON_ABBREVIATIONS.has(prevWord))
            continue

          // "e.g." or "i.e." where the dot is in the middle
          if (i >= 3 && (text.slice(i - 3, i + 1).toLowerCase() === 'e.g.' || text.slice(i - 3, i + 1).toLowerCase() === 'i.e.'))
            continue
        }

        // Include any immediate trailing quotes or brackets
        let endIdx = i + 1
        while (endIdx < len && CLOSING_QUOTES_AND_BRACKETS.has(text[endIdx]))
          endIdx++

        // A Latin sentence terminator must be followed by whitespace, newline, or end of text.
        // If it's followed by a letter/digit without space (e.g. "example.com" or "v1.2"), it's not a sentence end.
        if (endIdx >= len || /\s/.test(text[endIdx])) {
          sentenceEnd = endIdx
          cursor = endIdx
          break
        }
      }
    }

    if (cursor <= sentenceStart)
      cursor = len

    const rawSentence = text.slice(sentenceStart, sentenceEnd)
    const trimmed = rawSentence.trim()
    if (trimmed) {
      // Find exact trimmed offsets
      const leadingSpaces = rawSentence.length - rawSentence.trimStart().length
      const start = sentenceStart + leadingSpaces
      const end = start + trimmed.length
      segments.push({
        text: trimmed,
        start,
        end,
      })
    }
  }

  return segments
}

/**
 * Convenience wrapper returning plain sentence strings.
 */
export function splitSentences(text: string): string[] {
  return segmentSentences(text).map(s => s.text)
}
