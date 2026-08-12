import { estimateTokens } from './tokenBudget'

export type PageSegmentKind = 'heading' | 'paragraph' | 'list' | 'code' | 'quote' | 'table' | 'selection'

export interface PageSegment {
  /** Stable id within one capture, used to reference a segment across turns. */
  id: string
  /** Nearest heading trail, e.g. "安装 › 快速开始". Empty for top-level blocks. */
  heading: string
  text: string
  kind: PageSegmentKind
  /** Document order, used for adjacency boosts and for restoring reading order. */
  order: number
  /** Segment intersected the viewport when the page was captured. */
  visible?: boolean
}

export interface PageDocument {
  title: string
  url: string
  segments: PageSegment[]
  /** Heading trail lines in document order, used to build the cheap always-sent outline. */
  outline: string[]
  /** Total characters of extracted body text, for diagnostics. */
  charCount: number
}

export interface ScoredSegment {
  segment: PageSegment
  score: number
}

const latinWordPattern = /[a-z0-9][a-z0-9_+#.-]*/g
const cjkCharPattern = /[\u3400-\u4DBF\u4E00-\u9FFF]/g
const stopWords = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'to',
  'of',
  'in',
  'on',
  'for',
  'and',
  'or',
  'it',
  'this',
  'that',
  'with',
  'as',
  'at',
  'by',
  'from',
  'how',
  'what',
  'why',
  'can',
  'do',
  'does',
  '的',
  '了',
  '是',
  '在',
  '和',
  '与',
  '就',
  '都',
  '而',
  '及',
  '也',
  '很',
  '吗',
  '呢',
  '吧',
  '啊',
  '这个',
  '那个',
  '什么',
  '怎么',
  '如何',
  '为什',
  '一下',
  '可以',
  '我们',
  '你们',
  '他们',
])

/**
 * Split text into search terms: latin words plus CJK bigrams.
 * CJK has no word boundaries, and bigrams are the cheapest thing that still discriminates.
 */
export function tokenizeForSearch(value: string): string[] {
  if (!value)
    return []

  const lower = value.toLowerCase()
  const terms: string[] = []

  for (const match of lower.matchAll(latinWordPattern)) {
    const word = match[0]
    if (word.length >= 2 && !stopWords.has(word))
      terms.push(word)
  }

  const cjk = lower.match(cjkCharPattern)
  if (cjk) {
    const run = cjk.join('')
    for (let index = 0; index < run.length - 1; index += 1) {
      const bigram = run.slice(index, index + 2)
      if (!stopWords.has(bigram))
        terms.push(bigram)
    }
    // Single CJK characters are weak signals on their own but rescue one-character queries.
    if (run.length === 1)
      terms.push(run)
  }

  return terms
}

function countTerms(terms: string[]) {
  const counts = new Map<string, number>()
  for (const term of terms)
    counts.set(term, (counts.get(term) ?? 0) + 1)

  return counts
}

interface RankOptions {
  /** Extra terms folded in with lower weight, e.g. the previous question. */
  contextQuery?: string
  /** Segment ids adjacent to the user selection get a locality boost. */
  anchorSegmentId?: string
}

const bm25K1 = 1.2
const bm25B = 0.7

/**
 * BM25-lite over the page segments. Small enough to run on every keystroke-free submit,
 * good enough to beat "first 1200 characters of document.body".
 */
export function rankSegments(query: string, segments: PageSegment[], options: RankOptions = {}): ScoredSegment[] {
  if (!segments.length)
    return []

  const queryTerms = tokenizeForSearch(query)
  const contextTerms = tokenizeForSearch(options.contextQuery ?? '')
  const weights = new Map<string, number>()
  for (const term of queryTerms)
    weights.set(term, (weights.get(term) ?? 0) + 1)
  for (const term of contextTerms)
    weights.set(term, (weights.get(term) ?? 0) + 0.35)

  if (!weights.size)
    return segments.map(segment => ({ segment, score: 0 }))

  const docs = segments.map(segment => countTerms(tokenizeForSearch(`${segment.heading} ${segment.text}`)))
  const lengths = docs.map(doc => [...doc.values()].reduce((sum, value) => sum + value, 0))
  const avgLength = Math.max(1, lengths.reduce((sum, value) => sum + value, 0) / lengths.length)

  const docFrequency = new Map<string, number>()
  for (const term of weights.keys()) {
    let df = 0
    for (const doc of docs) {
      if (doc.has(term))
        df += 1
    }
    docFrequency.set(term, df)
  }

  const anchorOrder = options.anchorSegmentId
    ? segments.find(segment => segment.id === options.anchorSegmentId)?.order
    : undefined

  return segments.map((segment, index) => {
    const doc = docs[index]
    const length = lengths[index]
    let score = 0

    for (const [term, weight] of weights) {
      const tf = doc.get(term)
      if (!tf)
        continue

      const df = docFrequency.get(term) ?? 0
      const idf = Math.log(1 + (segments.length - df + 0.5) / (df + 0.5))
      const norm = tf * (bm25K1 + 1) / (tf + bm25K1 * (1 - bm25B + bm25B * (length / avgLength)))
      score += weight * idf * norm
    }

    if (score > 0) {
      if (segment.kind === 'heading')
        score *= 1.15
      if (segment.kind === 'code')
        score *= 1.08
      if (segment.visible)
        score *= 1.12
      if (anchorOrder != null) {
        const distance = Math.abs(segment.order - anchorOrder)
        if (distance <= 3)
          score *= 1.35 - distance * 0.08
      }
    }

    return { segment, score }
  })
}

export interface SelectSegmentsOptions {
  maxTokens: number
  maxSegments?: number
  /** Segment ids already delivered in retained history — skipped to avoid resending. */
  deliveredIds?: Iterable<string>
  /** Fraction of the top score below which a segment is considered noise. */
  relativeCutoff?: number
}

export interface SelectSegmentsResult {
  segments: PageSegment[]
  /** Segments that scored well but were dropped because the budget ran out. */
  droppedForBudget: number
  usedTokens: number
}

/**
 * Pick the highest scoring segments that fit the token allowance, then restore
 * document order so the model reads them the way the page reads.
 */
export function selectSegments(scored: ScoredSegment[], options: SelectSegmentsOptions): SelectSegmentsResult {
  const delivered = new Set(options.deliveredIds ?? [])
  const maxSegments = options.maxSegments ?? 6
  const candidates = scored
    .filter(item => item.score > 0 && !delivered.has(item.segment.id))
    .sort((left, right) => right.score - left.score || left.segment.order - right.segment.order)

  if (!candidates.length)
    return { segments: [], droppedForBudget: 0, usedTokens: 0 }

  const cutoff = (options.relativeCutoff ?? 0.18) * candidates[0].score
  const picked: PageSegment[] = []
  let usedTokens = 0
  let droppedForBudget = 0

  for (const item of candidates) {
    if (picked.length >= maxSegments)
      break
    if (item.score < cutoff)
      break

    const cost = estimateTokens(item.segment.text)
    if (usedTokens + cost > options.maxTokens) {
      droppedForBudget += 1
      continue
    }

    picked.push(item.segment)
    usedTokens += cost
  }

  picked.sort((left, right) => left.order - right.order)
  return { segments: picked, droppedForBudget, usedTokens }
}

export interface CoverageOptions {
  maxTokens: number
  maxSegments?: number
  deliveredIds?: Iterable<string>
}

export interface CoverageResult extends SelectSegmentsResult {
  /** Body segments that existed, before sampling and the budget cut it down. */
  available: number
  /** True when every available segment made it in, so the model saw the whole body. */
  complete: boolean
}

/**
 * Even coverage of the body instead of the best matches.
 *
 * "Summarise this page" shares no vocabulary with the page, so BM25 scores every segment
 * zero and relevance selection returns nothing at all — the model then correctly reports
 * that it was only given an outline. A whole-page question needs whole-page material, so
 * this walks the document at a stride wide enough to span it rather than ranking anything.
 *
 * Headings are skipped: they are already in the always-sent outline.
 */
export function selectForCoverage(segments: PageSegment[], options: CoverageOptions): CoverageResult {
  const delivered = new Set(options.deliveredIds ?? [])
  const maxSegments = options.maxSegments ?? 14
  const body = segments.filter(segment => segment.kind !== 'heading' && !delivered.has(segment.id))
  if (!body.length)
    return { segments: [], droppedForBudget: 0, usedTokens: 0, available: 0, complete: true }

  // Sample only when the whole body cannot fit; otherwise send it in reading order.
  const total = body.reduce((sum, segment) => sum + estimateTokens(segment.text), 0)
  const stride = total <= options.maxTokens && body.length <= maxSegments
    ? 1
    : Math.max(1, Math.ceil(body.length / maxSegments))

  const picked: PageSegment[] = []
  let usedTokens = 0
  let droppedForBudget = 0

  for (let index = 0; index < body.length && picked.length < maxSegments; index += stride) {
    const segment = body[index]
    const cost = estimateTokens(segment.text)
    if (usedTokens + cost > options.maxTokens) {
      droppedForBudget += 1
      continue
    }

    picked.push(segment)
    usedTokens += cost
  }

  return {
    segments: picked,
    droppedForBudget,
    usedTokens,
    available: body.length,
    complete: picked.length === body.length,
  }
}
