import { entitySeedBank } from './entityBank'
import { createDomainScores, entityDomains, isEntityDomain } from './entityDomains'
import type { DetectedEntity, EntityDomain, EntityEntry, EntitySense, PageDomainProfile } from './types'

/**
 * Turns page text into labelled entities.
 *
 * The order matters and is the whole design: match surfaces first, let the unambiguous
 * ones vote on what kind of page this is, then come back and use that verdict to pick a
 * sense for the ambiguous ones. A term is never disambiguated by its own sentence — the
 * page decides, which is what makes `volatile` come out differently on a trading blog
 * than in a driver's changelog.
 */

const maxAiEntities = 20
const maxMeaningLength = 160
const maxExpansionLength = 120
const maxTermLength = 64

export interface EntityIndex {
  entries: EntityEntry[]
  bySurface: Map<string, EntityEntry>
  sensitive?: RegExp
  insensitive?: RegExp
}

export interface EntityMatch {
  entry: EntityEntry
  surface: string
  index: number
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A surface with any capital in it only matches that exact casing.
 *
 * Without this, `React`, `Rust` and `SAFE` would fire on the ordinary English words, and
 * a reader would see product dots scattered through prose that never mentioned a product.
 */
function isCaseSensitiveSurface(entry: EntityEntry, surface: string) {
  return entry.caseSensitive === true || /[A-Z]/.test(surface)
}

function getEntrySurfaces(entry: EntityEntry) {
  return [entry.term, ...(entry.aliases ?? [])]
}

function createSurfacePattern(surfaces: string[], flags: string) {
  if (!surfaces.length)
    return undefined

  // Longest first, so `Phase II trial` claims the text before `Phase II` or `phase` can.
  const alternation = [...surfaces]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join('|')

  return new RegExp(`(?<![\\w-])(?:${alternation})(?![\\w-])`, flags)
}

export function createEntityIndex(entries: EntityEntry[] = entitySeedBank): EntityIndex {
  const bySurface = new Map<string, EntityEntry>()
  const sensitive: string[] = []
  const insensitive: string[] = []

  for (const entry of entries) {
    for (const surface of getEntrySurfaces(entry)) {
      if (!surface)
        continue

      bySurface.set(surface.toLowerCase(), entry)
      if (isCaseSensitiveSurface(entry, surface))
        sensitive.push(surface)
      else
        insensitive.push(surface)
    }
  }

  return {
    entries,
    bySurface,
    sensitive: createSurfacePattern(sensitive, 'g'),
    insensitive: createSurfacePattern(insensitive, 'gi'),
  }
}

let cachedIndex: EntityIndex | undefined

export function getEntityIndex() {
  cachedIndex ??= createEntityIndex()
  return cachedIndex
}

function collectPatternMatches(text: string, pattern: RegExp | undefined, index: EntityIndex, into: EntityMatch[]) {
  if (!pattern)
    return

  for (const match of text.matchAll(pattern)) {
    const entry = index.bySurface.get(match[0].toLowerCase())
    if (entry && match.index != null)
      into.push({ entry, surface: match[0], index: match.index })
  }
}

/** Non-overlapping matches in reading order; where two surfaces collide the longer one wins. */
export function findEntityMatches(text: string, index = getEntityIndex()): EntityMatch[] {
  if (!text)
    return []

  const found: EntityMatch[] = []
  collectPatternMatches(text, index.sensitive, index, found)
  collectPatternMatches(text, index.insensitive, index, found)

  found.sort((left, right) => left.index - right.index || right.surface.length - left.surface.length)

  const kept: EntityMatch[] = []
  let cursor = -1
  for (const match of found) {
    if (match.index < cursor)
      continue

    kept.push(match)
    cursor = match.index + match.surface.length
  }

  return kept
}

/**
 * Domain votes from the terms that can only mean one thing.
 *
 * Ambiguous entries are excluded on purpose: letting `position` vote would mean the
 * page's domain was partly decided by the very words that domain is needed to resolve.
 */
export function collectDomainVotes(matches: EntityMatch[]) {
  const votes = createDomainScores()
  const counted = new Set<string>()

  for (const { entry } of matches) {
    if (entry.senses.length !== 1 || counted.has(entry.term))
      continue

    counted.add(entry.term)
    votes[entry.senses[0].domain] += 1
  }

  return votes
}

/**
 * Picks the reading that best fits the page.
 *
 * An undecided page gets each term's first sense rather than a guess, so a thin page
 * degrades to a plain glossary instead of confidently mislabelling things.
 */
export function resolveEntitySense(entry: EntityEntry, profile: PageDomainProfile): EntitySense {
  const [fallback] = entry.senses
  if (entry.senses.length === 1 || !profile.primary)
    return fallback

  let best = fallback
  for (const sense of entry.senses) {
    if (profile.scores[sense.domain] > profile.scores[best.domain])
      best = sense
  }

  return profile.scores[best.domain] > 0 ? best : fallback
}

function createSeedEntity(entry: EntityEntry, profile: PageDomainProfile, count: number): DetectedEntity {
  const sense = resolveEntitySense(entry, profile)
  return {
    term: entry.term,
    domain: sense.domain,
    meaning: sense.meaning,
    expansion: sense.expansion,
    source: 'seed',
    alternativeDomains: entry.senses.map(item => item.domain).filter(domain => domain !== sense.domain),
    count,
  }
}

export function buildDetectedEntities(matches: EntityMatch[], profile: PageDomainProfile, limit: number) {
  const counts = new Map<string, { entry: EntityEntry, count: number }>()

  for (const { entry } of matches) {
    const current = counts.get(entry.term)
    if (current)
      current.count += 1
    else
      counts.set(entry.term, { entry, count: 1 })
  }

  return [...counts.values()]
    .map(({ entry, count }) => createSeedEntity(entry, profile, count))
    .sort((left, right) => right.count - left.count || left.term.localeCompare(right.term))
    .slice(0, Math.max(0, limit))
}

export interface EntityDetectionResponse {
  domain?: EntityDomain
  entities: DetectedEntity[]
}

function readText(value: unknown, maxLength: number) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : ''
}

/**
 * Reads the model's answer.
 *
 * Anything the model cannot substantiate is dropped rather than repaired: an entity with
 * no domain or no explanation is worth less than no entity at all, because the reader
 * has no way to tell a confident label from a filled-in blank.
 */
export function parseEntityDetectionResponse(value: unknown, known: Iterable<string> = []): EntityDetectionResponse {
  if (!value || typeof value !== 'object')
    return { entities: [] }

  const payload = value as { domain?: unknown, entities?: unknown }
  const seen = new Set([...known].map(term => term.toLowerCase()))
  const entities: DetectedEntity[] = []

  if (Array.isArray(payload.entities)) {
    for (const item of payload.entities) {
      if (entities.length >= maxAiEntities)
        break

      if (!item || typeof item !== 'object')
        continue

      const candidate = item as { term?: unknown, domain?: unknown, meaning?: unknown, expansion?: unknown }
      const term = readText(candidate.term, maxTermLength)
      const meaning = readText(candidate.meaning, maxMeaningLength)
      if (!term || !meaning || !isEntityDomain(candidate.domain) || seen.has(term.toLowerCase()))
        continue

      seen.add(term.toLowerCase())
      entities.push({
        term,
        domain: candidate.domain,
        meaning,
        expansion: readText(candidate.expansion, maxExpansionLength) || undefined,
        source: 'ai',
        alternativeDomains: [],
        count: 0,
      })
    }
  }

  return {
    domain: isEntityDomain(payload.domain) ? payload.domain : undefined,
    entities,
  }
}

/** The curated sense always wins a collision; the model only fills what the seed never knew. */
export function mergeDetectedEntities(seed: DetectedEntity[], ai: DetectedEntity[], limit: number) {
  const taken = new Set(seed.map(entity => entity.term.toLowerCase()))
  const extra = ai.filter(entity => !taken.has(entity.term.toLowerCase()))
  return [...seed, ...extra].slice(0, Math.max(0, limit))
}

/** Per-domain totals for the side-panel breakdown. */
export function summarizeEntityDomains(entities: DetectedEntity[]) {
  const totals = createDomainScores()
  for (const entity of entities)
    totals[entity.domain] += 1

  return entityDomains
    .filter(domain => totals[domain] > 0)
    .map(domain => ({ domain, count: totals[domain] }))
}
