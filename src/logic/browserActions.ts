import browser from 'webextension-polyfill'

/**
 * Opens the extension options page; shared by the popup and the side panel.
 * With a section id the page opens deep-linked (e.g. `translation` lands on
 * the page-translation rules), which `openOptionsPage()` itself cannot do.
 */
export function openOptionsPage(section?: string) {
  if (section) {
    browser.tabs.create({ url: browser.runtime.getURL(`dist/options/index.html#${section}`) }).catch((error: unknown) => {
      console.warn('[Lexi] failed to open options page', error)
    })
    return
  }

  browser.runtime.openOptionsPage().catch((error: unknown) => {
    console.warn('[Lexi] failed to open options page', error)
  })
}
