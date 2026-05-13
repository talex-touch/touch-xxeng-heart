import { sendMessage } from 'webext-bridge/background'
import browser from 'webextension-polyfill'

// only on dev mode
if (import.meta.hot) {
  // @ts-expect-error for background HMR
  import('/@vite/client')
  // load latest content script
  import('./contentScriptHMR')
}

// to toggle the sidepanel with the action button in chromium:
if (!__FIREFOX__) {
  // @ts-expect-error missing types
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error(error))
}

browser.runtime.onInstalled.addListener((): void => {
  browser.contextMenus.create({
    id: 'lexi-translate-selection',
    title: '使用 Lexi 翻译',
    contexts: ['selection'],
  })
})

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'lexi-translate-selection' || !tab?.id || !info.selectionText)
    return

  sendMessage('lexi-context-translate', {
    text: info.selectionText,
    pageUrl: tab.url,
    pageTitle: tab.title,
  }, { context: 'content-script', tabId: tab.id }).catch((error: unknown) => console.error(error))
})
