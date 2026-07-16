/* eslint-disable no-console */
import { createApp } from 'vue'
import browser from 'webextension-polyfill'
import App from './views/App.vue'
import { ensurePageEnhancer } from './pageEnhancerRuntime'
import { setupApp } from '~/logic/common-setup'

// Firefox `browser.tabs.executeScript()` requires scripts return a primitive value
(() => {
  console.info('[Lexi] content script ready')
  ensurePageEnhancer()
  if (window.top !== window)
    return

  const mountApp = () => {
    if (!document.body || document.getElementById(__NAME__))
      return

    const container = document.createElement('div')
    container.id = __NAME__
    container.dataset.lexiVersion = __VERSION__
    const root = document.createElement('div')
    const styleEl = document.createElement('link')
    const shadowDOM = container.attachShadow?.({ mode: __DEV__ ? 'open' : 'closed' }) || container
    styleEl.setAttribute('rel', 'stylesheet')
    styleEl.setAttribute('href', browser.runtime.getURL('dist/contentScripts/style.css'))
    shadowDOM.appendChild(styleEl)
    shadowDOM.appendChild(root)
    document.body.appendChild(container)
    const app = createApp(App)
    setupApp(app)
    app.mount(root)
  }

  if (document.body)
    mountApp()
  else
    document.addEventListener('DOMContentLoaded', mountApp, { once: true })
})()
