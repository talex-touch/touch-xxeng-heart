// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import BaseButton from '../BaseButton.vue'
import BaseCheckbox from '../BaseCheckbox.vue'
import BaseInput from '../BaseInput.vue'
import BaseSelect from '../BaseSelect.vue'
import BaseTextarea from '../BaseTextarea.vue'
import FormField from '../FormField.vue'
import RangeControl from '../RangeControl.vue'
import SettingToggle from '../SettingToggle.vue'

describe('formField and base controls', () => {
  it('associates labels, hints and errors with the injected control', () => {
    const wrapper = mount(FormField, {
      props: { label: 'Endpoint', hint: 'OpenAI 兼容地址', error: '地址无效' },
      slots: {
        default: () => h(BaseInput, { modelValue: '' }),
      },
    })

    const input = wrapper.get('input')
    const label = wrapper.get('label')
    expect(label.attributes('for')).toBe(input.attributes('id'))
    expect(input.attributes('aria-describedby')).toContain('-hint')
    expect(input.attributes('aria-describedby')).toContain('-error')
    expect(input.attributes('aria-invalid')).toBe('true')
  })

  it('generates unique ids across field instances', () => {
    const Harness = defineComponent(() => () => h('div', [
      h(FormField, { label: '名称' }, { default: () => h(BaseInput, { modelValue: '' }) }),
      h(FormField, { label: 'Endpoint' }, { default: () => h(BaseInput, { modelValue: '' }) }),
    ]))
    const wrapper = mount(Harness)
    const ids = wrapper.findAll('input').map(input => input.attributes('id'))

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the field label associated when a child passes its own id', () => {
    const wrapper = mount(FormField, {
      props: { id: 'provider-endpoint', label: 'Endpoint' },
      slots: { default: () => h(BaseInput, { id: 'ignored-child-id', modelValue: '' }) },
    })

    expect(wrapper.get('label').attributes('for')).toBe('provider-endpoint')
    expect(wrapper.get('input').attributes('id')).toBe('provider-endpoint')
  })

  it('emits finite, bounded numbers and ignores an empty input', async () => {
    const wrapper = mount(BaseInput, { props: { modelValue: 4, type: 'number', min: 1, max: 10 } })
    const input = wrapper.get('input')
    await input.setValue('8')
    await input.setValue('20')
    await input.setValue('')

    expect(wrapper.emitted('update:modelValue')).toEqual([[8], [10]])
  })

  it('forwards native change events with the input target', async () => {
    let target: EventTarget | null = null
    const wrapper = mount(BaseInput, {
      props: { modelValue: 'https://api.example.com' },
      attrs: { onChange: (event: Event) => target = event.target },
    })
    await wrapper.get('input').trigger('change')

    expect(target).toBe(wrapper.element)
  })

  it('updates select and textarea values', async () => {
    const select = mount(BaseSelect, {
      props: { modelValue: 'auto' },
      slots: { default: '<option value="auto">自动</option><option value="site">站点</option>' },
    })
    await select.get('select').setValue('site')
    expect(select.emitted('update:modelValue')).toEqual([['site']])

    const textarea = mount(BaseTextarea, { props: { modelValue: '' } })
    await textarea.setValue('new prompt')
    expect(textarea.emitted('update:modelValue')).toEqual([['new prompt']])
  })

  it('exposes native checkbox semantics and emits changes', async () => {
    const wrapper = mount(BaseCheckbox, { props: { modelValue: false, label: '启用' } })
    const input = wrapper.get('input')
    expect(input.attributes('type')).toBe('checkbox')
    await input.setValue(true)
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
  })

  it('updates root attrs after mount', async () => {
    const className = ref('state-one')
    const Harness = defineComponent(() => () => h(BaseCheckbox, {
      modelValue: false,
      label: '启用',
      class: className.value,
    }))
    const wrapper = mount(Harness)
    expect(wrapper.get('label').classes()).toContain('state-one')

    className.value = 'state-two'
    await nextTick()
    expect(wrapper.get('label').classes()).toContain('state-two')
    expect(wrapper.get('label').classes()).not.toContain('state-one')
  })

  it('associates switch hints with the switch control', () => {
    const wrapper = mount(SettingToggle, {
      props: { modelValue: false, label: '总开关', hint: '关闭后不替换。' },
    })
    const hint = wrapper.get('small')

    expect(wrapper.get('[role="switch"]').attributes('aria-describedby')).toBe(hint.attributes('id'))
  })

  it('updates ranges as numbers and displays the formatted value', async () => {
    const wrapper = mount(RangeControl, {
      props: { modelValue: 0.2, min: 0, max: 1, step: 0.1, label: '密度', displayValue: '20%' },
    })
    expect(wrapper.get('output').text()).toBe('20%')
    await wrapper.get('input').setValue('0.4')
    expect(wrapper.emitted('update:modelValue')).toEqual([[0.4]])
  })
})

describe('baseButton', () => {
  it('defaults to a non-submitting button', () => {
    const wrapper = mount(BaseButton, { slots: { default: '保存' } })
    expect(wrapper.attributes('type')).toBe('button')
  })

  it('keeps its accessible name while loading', () => {
    const wrapper = mount(BaseButton, { props: { loading: true }, slots: { default: '测试连接' } })
    expect(wrapper.attributes('aria-busy')).toBe('true')
    expect(wrapper.attributes('aria-label')).toBe('处理中')
    expect(wrapper.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('测试连接')
  })
})
