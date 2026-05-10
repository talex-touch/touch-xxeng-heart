import type { LexiSettings } from './types'

function normalizeDomain(domain: string) {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
}

export function parseDomainList(value: string) {
  return value
    .split(/\r?\n|,/)
    .map(normalizeDomain)
    .filter(Boolean)
}

export function formatDomainList(domains: string[]) {
  return domains.join('\n')
}

export function getHostname(url = location.href) {
  try {
    return new URL(url).hostname.toLowerCase()
  }
  catch {
    return ''
  }
}

export function domainMatches(hostname: string, rule: string) {
  const normalized = normalizeDomain(rule)
  return hostname === normalized || hostname.endsWith(`.${normalized}`)
}

export function isPageEnabled(settings: LexiSettings, url = location.href) {
  const rules = settings.siteRules
  if (!rules.enabled)
    return false

  if (rules.mode === 'all')
    return true

  const hostname = getHostname(url)
  const matched = rules.domains.some(domain => domainMatches(hostname, domain))

  return rules.mode === 'allowlist' ? matched : !matched
}
