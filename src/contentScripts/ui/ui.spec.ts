// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollapsible } from './collapsible'
import { createListenerGroup, once } from './listenerGroup'
import { resolveFlipPlacement } from './position'

describe('createListenerGroup', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('removes listeners with the exact options they were added with', () => {
    const target = document.createElement('div')
    const add = vi.spyOn(target, 'addEventListener')
    const remove = vi.spyOn(target, 'removeEventListener')
    const group = createListenerGroup()
    const handler = () => {}

    group.add(target, 'click', handler, { capture: true, passive: true })
    group.removeAll()

    expect(add.mock.calls[0][2]).toEqual(remove.mock.calls[0][2])
  })

  it('actually stops delivering events after removeAll', () => {
    const target = document.createElement('div')
    const handler = vi.fn()
    const group = createListenerGroup()

    group.add(target, 'click', handler, true)
    target.dispatchEvent(new Event('click'))
    group.removeAll()
    target.dispatchEvent(new Event('click'))

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('is idempotent — removeAll twice does not double-remove', () => {
    const target = document.createElement('div')
    const remove = vi.spyOn(target, 'removeEventListener')
    const group = createListenerGroup()

    group.add(target, 'click', () => {})
    group.removeAll()
    group.removeAll()

    expect(remove).toHaveBeenCalledTimes(1)
    expect(group.size).toBe(0)
  })
})

describe('once', () => {
  it('ignores the same event delivered twice across capture and bubble phases', () => {
    const parent = document.createElement('div')
    const child = document.createElement('span')
    parent.append(child)
    document.body.append(parent)

    const handler = vi.fn()
    const guarded = once(handler)
    parent.addEventListener('click', guarded, true)
    parent.addEventListener('click', guarded)

    child.dispatchEvent(new Event('click', { bubbles: true }))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('still runs for a genuinely new event', () => {
    const target = document.createElement('div')
    const handler = vi.fn()
    const guarded = once(handler)
    target.addEventListener('click', guarded)

    target.dispatchEvent(new Event('click'))
    target.dispatchEvent(new Event('click'))
    expect(handler).toHaveBeenCalledTimes(2)
  })
})

describe('resolveFlipPlacement', () => {
  const viewport = { width: 1000, height: 800 }

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: viewport.width, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: viewport.height, configurable: true })
  })

  const anchor = (top: number, height = 20) => ({
    left: 100,
    right: 300,
    top,
    bottom: top + height,
    width: 200,
    height,
  })

  it('places the panel below the anchor when it fits', () => {
    const placement = resolveFlipPlacement(anchor(100), { width: 300, height: 200 }, { gap: 8 })
    expect(placement.top).toBe(128)
  })

  it('flips above when there is no room below', () => {
    const placement = resolveFlipPlacement(anchor(700), { width: 300, height: 200 }, { gap: 8 })
    expect(placement.top).toBe(700 - 200 - 8)
  })

  it('clamps into the viewport when neither side fits', () => {
    const placement = resolveFlipPlacement(anchor(400), { width: 300, height: 780 }, { margin: 12 })
    expect(placement.top).toBeGreaterThanOrEqual(12)
    expect(placement.top + 780).toBeLessThanOrEqual(viewport.height + 780)
  })

  it('never lets the panel spill past the right edge', () => {
    const wide = { left: 900, right: 980, top: 100, bottom: 120, width: 80, height: 20 }
    const placement = resolveFlipPlacement(wide, { width: 400, height: 100 }, { margin: 12 })
    expect(placement.left + 400).toBeLessThanOrEqual(viewport.width - 12)
  })

  it('centres on the anchor when asked', () => {
    const placement = resolveFlipPlacement(anchor(100), { width: 100, height: 50 }, { align: 'center' })
    expect(placement.left).toBe(150)
  })

  it('right-aligns to the anchor when asked', () => {
    const placement = resolveFlipPlacement(anchor(100), { width: 100, height: 50 }, { align: 'end' })
    expect(placement.left).toBe(200)
  })
})

describe('createCollapsible', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  function mount(collapsed = false) {
    const panel = document.createElement('section')
    panel.className = 'lexi-test'
    document.body.append(panel)
    const handle = createCollapsible(panel, { block: 'lexi-test', label: '测试面板', summary: '摘要', collapsed })
    panel.append(handle.pill)
    return { panel, handle }
  }

  it('starts expanded and marks the panel accordingly', () => {
    const { panel, handle } = mount()
    expect(handle.collapsed).toBe(false)
    expect(panel.getAttribute('data-lexi-collapsed')).toBe('false')
  })

  it('can start collapsed', () => {
    const { panel, handle } = mount(true)
    expect(handle.collapsed).toBe(true)
    expect(panel.getAttribute('data-lexi-collapsed')).toBe('true')
  })

  it('collapses via the header toggle and expands via the pill', () => {
    const { panel, handle } = mount()

    handle.toggle.click()
    expect(handle.collapsed).toBe(true)
    expect(panel.getAttribute('data-lexi-collapsed')).toBe('true')

    handle.pill.click()
    expect(handle.collapsed).toBe(false)
    expect(panel.getAttribute('data-lexi-collapsed')).toBe('false')
  })

  it('notifies the owner so floating panels can reposition', () => {
    const onToggle = vi.fn()
    const panel = document.createElement('section')
    const handle = createCollapsible(panel, { block: 'lexi-test', label: '测试面板', onToggle })

    handle.toggle.click()
    expect(onToggle).toHaveBeenCalledWith(true)

    handle.pill.click()
    expect(onToggle).toHaveBeenLastCalledWith(false)
  })

  it('does not fire onToggle when the state is unchanged', () => {
    const onToggle = vi.fn()
    const panel = document.createElement('section')
    const handle = createCollapsible(panel, { block: 'lexi-test', label: '测试面板', onToggle })

    handle.setCollapsed(false)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('keeps aria-expanded in sync on both affordances', () => {
    const { handle } = mount()

    handle.setCollapsed(true)
    expect(handle.pill.getAttribute('aria-expanded')).toBe('false')
    expect(handle.toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('stops responding after destroy', () => {
    const { handle } = mount()
    handle.destroy()
    handle.toggle.click()
    expect(handle.collapsed).toBe(false)
  })

  it('updates the collapsed pill summary', () => {
    const { handle } = mount(true)
    handle.setSummary('新的摘要')
    expect(handle.pill.textContent).toContain('新的摘要')
  })
})
