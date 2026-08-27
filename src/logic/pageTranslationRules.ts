import browser from 'webextension-polyfill'
import { pageTranslationActivationsStorageKey } from './storageKeys'
import { readJsonValue } from './storageJson'
import type { PageTranslationActivation } from './types'

/**
 * Saved page-translation rules, keyed by scope identity. Shared between the
 * content script (create/restore/remove on the page) and the options page
 * (audit, toggle and delete). Writers on both sides do read-modify-write, so
 * each side serializes its own writes and refreshes via storage.onChanged.
 */
export type PageTranslationActivations = Record<string, PageTranslationActivation>

/** Drops the hash so fragment navigation maps to one rule and one cache entry. */
export function normalizePageTranslationUrl(url: string) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString()
  }
  catch {
    return url.split('#')[0]
  }
}

export function getPageTranslationActivationKey(activation: PageTranslationActivation) {
  if (activation.scope === 'site')
    return `site:${activation.host}`

  if (activation.scope === 'regex')
    return `regex:${activation.regex}`

  return `url:${normalizePageTranslationUrl(activation.url)}`
}

export function pageTranslationActivationMatches(activation: PageTranslationActivation, url: string) {
  if (!activation.enabled)
    return false

  if (activation.scope === 'url')
    return normalizePageTranslationUrl(activation.url) === normalizePageTranslationUrl(url)

  if (activation.scope === 'site') {
    try {
      return activation.host === new URL(url).hostname
    }
    catch {
      return false
    }
  }

  if (!activation.regex.trim())
    return false

  try {
    return new RegExp(activation.regex).test(url)
  }
  catch {
    return false
  }
}

export async function readPageTranslationActivations(): Promise<PageTranslationActivations> {
  const stored = await browser.storage.local.get(pageTranslationActivationsStorageKey)
  return readJsonValue<PageTranslationActivations>(stored[pageTranslationActivationsStorageKey], {})
}

export async function writePageTranslationActivations(activations: PageTranslationActivations) {
  await browser.storage.local.set({ [pageTranslationActivationsStorageKey]: JSON.stringify(activations) })
}

export async function findMatchingPageTranslationActivation(url: string) {
  const activations = await readPageTranslationActivations()
  return Object.values(activations)
    .filter(activation => pageTranslationActivationMatches(activation, url))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

export async function upsertPageTranslationActivation(activation: PageTranslationActivation) {
  const activations = await readPageTranslationActivations()
  activations[getPageTranslationActivationKey(activation)] = activation
  await writePageTranslationActivations(activations)
}

export async function deletePageTranslationActivation(key: string) {
  const activations = await readPageTranslationActivations()
  if (!(key in activations))
    return

  delete activations[key]
  await writePageTranslationActivations(activations)
}
