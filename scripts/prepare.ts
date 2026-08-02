import { execSync } from 'node:child_process'
import chokidar from 'chokidar'
import { syncBrandAssets } from './sync-brand-assets'
import { isDev, r } from './utils'

function writeManifest() {
  execSync('npx esno ./scripts/manifest.ts', { stdio: 'inherit' })
}

syncBrandAssets()
writeManifest()

if (isDev) {
  chokidar.watch([r('src/manifest.ts'), r('package.json')])
    .on('change', () => {
      writeManifest()
    })

  chokidar.watch(r('brand/favicon-kit'), { ignoreInitial: true })
    .on('all', () => {
      syncBrandAssets()
    })
}
