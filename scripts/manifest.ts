import process from 'node:process'
import { pathToFileURL } from 'node:url'
import fs from 'fs-extra'
import { getManifest } from '../src/manifest'
import { log, r } from './utils'

export async function writeManifest() {
  await fs.writeJSON(r('extension/manifest.json'), await getManifest(), { spaces: 2 })
  log('PRE', 'write manifest.json')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeManifest().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
