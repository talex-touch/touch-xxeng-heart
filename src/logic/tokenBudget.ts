const cjkPattern = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/g

/**
 * Rough token estimate that stays honest for mixed CJK / latin text.
 * CJK characters cost roughly one token each, latin text roughly one per 3.6 chars.
 */
export function estimateTokens(value: string) {
  if (!value)
    return 0

  const cjk = value.match(cjkPattern)?.length ?? 0
  const rest = Math.max(0, value.length - cjk)
  return Math.max(1, Math.ceil(cjk * 0.9 + rest / 3.6))
}

/** Characters we can afford for a token allowance, biased by how CJK-heavy the sample is. */
function tokensToChars(value: string, maxTokens: number) {
  const tokens = estimateTokens(value)
  if (tokens <= maxTokens)
    return value.length

  return Math.max(1, Math.floor((value.length * maxTokens) / tokens))
}

export function clampToTokens(value: string, maxTokens: number, ellipsis = '…') {
  if (maxTokens <= 0 || !value)
    return ''

  if (estimateTokens(value) <= maxTokens)
    return value

  const chars = tokensToChars(value, maxTokens)
  const cut = value.slice(0, Math.max(1, chars - ellipsis.length))
  // Prefer cutting on a sentence or clause boundary so the model never sees a half word.
  const boundary = Math.max(
    cut.lastIndexOf('。'),
    cut.lastIndexOf('！'),
    cut.lastIndexOf('？'),
    cut.lastIndexOf('\n'),
    cut.lastIndexOf('. '),
  )
  const trimmed = boundary > chars * 0.6 ? cut.slice(0, boundary + 1) : cut
  return `${trimmed.trimEnd()}${ellipsis}`
}

export interface TokenBudget {
  /** Tokens still available. */
  readonly remaining: number
  /** Tokens consumed so far. */
  readonly spent: number
  /** Total allowance. */
  readonly total: number
  /** Reserve tokens without any text (e.g. for message framing overhead). */
  reserve: (tokens: number) => void
  /**
   * Charge `value` against the budget, clamping it to whatever is left.
   * Returns the (possibly truncated) text that was actually charged.
   */
  take: (value: string, maxTokens?: number) => string
  /** Whether `value` fits in the remaining allowance without truncation. */
  fits: (value: string) => boolean
}

export function createTokenBudget(total: number): TokenBudget {
  const cap = Math.max(0, Math.floor(total))
  let spent = 0

  return {
    get total() {
      return cap
    },
    get spent() {
      return spent
    },
    get remaining() {
      return Math.max(0, cap - spent)
    },
    reserve(tokens: number) {
      spent += Math.max(0, Math.floor(tokens))
    },
    fits(value: string) {
      return estimateTokens(value) <= Math.max(0, cap - spent)
    },
    take(value: string, maxTokens?: number) {
      const allowance = Math.min(
        Math.max(0, cap - spent),
        maxTokens == null ? Number.POSITIVE_INFINITY : Math.max(0, maxTokens),
      )
      if (allowance <= 0 || !value)
        return ''

      const text = clampToTokens(value, allowance)
      spent += estimateTokens(text)
      return text
    },
  }
}
