// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { findAboutPlacement, getStickyOffset } from './githubPlacement'

function render(html: string) {
  document.body.innerHTML = html
  return document.body
}

/** The classic repo overview: sidebar › BorderGrid › row › About heading. */
const borderGridSidebar = `
  <div class="Layout">
    <div class="Layout-main"><article class="markdown-body"><p>readme</p></article></div>
    <div class="Layout-sidebar">
      <div class="BorderGrid BorderGrid--spacious">
        <div class="BorderGrid-row" id="about-row">
          <div class="BorderGrid-cell">
            <h2 class="mb-3 h4">About</h2>
            <p>天天中转站</p>
          </div>
        </div>
        <div class="BorderGrid-row" id="releases-row"><h2>Releases</h2></div>
      </div>
    </div>
  </div>
`

describe('findAboutPlacement', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('anchors above the whole About section inside the sidebar', () => {
    render(borderGridSidebar)
    const placement = findAboutPlacement(document)

    expect(placement?.parent).toBe(document.querySelector('.Layout-sidebar'))
    // The BorderGrid wraps About, so the card goes above the grid — i.e. above About.
    expect(placement?.before).toBe(document.querySelector('.BorderGrid'))
  })

  it('places the card before the About heading in document order', () => {
    render(borderGridSidebar)
    const placement = findAboutPlacement(document)!
    const mount = document.createElement('div')
    placement.parent.insertBefore(mount, placement.before)

    const heading = document.querySelector('h2')!
    expect(mount.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('uses the repository-about test id when present', () => {
    render(`
      <div class="Layout-sidebar">
        <div id="about-block"><div data-testid="repository-about"><h2>关于</h2></div></div>
        <div id="other">Releases</div>
      </div>
    `)

    const placement = findAboutPlacement(document)
    expect(placement?.before).toBe(document.querySelector('#about-block'))
  })

  it('falls back to the sidebar top when About is missing', () => {
    render('<div class="Layout-sidebar"><div id="first">Releases</div></div>')
    const placement = findAboutPlacement(document)

    expect(placement?.parent).toBe(document.querySelector('.Layout-sidebar'))
    expect(placement?.before).toBe(document.querySelector('#first'))
  })

  it('still finds About when GitHub renames the sidebar container', () => {
    render(`
      <div class="some-future-class">
        <div class="BorderGrid-row" id="about-row"><h2>About</h2><p>desc</p></div>
        <div class="BorderGrid-row">Releases</div>
      </div>
    `)

    const placement = findAboutPlacement(document)
    expect(placement?.before).toBe(document.querySelector('#about-row'))
  })

  it('ignores an About heading in the main column when a sidebar exists', () => {
    render(`
      <div class="Layout-main"><h2>About</h2></div>
      <div class="Layout-sidebar"><div id="first">Releases</div></div>
    `)

    const placement = findAboutPlacement(document)
    expect(placement?.parent).toBe(document.querySelector('.Layout-sidebar'))
    expect(placement?.before).toBe(document.querySelector('#first'))
  })

  it('returns nothing on pages with neither sidebar nor About', () => {
    render('<div class="Layout-main"><p>issues list</p></div>')
    expect(findAboutPlacement(document)).toBeUndefined()
  })
})

describe('getStickyOffset', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('clears a sticky app header', () => {
    render('<header class="AppHeader"></header>')
    const header = document.querySelector<HTMLElement>('.AppHeader')!
    header.getBoundingClientRect = () => ({ height: 64 }) as DOMRect

    const view = { getComputedStyle: () => ({ position: 'sticky' }) as CSSStyleDeclaration }
    expect(getStickyOffset(document, view)).toBe(80)
  })

  it('does not reserve space for a static header', () => {
    render('<header class="AppHeader"></header>')
    const view = { getComputedStyle: () => ({ position: 'static' }) as CSSStyleDeclaration }
    expect(getStickyOffset(document, view)).toBe(16)
  })

  it('falls back to a plain margin when there is no header', () => {
    render('<div></div>')
    const view = { getComputedStyle: () => ({ position: 'sticky' }) as CSSStyleDeclaration }
    expect(getStickyOffset(document, view)).toBe(16)
  })
})
