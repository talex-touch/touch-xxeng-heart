import { execFileSync } from 'node:child_process'
import process from 'node:process'
import chokidar from 'chokidar'
import { syncBrandAssets } from './sync-brand-assets'
import { isDev, r } from './utils'

const manifestArgs = ['exec', 'esno', './scripts/manifest.ts']

function writeManifest() {
  const command = process.platform === 'win32'
    ? process.env.ComSpec || 'cmd.exe'
    : 'pnpm'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `pnpm ${manifestArgs.join(' ')}`]
    : manifestArgs

  execFileSync(command, args, {
    cwd: r(),
    stdio: 'inherit',
  })
}

writeManifest()

if (isDev) {
  chokidar.watch([r('src/manifest.ts'), r('package.json')])
    .on('change', writeManifest)

  chokidar.watch(r('brand/favicon-kit'), { ignoreInitial: true })
    .on('all', () => {
      syncBrandAssets()
    })
}
