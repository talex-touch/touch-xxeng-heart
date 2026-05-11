import type { FeatureScene, LexiSettings, SiteSceneRule, SpecialSiteProfile } from './types'

function normalizeDomain(domain: string) {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
}

export function normalizeSiteRuleDomain(domain: string) {
  return normalizeDomain(domain)
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

function findSceneRule(rules: SiteSceneRule[], url = location.href) {
  const hostname = getHostname(url)
  return rules.find(rule => rule.domain && domainMatches(hostname, rule.domain))
}

export function findSpecialSiteProfile(settings: LexiSettings, url = location.href): SpecialSiteProfile | undefined {
  const hostname = getHostname(url)
  return settings.siteRules.specialProfiles.find(profile =>
    profile.domains.some(domain => domainMatches(hostname, domain)),
  )
}

export function isSceneEnabled(settings: LexiSettings, scene: FeatureScene, url = location.href) {
  if (!isPageEnabled(settings, url))
    return false

  const profile = findSpecialSiteProfile(settings, url)
  if (profile && !profile.enabled)
    return false

  if (profile && scene === 'replacement' && !profile.replacement)
    return false

  if (profile && scene === 'selection' && !profile.selection)
    return false

  const rule = findSceneRule(settings.siteRules.sceneRules, url)
  return rule ? rule[scene] : true
}
