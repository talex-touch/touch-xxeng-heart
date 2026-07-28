// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CollapsibleSection from '../CollapsibleSection.vue'
import EmptyState from '../EmptyState.vue'
import StatTile from '../StatTile.vue'
import TabBar from '../TabBar.vue'
import ToggleSwitch from '../ToggleSwitch.vue'
import TrendBars from '../TrendBars.vue'

describe('toggleSwitch', () => {
  it('exposes switch semantics', () => {
    const wrapper = mount(ToggleSwitch, { props: { modelValue: true, label: '总开关' } })
    expect(wrapper.attributes('role')).toBe('switch')
    expect(wrapper.attributes('aria-checked')).toBe('true')
    expect(wrapper.attributes('aria-label')).toBe('总开关')
  })

  it('emits the inverted value on click', async () => {
    const wrapper = mount(ToggleSwitch, { props: { modelValue: false } })
    await wrapper.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
  })

  it('does not emit while disabled', async () => {
    const wrapper = mount(ToggleSwitch, { props: { modelValue: false, disabled: true } })
    await wrapper.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('collapsibleSection', () => {
  // v-show drives `display` on the body container; assert on that rather than
  // DOMWrapper.isVisible(), which reads a stale node after a re-render.
  const bodyHidden = (wrapper: ReturnType<typeof mount>) =>
    (wrapper.find('section > div').attributes('style') ?? '').includes('display: none')

  it('starts collapsed by default and hides its slot', () => {
    const wrapper = mount(CollapsibleSection, {
      props: { title: '高级设置' },
      slots: { default: '<p id="inner">内容</p>' },
    })

    expect(wrapper.find('button').attributes('aria-expanded')).toBe('false')
    expect(bodyHidden(wrapper)).toBe(true)
  })

  it('can start expanded', () => {
    const wrapper = mount(CollapsibleSection, {
      props: { title: '高级设置', collapsed: false },
      slots: { default: '<p id="inner">内容</p>' },
    })
    expect(bodyHidden(wrapper)).toBe(false)
  })

  it('toggles on header click', async () => {
    const wrapper = mount(CollapsibleSection, {
      props: { title: '高级设置' },
      slots: { default: '<p id="inner">内容</p>' },
    })

    await wrapper.find('button').trigger('click')
    expect(wrapper.find('button').attributes('aria-expanded')).toBe('true')
    expect(bodyHidden(wrapper)).toBe(false)

    await wrapper.find('button').trigger('click')
    expect(wrapper.find('button').attributes('aria-expanded')).toBe('false')
    expect(bodyHidden(wrapper)).toBe(true)
  })

  it('renders the optional hint', () => {
    const wrapper = mount(CollapsibleSection, { props: { title: '高级设置', hint: '3 项' } })
    expect(wrapper.text()).toContain('3 项')
  })
})

describe('tabBar', () => {
  const tabs = [{ key: 'a', label: '第一' }, { key: 'b', label: '第二' }] as const

  it('marks the active tab for assistive tech', () => {
    const wrapper = mount(TabBar, { props: { modelValue: 'a', tabs: [...tabs] } })
    const buttons = wrapper.findAll('button')
    expect(buttons[0].attributes('aria-current')).toBe('page')
    expect(buttons[1].attributes('aria-current')).toBeUndefined()
  })

  it('emits the selected key', async () => {
    const wrapper = mount(TabBar, { props: { modelValue: 'a', tabs: [...tabs] } })
    await wrapper.findAll('button')[1].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['b']])
  })
})

describe('trendBars', () => {
  it('scales the tallest bar to fit inside the track', () => {
    const wrapper = mount(TrendBars, {
      props: { items: [{ label: 'a', value: 10 }, { label: 'b', value: 5 }], height: 100 },
    })

    const bars = wrapper.findAll('[style*="height"]').filter(node => node.element.tagName === 'DIV')
    const tallest = bars.map(bar => Number.parseInt(bar.attributes('style')!.match(/height:\s*(\d+)px/)![1], 10))
    // The old inline version returned a fixed 112px that could exceed its container.
    expect(Math.max(...tallest)).toBeLessThanOrEqual(100)
  })

  it('does not divide by zero when every value is zero', () => {
    const wrapper = mount(TrendBars, { props: { items: [{ label: 'a', value: 0 }] } })
    expect(wrapper.html()).not.toContain('NaN')
  })
})

describe('statTile / emptyState', () => {
  it('renders label, value and hint', () => {
    const wrapper = mount(StatTile, { props: { label: 'Tokens', value: 42, hint: '今日' } })
    expect(wrapper.text()).toContain('Tokens')
    expect(wrapper.text()).toContain('42')
    expect(wrapper.text()).toContain('今日')
  })

  it('renders the empty-state text', () => {
    const wrapper = mount(EmptyState, { props: { text: '暂无记录' } })
    expect(wrapper.text()).toBe('暂无记录')
  })
})
