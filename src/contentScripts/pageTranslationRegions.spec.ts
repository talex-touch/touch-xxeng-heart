// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { getPageContentRoot, getPageTranslationRegion } from './pageTranslationRegions'

describe('getPageTranslationRegion', () => {
  it('ranks the article body as content and the surrounding navigation as chrome', () => {
    document.body.innerHTML = `
      <header><p id="banner">Download for Mac</p></header>
      <nav><a id="nav-link" href="/docs">Getting started with the terminal app</a></nav>
      <main>
        <p id="prose">The cmux iOS app is a companion for your Mac.</p>
        <aside><p id="callout">The iOS app is in beta.</p></aside>
      </main>
      <footer><p id="legal">All rights reserved.</p></footer>
    `

    const contentRoot = getPageContentRoot()
    const region = (id: string) => getPageTranslationRegion(document.querySelector<HTMLElement>(`#${id}`)!, contentRoot)

    expect(contentRoot).toBe(document.querySelector('main'))
    expect(region('prose')).toBe('content')
    expect(region('banner')).toBe('chrome')
    expect(region('nav-link')).toBe('chrome')
    expect(region('legal')).toBe('chrome')
    // Nested landmarks still count as chrome, even inside the main column.
    expect(region('callout')).toBe('chrome')
  })

  it('treats every paragraph as content when the page marks no main column', () => {
    document.body.innerHTML = '<div><p id="prose">A page that never declared a main landmark.</p></div>'

    expect(getPageContentRoot()).toBeUndefined()
    expect(getPageTranslationRegion(document.querySelector<HTMLElement>('#prose')!)).toBe('content')
  })

  it('demotes prose that sits outside the main column', () => {
    document.body.innerHTML = `
      <main><p id="prose">Inside the article.</p></main>
      <div><p id="outside">A promo block bolted onto the end of the document.</p></div>
    `

    const contentRoot = getPageContentRoot()
    expect(getPageTranslationRegion(document.querySelector<HTMLElement>('#prose')!, contentRoot)).toBe('content')
    expect(getPageTranslationRegion(document.querySelector<HTMLElement>('#outside')!, contentRoot)).toBe('chrome')
  })
})
