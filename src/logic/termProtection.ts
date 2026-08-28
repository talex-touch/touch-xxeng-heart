/**
 * Hides spans that must survive translation untouched.
 *
 * Backticked code, URLs, acronyms and camelCase identifiers are replaced with opaque
 * tokens before the text is sent out, then put back afterwards. Translation engines
 * otherwise happily render `Kubernetes` phonetically or reflow a URL.
 *
 * The token shape is load-bearing. `_` is a word character, so there is no word boundary
 * before the `L` in `__LEXI_TERM_0__` — which means {@link protectTerms} cannot match its
 * own output and the pass is safe to compose with anything else using the same prefix.
 * The upcoming inline-markup work depends on that property, so it has a test.
 */

const tokenPrefix = '__LEXI_TERM_'
const tokenSuffix = '__'

/** Backticked code, bare URLs, ALL-CAPS acronyms, and camelCase identifiers. */
const protectedPattern = /`[^`]+`|https?:\/\/\S+|\b(?:[A-Z]{2,}|[A-Za-z]*[a-z][A-Z][A-Za-z0-9]*)\b/g

export interface ProtectedText {
  text: string
  terms: string[]
}

export function protectTerms(text: string): ProtectedText {
  const terms: string[] = []
  const protectedText = text.replace(protectedPattern, (term) => {
    const token = `${tokenPrefix}${terms.length}${tokenSuffix}`
    terms.push(term)
    return token
  })

  return { text: protectedText, terms }
}

/**
 * Tolerant by design: engines reorder, drop and occasionally duplicate tokens, and a
 * missing token must cost one term rather than the whole translation.
 */
export function restoreTerms(text: string, terms: string[]) {
  return terms.reduce(
    (value, term, index) => value.replaceAll(`${tokenPrefix}${index}${tokenSuffix}`, term),
    text,
  )
}
