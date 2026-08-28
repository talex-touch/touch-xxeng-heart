/**
 * Script-range language detection.
 *
 * Deliberately not a statistical model. The one hard question here — telling Chinese,
 * Japanese and Korean apart when all three can carry Han characters — has a
 * deterministic answer, because kana and hangul are exclusive evidence: Chinese never
 * uses kana, and neither Chinese nor Japanese uses hangul. A trigram library would cost
 * tens of kilobytes to answer that question worse, and would answer it worst on the short
 * strings selection translation sends.
 *
 * The result decides the *target* language only. Source language stays `auto` so the
 * engine detects it — engines are better at that and it costs nothing. That keeps a wrong
 * guess cheap: the worst case is the same target we would have picked before, never a
 * request that asserts a source language the text does not have.
 */

export type DetectedLanguage = 'zh' | 'ja' | 'ko' | 'en' | 'other'

export interface LanguageDetection {
  language: DetectedLanguage
  /** 0–1. Below `confidentEnough` the caller should keep its previous behaviour. */
  confidence: number
  counts: ScriptCounts
}

export interface ScriptCounts {
  hiragana: number
  katakana: number
  hangul: number
  han: number
  latin: number
  total: number
}

const scriptPatterns = {
  hiragana: /[\u3040-\u309F]/,
  /** Includes the half-width block, which Japanese UI text still uses. */
  katakana: /[\u30A0-\u30FF\uFF66-\uFF9D]/,
  /** Syllables, jamo and compatibility jamo. */
  hangul: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/,
  /** Extension A, the main ideograph block, and compatibility ideographs. */
  han: /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/,
  latin: /[A-Z]/i,
} as const

/** Enough of a signal to act on. Below this, callers keep their previous behaviour. */
export const confidentEnough = 0.7

/** Hangul share of CJK characters above which Han characters read as hanja, not Chinese. */
const hangulShareForKorean = 0.5
/**
 * Hiragana is the strongest single signal for Japanese: it is grammatical glue (の, は,
 * を, です) that Chinese has no reason to contain. Japanese prose runs 40–60% kana, so a
 * threshold this low still clears a Chinese article carrying a one-line Japanese quote.
 */
const hiraganaShareForJapanese = 0.08
/**
 * Katakana on its own is much weaker evidence — Chinese pages quote Japanese product
 * names (ポケモン, アニメ) routinely. Without any hiragana to back it up, katakana has to
 * dominate before the text reads as Japanese rather than as Chinese quoting Japanese.
 */
const katakanaOnlyShareForJapanese = 0.3
/** Two kana rule out an incidental single character used as decoration. */
const minKanaForJapanese = 2

const englishStopWords = new Set([
  'the',
  'and',
  'for',
  'that',
  'this',
  'with',
  'you',
  'are',
  'not',
  'but',
  'have',
  'from',
  'they',
  'what',
  'when',
  'your',
  'can',
  'will',
  'has',
  'all',
  'was',
  'been',
  'would',
  'there',
  'their',
  'which',
  'about',
  'into',
  'more',
  'other',
  'some',
  'than',
  'then',
  'them',
  'these',
  'also',
  'only',
  'over',
  'such',
  'because',
  'how',
  'why',
  'does',
])

/** Words and marks that are cheap proof the text is Latin-script but not English. */
const nonEnglishLatinSignals = [
  /[ñ¿¡]/, // es
  /[àçèêùœ]/, // fr
  /[äöüß]/, // de
  /[ãõ]/, // pt
  /\b(?:el|la|los|las|una|pero|porque|como|para|con|del)\b/i, // es
  /\b(?:le|les|une|des|dans|pour|avec|est|sont|mais|cette)\b/i, // fr
  /\b(?:der|die|das|und|nicht|mit|ist|sind|auch|eine|oder)\b/i, // de
]

export function countScripts(text: string): ScriptCounts {
  const counts: ScriptCounts = { hiragana: 0, katakana: 0, hangul: 0, han: 0, latin: 0, total: 0 }
  for (const char of text) {
    if (scriptPatterns.hiragana.test(char))
      counts.hiragana += 1
    else if (scriptPatterns.katakana.test(char))
      counts.katakana += 1
    else if (scriptPatterns.hangul.test(char))
      counts.hangul += 1
    else if (scriptPatterns.han.test(char))
      counts.han += 1
    else if (scriptPatterns.latin.test(char))
      counts.latin += 1
    else
      continue

    counts.total += 1
  }
  return counts
}

function detectLatin(text: string, counts: ScriptCounts): LanguageDetection {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? []
  const stopWordHits = words.filter(word => englishStopWords.has(word)).length
  const nonEnglish = nonEnglishLatinSignals.some(pattern => pattern.test(text))

  if (nonEnglish && !stopWordHits)
    return { language: 'other', confidence: 0.75, counts }

  if (!words.length)
    return { language: 'other', confidence: 0, counts }

  // Short strings rarely contain a stop word, so absence is not evidence against English.
  // Treat English as the Latin-script default and let hits raise confidence from there.
  const share = stopWordHits / words.length
  const confidence = words.length < 6
    ? (stopWordHits ? 0.8 : 0.55)
    : Math.min(0.95, 0.5 + share * 2.5)

  return { language: 'en', confidence: nonEnglish ? Math.min(confidence, 0.5) : confidence, counts }
}

export function detectLanguage(text: string): LanguageDetection {
  const counts = countScripts(text)
  const cjk = counts.hiragana + counts.katakana + counts.hangul + counts.han
  const kana = counts.hiragana + counts.katakana

  if (!counts.total)
    return { language: 'other', confidence: 0, counts }

  if (counts.hangul > 0 && counts.hangul / (counts.hangul + counts.han) >= hangulShareForKorean)
    return { language: 'ko', confidence: Math.min(0.99, 0.75 + counts.hangul / Math.max(cjk, 1) * 0.24), counts }

  const japaneseByHiragana = counts.hiragana > 0 && counts.hiragana / cjk >= hiraganaShareForJapanese
  const japaneseByKatakana = counts.hiragana === 0
    && counts.katakana >= minKanaForJapanese
    && counts.katakana / cjk >= katakanaOnlyShareForJapanese

  if (japaneseByHiragana || japaneseByKatakana)
    return { language: 'ja', confidence: Math.min(0.99, 0.75 + kana / Math.max(cjk, 1) * 0.24), counts }

  if (counts.han > 0 && counts.han >= cjk * 0.5) {
    // Han that survived the kana and hangul checks is Chinese, even alongside a quoted
    // product name in katakana.
    const share = counts.han / counts.total
    return { language: 'zh', confidence: Math.min(0.98, 0.6 + share * 0.38), counts }
  }

  if (counts.latin > 0 && counts.latin >= cjk)
    return detectLatin(text, counts)

  if (cjk > 0)
    return { language: 'zh', confidence: 0.5, counts }

  return { language: 'other', confidence: 0, counts }
}

/** True when the text is Chinese with enough confidence to act on it. */
export function isChineseText(text: string) {
  const result = detectLanguage(text)
  return result.language === 'zh' && result.confidence >= confidentEnough
}

/** Han characters that belong to Chinese text — kanji and hanja do not count. */
export function countChineseCharacters(text: string) {
  const result = detectLanguage(text)
  return result.language === 'zh' ? result.counts.han : 0
}
