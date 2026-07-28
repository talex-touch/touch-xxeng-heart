import browser from 'webextension-polyfill'

/** Opens the extension options page; shared by the popup and the side panel. */
export function openOptionsPage() {
  browser.runtime.openOptionsPage().catch((error: unknown) => {
    console.warn('[Lexi] failed to open options page', error)
  })
}
