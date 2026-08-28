import { describe, expect, it } from 'vitest'
import {
  buildDetectedEntities,
  collectDomainVotes,
  createEntityIndex,
  findEntityMatches,
  mergeDetectedEntities,
  parseEntityDetectionResponse,
  resolveEntitySense,
  summarizeEntityDomains,
} from './entityDetection'
import { detectPageDomain } from './pageDomain'
import type { DetectedEntity, EntityEntry, PageDomainProfile } from './types'

function createProfile(scores: Partial<PageDomainProfile['scores']>, primary?: PageDomainProfile['primary']): PageDomainProfile {
  return {
    primary,
    confidence: primary ? 0.8 : 0,
    scores: { tech: 0, finance: 0, product: 0, medical: 0, legal: 0, academic: 0, ...scores },
  }
}

const volatile: EntityEntry = {
  term: 'volatile',
  senses: [
    { domain: 'tech', meaning: '易变的；变量修饰符。' },
    { domain: 'finance', meaning: '波动剧烈的。' },
  ],
}

const arr: EntityEntry = {
  term: 'ARR',
  caseSensitive: true,
  senses: [{ domain: 'finance', meaning: '年度经常性收入。', expansion: 'Annual Recurring Revenue' }],
}

const techProfile = createProfile({ tech: 12, finance: 2 }, 'tech')
const financeProfile = createProfile({ finance: 12, tech: 2 }, 'finance')
const undecidedProfile = createProfile({})

describe('entity detection', () => {
  it('matches the longest surface when entries overlap', () => {
    const matches = findEntityMatches('Results from the Phase II trial are due next quarter.')

    expect(matches).toHaveLength(1)
    expect(matches[0].surface).toBe('Phase II trial')
  })

  it('keeps capitalised surfaces from firing on ordinary words', () => {
    expect(findEntityMatches('Analysts track ARR closely.')).toHaveLength(1)
    expect(findEntityMatches('The arr variable holds the list.')).toHaveLength(0)
    expect(findEntityMatches('Teams react to the change.')).toHaveLength(0)
    expect(findEntityMatches('The React team shipped it.')).toHaveLength(1)
  })

  it('requires a whole word, so a surface inside a longer token is not a match', () => {
    expect(findEntityMatches('The position was closed.')).toHaveLength(1)
    expect(findEntityMatches('Call repositioning first.')).toHaveLength(0)
  })

  it('reads the same term differently depending on the page domain', () => {
    expect(resolveEntitySense(volatile, techProfile).domain).toBe('tech')
    expect(resolveEntitySense(volatile, techProfile).meaning).toContain('修饰符')
    expect(resolveEntitySense(volatile, financeProfile).domain).toBe('finance')
    expect(resolveEntitySense(volatile, financeProfile).meaning).toContain('波动')
  })

  it('falls back to the first sense when the page has no domain', () => {
    expect(resolveEntitySense(volatile, undecidedProfile).domain).toBe('tech')
  })

  it('picks the best-scoring sense even when neither is the page primary', () => {
    // A medical page that mentions a term with only tech and finance readings.
    const profile = createProfile({ medical: 20, finance: 5, tech: 1 }, 'medical')

    expect(resolveEntitySense(volatile, profile).domain).toBe('finance')
  })

  it('only lets unambiguous entries vote on the page domain', () => {
    const votes = collectDomainVotes([
      { entry: volatile, surface: 'volatile', index: 0 },
      { entry: arr, surface: 'ARR', index: 10 },
    ])

    expect(votes.finance).toBe(1)
    expect(votes.tech).toBe(0)
  })

  it('counts one vote per distinct term however often it appears', () => {
    const votes = collectDomainVotes([
      { entry: arr, surface: 'ARR', index: 0 },
      { entry: arr, surface: 'ARR', index: 20 },
      { entry: arr, surface: 'ARR', index: 40 },
    ])

    expect(votes.finance).toBe(1)
  })

  it('reports how often each entity appeared and names the readings it passed over', () => {
    const matches = [
      { entry: volatile, surface: 'volatile', index: 0 },
      { entry: volatile, surface: 'volatile', index: 30 },
      { entry: arr, surface: 'ARR', index: 60 },
    ]
    const [first, second] = buildDetectedEntities(matches, financeProfile, 10)

    expect(first).toMatchObject({ term: 'volatile', domain: 'finance', count: 2, source: 'seed' })
    expect(first.alternativeDomains).toEqual(['tech'])
    expect(second).toMatchObject({ term: 'ARR', count: 1, expansion: 'Annual Recurring Revenue' })
    expect(second.alternativeDomains).toEqual([])
  })

  it('keeps the most-mentioned entities when the page budget is small', () => {
    const matches = [
      { entry: volatile, surface: 'volatile', index: 0 },
      { entry: volatile, surface: 'volatile', index: 30 },
      { entry: arr, surface: 'ARR', index: 60 },
    ]

    expect(buildDetectedEntities(matches, financeProfile, 1).map(entity => entity.term)).toEqual(['volatile'])
    expect(buildDetectedEntities(matches, financeProfile, 0)).toEqual([])
  })

  it('labels the same shipped word by what the surrounding page is about', () => {
    const label = (host: string, title: string, text: string) => {
      const matches = findEntityMatches(text)
      const profile = detectPageDomain({ host, title, text }, collectDomainVotes(matches))
      return new Map(buildDetectedEntities(matches, profile, 24).map(entity => [entity.term, entity.domain]))
    }

    const apiDoc = label(
      'news.ycombinator.com',
      'Rate limiting the public API',
      'Every endpoint behind the gateway now enforces a per-token rate limit, and service discovery routes through the same pool.',
    )
    const readout = label(
      'clinicaltrials.gov',
      'Phase III readout',
      'The primary endpoint was met. Investigators ran a randomized controlled trial against placebo and reported the biomarker.',
    )

    expect(apiDoc.get('endpoint')).toBe('tech')
    expect(apiDoc.get('discovery')).toBe('tech')
    expect(readout.get('endpoint')).toBe('medical')
  })

  it('builds an index from a custom bank without touching the seed bank', () => {
    const index = createEntityIndex([{ term: 'widget', senses: [{ domain: 'product', meaning: '小部件。' }] }])

    expect(findEntityMatches('One widget and one ARR mention.', index)).toHaveLength(1)
    expect(findEntityMatches('One widget and one ARR mention.')).toHaveLength(1)
  })
})

describe('entity ai response', () => {
  it('drops entities that have no domain, no term or no explanation', () => {
    const parsed = parseEntityDetectionResponse({
      domain: 'finance',
      entities: [
        { term: 'Series F', domain: 'finance', meaning: 'F 轮融资。' },
        { term: 'Mystery', domain: 'astrology', meaning: '无效领域。' },
        { term: 'NoMeaning', domain: 'finance' },
        { term: '', domain: 'finance', meaning: '没有名字。' },
      ],
    })

    expect(parsed.domain).toBe('finance')
    expect(parsed.entities.map(entity => entity.term)).toEqual(['Series F'])
    expect(parsed.entities[0].source).toBe('ai')
  })

  it('leaves the domain undefined when the model did not name a usable one', () => {
    expect(parseEntityDetectionResponse({ domain: 'nonsense', entities: [] }).domain).toBeUndefined()
    expect(parseEntityDetectionResponse(undefined).entities).toEqual([])
    expect(parseEntityDetectionResponse('not json').entities).toEqual([])
  })

  it('skips terms the seed dictionary already covered, and repeats of its own', () => {
    const parsed = parseEntityDetectionResponse({
      entities: [
        { term: 'ARR', domain: 'finance', meaning: '模型重复了词典里的词。' },
        { term: 'Series F', domain: 'finance', meaning: 'F 轮融资。' },
        { term: 'series f', domain: 'finance', meaning: '同一个词换了大小写。' },
      ],
    }, ['ARR'])

    expect(parsed.entities.map(entity => entity.term)).toEqual(['Series F'])
  })

  it('trims and caps the text the model returned', () => {
    const parsed = parseEntityDetectionResponse({
      entities: [{ term: '  Series F  ', domain: 'finance', meaning: `  ${'长'.repeat(400)}  `, expansion: '  Series F Round  ' }],
    })

    expect(parsed.entities[0].term).toBe('Series F')
    expect(parsed.entities[0].expansion).toBe('Series F Round')
    expect(parsed.entities[0].meaning.length).toBe(160)
  })
})

describe('entity merge', () => {
  const seed: DetectedEntity = {
    term: 'ARR',
    domain: 'finance',
    meaning: '词典释义。',
    source: 'seed',
    alternativeDomains: [],
    count: 2,
  }
  const model: DetectedEntity = {
    term: 'arr',
    domain: 'tech',
    meaning: '模型释义。',
    source: 'ai',
    alternativeDomains: [],
    count: 0,
  }

  it('keeps the curated sense when the model repeats a seed term', () => {
    const merged = mergeDetectedEntities([seed], [model], 10)

    expect(merged).toHaveLength(1)
    expect(merged[0].meaning).toBe('词典释义。')
  })

  it('appends what the seed never knew, up to the page budget', () => {
    const extra: DetectedEntity = { ...model, term: 'Series F' }

    expect(mergeDetectedEntities([seed], [extra], 10).map(entity => entity.term)).toEqual(['ARR', 'Series F'])
    expect(mergeDetectedEntities([seed], [extra], 1).map(entity => entity.term)).toEqual(['ARR'])
  })

  it('totals the entities per domain for the side panel', () => {
    const summary = summarizeEntityDomains([seed, { ...model, term: 'Vite', domain: 'product' }])

    expect(summary).toEqual([{ domain: 'finance', count: 1 }, { domain: 'product', count: 1 }])
  })
})
