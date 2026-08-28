import { describe, expect, it } from 'vitest'
import { detectPageDomain, rankPageDomains } from './pageDomain'

const financeArticle = [
  'Enterprise seats are priced per-seat with annual commitments, and analysts put the implied',
  'revenue multiple near 18x. The round was structured with a fresh funding round at a higher',
  'valuation, and the investor group asked about burn rate, churn and quarterly results before',
  'signing. Earnings and cash flow both improved after the last fiscal year.',
].join(' ')

const techArticle = [
  'The runtime ships a new API this quarter, letting teams share internal tools across agents.',
  'Deployment now runs through a container image, and the compiler emits a stack trace when a',
  'dependency fails to resolve. Latency and throughput both improved after the refactor, and the',
  'backend now exposes a webhook endpoint behind OAuth.',
].join(' ')

describe('page domain', () => {
  it('names the domain from a host that carries only one kind of page', () => {
    const profile = detectPageDomain({ host: 'arxiv.org' })

    expect(profile.primary).toBe('academic')
    expect(profile.confidence).toBe(1)
  })

  it('matches a host suffix so subdomains count', () => {
    expect(detectPageDomain({ host: 'pubmed.ncbi.nlm.nih.gov' }).primary).toBe('medical')
    expect(detectPageDomain({ host: 'docs.github.com' }).primary).toBe('tech')
  })

  it('stays undecided when nothing on the page is a strong enough signal', () => {
    const profile = detectPageDomain({ host: 'example.com', title: '关于我们', text: '这是一个普通页面。' })

    expect(profile.primary).toBeUndefined()
    expect(profile.confidence).toBe(0)
  })

  it('separates a finance article from a technical one on body text alone', () => {
    expect(detectPageDomain({ text: financeArticle }).primary).toBe('finance')
    expect(detectPageDomain({ text: techArticle }).primary).toBe('tech')
  })

  it('weighs the title and headings above the body', () => {
    const buried = detectPageDomain({ title: 'Notes', text: 'The clinical trial reported one adverse event.' })
    const announced = detectPageDomain({ title: 'Clinical trial results', headings: ['Adverse event summary'], text: 'Notes.' })

    expect(announced.scores.medical).toBeGreaterThan(buried.scores.medical)
  })

  it('counts each marker once, so one repeated word cannot carry a page', () => {
    const once = detectPageDomain({ text: 'The API changed.' })
    const many = detectPageDomain({ text: 'The API changed. API. API. API. API. API.' })

    expect(many.scores.tech).toBe(once.scores.tech)
  })

  it('lets seed-term votes add to the signal', () => {
    const withoutVotes = detectPageDomain({ text: 'A short note about the filing.' })
    const withVotes = detectPageDomain({ text: 'A short note about the filing.' }, { legal: 6 })

    expect(withoutVotes.primary).toBeUndefined()
    expect(withVotes.primary).toBe('legal')
  })

  it('ignores negative votes rather than letting them subtract', () => {
    const profile = detectPageDomain({ host: 'arxiv.org' }, { academic: -20 })

    expect(profile.scores.academic).toBe(6)
  })

  it('ranks only the domains a page actually touched', () => {
    const profile = detectPageDomain({ text: financeArticle })
    const ranked = rankPageDomains(profile)

    expect(ranked[0]).toBe('finance')
    expect(ranked.every(domain => profile.scores[domain] > 0)).toBe(true)
  })
})
