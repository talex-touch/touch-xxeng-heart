import { defineConfig } from 'vite'
import { isDev, r } from './scripts/utils'
import packageJson from './package.json'

export default defineConfig({
  define: {
    '__DEV__': isDev,
    '__NAME__': JSON.stringify(packageJson.name),
    '__VERSION__': JSON.stringify(packageJson.version),
    'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
  },
  build: {
    watch: isDev ? {} : undefined,
    outDir: r('extension/dist/contentScripts'),
    emptyOutDir: false,
    sourcemap: isDev ? 'inline' : false,
    lib: {
      entry: r('src/contentScripts/frame.ts'),
      name: `${packageJson.name}-frame`,
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        entryFileNames: 'frame.global.js',
        extend: true,
      },
    },
  },
})
