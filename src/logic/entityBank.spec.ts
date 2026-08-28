import { describe, expect, it } from 'vitest'
import { entitySeedBank, entitySeedSurfaceCount } from './entityBank'
import { entityDomains } from './entityDomains'
import { findEntityMatches } from './entityDetection'

describe('entity seed bank', () => {
  it('gives every entry a term and at least one sense with a Chinese explanation', () => {
    for (const entry of entitySeedBank) {
      expect(entry.term.trim()).toBe(entry.term)
      expect(entry.term.length).toBeGreaterThan(0)
      expect(entry.senses.length).toBeGreaterThan(0)

      for (const sense of entry.senses) {
        expect(entityDomains).toContain(sense.domain)
        expect(sense.meaning.length).toBeGreaterThan(4)
      }
    }
  })

  it('never lists the same domain twice inside one entry', () => {
    for (const entry of entitySeedBank) {
      const domains = entry.senses.map(sense => sense.domain)
      expect(new Set(domains).size).toBe(domains.length)
    }
  })

  it('never reuses a surface across entries', () => {
    const seen = new Map<string, string>()

    for (const entry of entitySeedBank) {
      for (const surface of [entry.term, ...(entry.aliases ?? [])]) {
        const key = surface.toLowerCase()
        expect(seen.get(key), `"${surface}" is claimed by both ${seen.get(key)} and ${entry.term}`).toBeUndefined()
        seen.set(key, entry.term)
      }
    }
  })

  it('covers all six domains and keeps real cross-domain entries', () => {
    const covered = new Set(entitySeedBank.flatMap(entry => entry.senses.map(sense => sense.domain)))
    const ambiguous = entitySeedBank.filter(entry => entry.senses.length > 1)

    expect([...covered].sort()).toEqual([...entityDomains].sort())
    expect(ambiguous.length).toBeGreaterThan(20)
  })

  it('never leaves a word that is everyday vocabulary in two fields single-sense', () => {
    // `endpoint` once shipped medical-only, which labelled every API doc 医学生物. A word
    // this common in a second field must go through disambiguation, not straight to one label.
    const crossDomain = ['endpoint', 'discovery', 'protocol', 'class', 'agent', 'position', 'index', 'token', 'control', 'sample']

    for (const term of crossDomain) {
      const entry = entitySeedBank.find(item => item.term === term)
      expect(entry, `"${term}" is no longer in the bank`).toBeDefined()
      expect(entry!.senses.length, `"${term}" must carry more than one sense`).toBeGreaterThan(1)
    }
  })

  it('reports a surface count that matches the entries it can actually match', () => {
    const surfaces = entitySeedBank.reduce((total, entry) => total + 1 + (entry.aliases?.length ?? 0), 0)

    expect(entitySeedSurfaceCount).toBe(surfaces)
  })

  it('matches every surface it ships in a plain sentence', () => {
    for (const entry of entitySeedBank) {
      for (const surface of [entry.term, ...(entry.aliases ?? [])]) {
        const matches = findEntityMatches(`Consider ${surface} here.`)
        expect(matches.length, `"${surface}" did not match`).toBeGreaterThan(0)
      }
    }
  })
})
