import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { r } from './utils'

const brandDir = r('brand/favicon-kit')

interface BrandManifest {
  files: Array<{
    path: string
    bytes: number
    sha256: string
  }>
}

const assetCopies = [
  ['favicon-16.png', 'extension/assets/icon-16.png'],
  ['favicon-48.png', 'extension/assets/icon-48.png'],
  ['favicon-128.png', 'extension/assets/icon-128.png'],
  ['favicon-512.png', 'extension/assets/icon-512.png'],
  ['favicon-512.png', 'lexi-store-icon.png'],
  ['favicon-128.png', 'src/assets/logo.png'],
  ['favicon.ico', 'apps/site/public/favicon.ico'],
  ['favicon-16.png', 'apps/site/public/favicon-16.png'],
  ['favicon-32.png', 'apps/site/public/favicon-32.png'],
  ['favicon-180.png', 'apps/site/public/apple-touch-icon.png'],
  ['favicon-128.png', 'apps/site/public/assets/icon.png'],
] as const

function sha256(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function validateBrandKit() {
  const manifestPath = `${brandDir}/favicon-manifest.json`
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BrandManifest
  const mismatches: string[] = []

  for (const file of manifest.files) {
    const path = `${brandDir}/${file.path}`

    if (!existsSync(path)) {
      mismatches.push(`${file.path} is missing`)
      continue
    }

    if (statSync(path).size !== file.bytes || sha256(path) !== file.sha256)
      mismatches.push(`${file.path} does not match favicon-manifest.json`)
  }

  if (mismatches.length > 0)
    throw new Error(`Canonical brand kit validation failed:\n${mismatches.map(message => `- ${message}`).join('\n')}`)
}

export function syncBrandAssets({ check = false } = {}) {
  validateBrandKit()

  const mismatches: string[] = []

  for (const [sourceName, targetName] of assetCopies) {
    const source = `${brandDir}/${sourceName}`
    const target = r(targetName)

    if (!existsSync(source))
      throw new Error(`Missing canonical brand asset: ${source}`)

    if (check) {
      if (!existsSync(target) || sha256(source) !== sha256(target))
        mismatches.push(targetName)
      continue
    }

    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
  }

  if (mismatches.length > 0)
    throw new Error(`Brand assets are out of sync:\n${mismatches.map(path => `- ${path}`).join('\n')}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  syncBrandAssets({ check: process.argv.includes('--check') })
