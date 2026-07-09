import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import process from 'node:process'
import fs from 'fs-extra'
import { log, r } from './utils'

type BumpType = 'major' | 'minor' | 'patch'

interface CommitEntry {
  hash: string
  rawSubject: string
  summary: string
  type: string
}

const bumpTypes = new Set<BumpType>(['major', 'minor', 'patch'])
const versionRE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const releaseCommitRE = /^chore\(release\): v\d+\.\d+\.\d+$/i
const changelogTitle = '# Changelog\n\n'

const changelogGroups = [
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['refactor', 'Refactors'],
  ['test', 'Tests'],
  ['docs', 'Docs'],
  ['ci', 'Maintenance'],
  ['build', 'Maintenance'],
  ['chore', 'Maintenance'],
  ['style', 'Maintenance'],
  ['revert', 'Reverts'],
] as const

function git(args: string[]) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function tryGit(args: string[]) {
  try {
    return git(args)
  }
  catch {
    return ''
  }
}

function parseVersion(version: string) {
  const match = version.match(versionRE)
  if (!match)
    throw new Error(`Invalid version "${version}". Use numeric semver like 1.2.3.`)

  return match.slice(1).map(Number) as [number, number, number]
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

function getBumpType(): BumpType {
  const value = process.env.RELEASE_BUMP ?? 'patch'
  if (!bumpTypes.has(value as BumpType))
    throw new Error(`Unsupported RELEASE_BUMP "${value}". Use major, minor, or patch.`)

  return value as BumpType
}

function getLatestVersionTag() {
  return tryGit(['describe', '--tags', '--match', 'v[0-9]*', '--abbrev=0'])
}

function parseCommitLine(line: string): CommitEntry | undefined {
  const [rawSubject = '', hash = ''] = line.split('\t')
  const subject = rawSubject.trim()
  if (!subject || releaseCommitRE.test(subject))
    return undefined

  const separatorIndex = subject.indexOf(':')
  const prefix = separatorIndex >= 0 ? subject.slice(0, separatorIndex) : ''
  const conventional = prefix.match(/^(\w+)(?:\([^)]*\))?!?$/)
  const type = conventional?.[1]?.toLowerCase() ?? 'change'
  const summarySource = conventional && separatorIndex >= 0 ? subject.slice(separatorIndex + 1) : subject
  const summary = summarySource.replace(/\s+/g, ' ').trim()

  return {
    hash,
    rawSubject: subject,
    summary,
    type,
  }
}

function getCommitEntries(latestTag: string) {
  const range = latestTag ? `${latestTag}..HEAD` : 'HEAD'
  const output = tryGit(['log', '--format=%s%x09%h', range])

  return output
    .split('\n')
    .map(parseCommitLine)
    .filter((entry): entry is CommitEntry => Boolean(entry))
}

function getGroupTitle(type: string) {
  return changelogGroups.find(([groupType]) => groupType === type)?.[1] ?? 'Changes'
}

function formatChangelogEntry(version: string, latestTag: string, commits: CommitEntry[]) {
  const grouped = new Map<string, CommitEntry[]>()
  for (const commit of commits) {
    const group = getGroupTitle(commit.type)
    grouped.set(group, [...(grouped.get(group) ?? []), commit])
  }

  const orderedGroups = [...new Set([...changelogGroups.map(([, title]) => title), 'Changes'])]
  const lines = [`## v${version} - ${new Date().toISOString().slice(0, 10)}`, '']
  lines.push(latestTag ? `Changes since ${latestTag}.` : 'Initial automated changelog entry.')

  for (const group of orderedGroups) {
    const entries = grouped.get(group)
    if (!entries?.length)
      continue

    lines.push('', `### ${group}`)
    for (const entry of entries)
      lines.push(`- ${entry.summary} (${entry.hash})`)
  }

  return `${lines.join('\n')}\n`
}

async function prependChangelog(entry: string) {
  const changelogPath = r('CHANGELOG.md')
  const current = await fs.pathExists(changelogPath)
    ? await fs.readFile(changelogPath, 'utf8')
    : ''

  const body = current.startsWith(changelogTitle)
    ? current.slice(changelogTitle.length).trimStart()
    : current.trim()

  const next = body
    ? `${changelogTitle}${entry}\n${body}\n`
    : `${changelogTitle}${entry}`

  await fs.writeFile(changelogPath, next, 'utf8')
}

function writeOutput(values: Record<string, string>) {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath)
    return

  appendFileSync(outputPath, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`)
}

async function main() {
  const pkgPath = r('package.json')
  const pkg = await fs.readJSON(pkgPath) as { version?: string }
  if (!pkg.version)
    throw new Error('package.json is missing version')

  const latestTag = getLatestVersionTag()
  const commits = getCommitEntries(latestTag)
  if (!commits.length) {
    log('RELEASE', 'no commits to release')
    writeOutput({ changed: 'false' })
    return
  }

  const nextVersion = bumpVersion(pkg.version, getBumpType())
  pkg.version = nextVersion
  await fs.writeJSON(pkgPath, pkg, { spaces: 2 })
  await prependChangelog(formatChangelogEntry(nextVersion, latestTag, commits))

  const tag = `v${nextVersion}`
  log('RELEASE', `${latestTag || 'start'} -> ${tag}`)
  writeOutput({
    changed: 'true',
    tag,
    version: nextVersion,
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
