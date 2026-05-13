import process from 'node:process'
import fs from 'fs-extra'
import { log, r } from './utils'

type BumpType = 'major' | 'minor' | 'patch'

const bumpTypes = ['major', 'minor', 'patch'] as const
const versionRE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function usage() {
  console.log(`Usage:
  pnpm run version:bump -- <major|minor|patch|x.y.z>

Examples:
  pnpm version:patch
  pnpm version:minor
  pnpm version:major
  pnpm run version:bump -- 0.1.0
`)
}

function parseVersion(version: string) {
  const match = version.match(versionRE)

  if (!match)
    throw new Error(`Invalid version "${version}". Use numeric semver like 1.2.3.`)

  return match.slice(1).map(Number) as [number, number, number]
}

function isBumpType(value: string): value is BumpType {
  return bumpTypes.includes(value as BumpType)
}

function formatVersion(version: [number, number, number]) {
  return version.join('.')
}

function bumpVersion(current: string, bump: BumpType) {
  const [major, minor, patch] = parseVersion(current)

  if (bump === 'major')
    return formatVersion([major + 1, 0, 0])

  if (bump === 'minor')
    return formatVersion([major, minor + 1, 0])

  return formatVersion([major, minor, patch + 1])
}

function normalizeTargetVersion(input: string) {
  return formatVersion(parseVersion(input))
}

async function main() {
  const input = process.argv.slice(2).find(arg => arg !== '--')

  if (!input || input === '-h' || input === '--help') {
    usage()
    process.exit(input ? 0 : 1)
  }

  const pkgPath = r('package.json')
  const pkg = await fs.readJSON(pkgPath) as { version?: string }
  const currentVersion = pkg.version

  if (!currentVersion)
    throw new Error('package.json is missing version')

  const nextVersion = isBumpType(input)
    ? bumpVersion(currentVersion, input)
    : normalizeTargetVersion(input)

  if (nextVersion === currentVersion)
    throw new Error(`Version is already ${nextVersion}`)

  pkg.version = nextVersion
  await fs.writeJSON(pkgPath, pkg, { spaces: 2 })

  log('VERSION', `${currentVersion} -> ${nextVersion}`)
  log('VERSION', `release tag: v${nextVersion}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
