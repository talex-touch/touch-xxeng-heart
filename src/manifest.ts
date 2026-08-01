import fs from 'fs-extra'
import type { Manifest } from 'webextension-polyfill'
import type PkgType from '../package.json'
import { isBeta, isDev, isFirefox, r } from '../scripts/utils'

type ChromiumManifest = Manifest.WebExtensionManifest & {
  side_panel?: {
    default_path: string
  }
}

const extensionIcons = {
  16: 'assets/icon-16.png',
  48: 'assets/icon-48.png',
  128: 'assets/icon-128.png',
  512: 'assets/icon-512.png',
}

export async function getManifest() {
  const pkg = await fs.readJSON(r('package.json')) as typeof PkgType

  // update this file to update this manifest.json
  // can also be conditional based on your need
  const manifest: ChromiumManifest = {
    manifest_version: 3,
    name: isBeta ? `${pkg.displayName || pkg.name} BETA` : pkg.displayName || pkg.name,
    version: pkg.version,
    description: isBeta ? `${pkg.description} THIS EXTENSION IS FOR BETA TESTING.` : pkg.description,
    minimum_chrome_version: '114',
    action: {
      default_icon: extensionIcons,
      default_popup: 'dist/popup/index.html',
    },
    options_ui: {
      page: 'dist/options/index.html',
      open_in_tab: true,
    },
    background: isFirefox
      ? {
          scripts: ['dist/background/index.mjs'],
          type: 'module',
        }
      : {
          service_worker: 'dist/background/index.mjs',
        },
    icons: extensionIcons,
    permissions: [
      'storage',
      'contextMenus',
      'downloads',
      ...isFirefox ? [] : ['sidePanel'],
    ],
    host_permissions: ['http://*/*', 'https://*/*'],
    content_scripts: [
      {
        matches: [
          'http://*/*',
          'https://*/*',
        ],
        match_about_blank: true,
        run_at: 'document_start',
        js: [
          'dist/contentScripts/index.global.js',
        ],
      },
      {
        matches: [
          'http://*/*',
          'https://*/*',
        ],
        all_frames: true,
        match_about_blank: true,
        run_at: 'document_start',
        js: [
          'dist/contentScripts/frame.global.js',
        ],
      },
    ],
    web_accessible_resources: [
      {
        resources: ['dist/contentScripts/style.css'],
        matches: ['http://*/*', 'https://*/*'],
      },
    ],
    content_security_policy: {
      extension_pages: 'script-src \'self\'; object-src \'self\'',
    },
  }

  // add sidepanel
  if (isFirefox) {
    manifest.sidebar_action = {
      default_panel: 'dist/sidepanel/index.html',
    }
  }
  else {
    // the sidebar_action does not work for chromium based
    ;(manifest as ChromiumManifest).side_panel = {
      default_path: 'dist/sidepanel/index.html',
    }
  }

  // FIXME: not work in MV3
  if (isDev && false) {
    // for content script, as browsers will cache them for each reload,
    // we use a background script to always inject the latest version
    // see src/background/contentScriptHMR.ts
    delete manifest.content_scripts
    manifest.permissions?.push('webNavigation')
  }

  return manifest
}
