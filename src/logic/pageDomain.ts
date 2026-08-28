import { createDomainScores, entityDomainHosts, entityDomainMarkers, entityDomains } from './entityDomains'
import { hasCjkText } from './selectionVocabulary'
import type { EntityDomain, PageDomainProfile } from './types'

/**
 * Which of the six domains a page belongs to.
 *
 * This runs before any term is labelled, because the domain is what decides *which*
 * meaning an ambiguous term gets: `volatile` on a trading page is not the `volatile` on
 * a compiler page. When the signals are too thin to pick a side the profile says so
 * (`primary` stays undefined) and the caller falls back to each term's first sense
 * rather than guessing.
 */

export interface PageDomainSignals {
  host?: string
  title?: string
  headings?: string[]
  text?: string
}

/** A host on the list is worth more than any single marker but never wins unopposed against a full page. */
const hostWeight = 6
const headlineWeight = 3
const bodyWeight = 1
const maxHeadlineLength = 600
const maxTextLength = 8000

/** Below either floor the page stays undecided. With six buckets, an even split sits near 0.17. */
const minPrimaryScore = 4
export const minPageDomainConfidence = 0.3

const markerPatterns = new Map<string, RegExp>()

function markerPattern(marker: string) {
  const cached = markerPatterns.get(marker)
  if (cached)
    return cached

  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // `\b` never fires between two CJK characters, so those markers match as substrings.
  const pattern = new RegExp(hasCjkText(marker) ? escaped : `\\b${escaped}\\b`, 'i')
  markerPatterns.set(marker, pattern)
  return pattern
}

function hostMatches(hostname: string, rule: string) {
  return hostname === rule || hostname.endsWith(`.${rule}`)
}

function scoreHost(scores: Record<EntityDomain, number>, host: string) {
  const hostname = host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '')
  if (!hostname)
    return

  for (const group of entityDomainHosts) {
    if (group.hosts.some(rule => hostMatches(hostname, rule)))
      scores[group.domain] += hostWeight
  }
}

/**
 * Counts each marker once per page.
 *
 * Occurrences are deliberately not counted: one word repeated forty times says less
 * about a page than forty different words from the same field, and repetition is exactly
 * what navigation chrome and boilerplate produce.
 */
function scoreMarkers(scores: Record<EntityDomain, number>, headline: string, text: string) {
  for (const domain of entityDomains) {
    for (const marker of entityDomainMarkers[domain]) {
      const pattern = markerPattern(marker)
      if (pattern.test(headline))
        scores[domain] += headlineWeight
      else if (pattern.test(text))
        scores[domain] += bodyWeight
    }
  }
}

export function detectPageDomain(
  signals: PageDomainSignals,
  votes: Partial<Record<EntityDomain, number>> = {},
): PageDomainProfile {
  const scores = createDomainScores()

  if (signals.host)
    scoreHost(scores, signals.host)

  const headline = [signals.title ?? '', ...(signals.headings ?? [])].join(' \n ').slice(0, maxHeadlineLength)
  scoreMarkers(scores, headline, (signals.text ?? '').slice(0, maxTextLength))

  for (const domain of entityDomains)
    scores[domain] += Math.max(0, votes[domain] ?? 0)

  let primary = entityDomains[0]
  let total = 0
  for (const domain of entityDomains) {
    total += scores[domain]
    if (scores[domain] > scores[primary])
      primary = domain
  }

  const confidence = total > 0 ? scores[primary] / total : 0
  const decided = scores[primary] >= minPrimaryScore && confidence >= minPageDomainConfidence

  return {
    primary: decided ? primary : undefined,
    confidence: decided ? confidence : 0,
    scores,
  }
}

/** Ranks the domains a page touched at all, for the side-panel breakdown. */
export function rankPageDomains(profile: PageDomainProfile) {
  return entityDomains
    .filter(domain => profile.scores[domain] > 0)
    .sort((left, right) => profile.scores[right] - profile.scores[left])
}
