// Static marketing site for Lexi / 理析.
// Prerendered to plain HTML+CSS with no client bundle, so the strict CSP in
// public/_headers (script-src 'none') keeps working.
export default defineNuxtConfig({
  compatibilityDate: '2026-08-01',
  devtools: { enabled: false },

  features: {
    // Production only — dev keeps its client bundle so HMR still works.
    noScripts: 'production',
    inlineStyles: false,
  },

  // No client bundle means the payload would never be read.
  experimental: {
    payloadExtraction: false,
  },

  css: ['~/assets/css/main.css'],

  nitro: {
    prerender: {
      crawlLinks: true,
      routes: ['/', '/privacy'],
    },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      meta: [
        { charset: 'UTF-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#ffffff' },
      ],
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/inter.woff2', crossorigin: '' },
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/ma-shan-zheng.woff2', crossorigin: '' },
      ],
    },
  },
})
