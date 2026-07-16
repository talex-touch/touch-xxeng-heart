import browser from 'webextension-polyfill'
import { listenRuntimeMessage, sendTabRuntimeMessage } from '~/logic/runtimeMessaging'

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

  sendTabRuntimeMessage(tab.id, 'lexi-context-translate', {
    text: info.selectionText,
    pageUrl: tab.url,
    pageTitle: tab.title,
  }).catch((error: unknown) => console.warn('[Lexi] context translation message failed', error))
})

listenRuntimeMessage<{ url?: unknown, filename?: unknown } | undefined>('lexi-download-media', async (data) => {
  const url = typeof data?.url === 'string' ? data.url : ''
  const filename = typeof data?.filename === 'string' ? data.filename : undefined
  if (!url)
    return { ok: false, error: '缺少媒体 URL' }

  try {
    const id = await browser.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: true,
    })
    return { ok: true, id }
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})
