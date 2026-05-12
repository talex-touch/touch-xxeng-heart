import type { ProtocolWithReturn } from 'webext-bridge'
import type { PageTranslationCache, SelectionTranslation } from './src/logic/types'

declare module 'webext-bridge' {
  export interface ProtocolMap {
    // define message protocol types
    // see https://github.com/antfu/webext-bridge#type-safe-protocols
    'tab-prev': { title: string | undefined }
    'get-current-tab': ProtocolWithReturn<{ tabId: number }, { title?: string }>
    'lexi-context-translate': {
      text: string
      pageUrl?: string
      pageTitle?: string
      position?: { x: number, y: number }
    }
    'lexi-selection-translated': SelectionTranslation
    'lexi-page-translate-start': ProtocolWithReturn<Record<string, never>, { ok: boolean, message: string, blocks?: number }>
    'lexi-page-translate-stop': ProtocolWithReturn<Record<string, never>, { ok: boolean, message: string }>
    'lexi-page-translate-status': ProtocolWithReturn<Record<string, never>, { ok: boolean, enabled: boolean, blocks: number, cached: boolean, bytes: number }>
    'lexi-page-translation-updated': PageTranslationCache
  }
}
