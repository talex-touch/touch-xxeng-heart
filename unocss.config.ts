import { defineConfig } from 'unocss/vite'
import { presetAttributify, presetIcons, presetUno, transformerDirectives } from 'unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons(),
  ],
  transformers: [
    transformerDirectives(),
  ],
  // Lexi design tokens (DESIGN.md): utility classes stay readable while every
  // semantic color goes through one palette instead of ad-hoc neutral-*/blue-*.
  theme: {
    colors: {
      lexi: {
        'accent': '#2f6fed',
        'accent-hover': '#255fcf',
        'accent-soft': '#eaf1fe',
        'ink': '#171a20',
        'ink-2': '#5a6270',
        'ink-3': '#697384',
        'border': '#e7e9ee',
        'canvas': '#f4f6f8',
        'subtle': '#f5f7fa',
        'danger': '#b9382e',
        'danger-soft': '#fbeeec',
      },
    },
  },
})
