import { sendRuntimeMessage } from './runtimeMessaging'
import type { TranslationDirection, TranslationEngineConfig } from './types'

export interface TranslationEngineResponse {
  text: string
  engineId: string
  engineLabel: string
}

export function translateWithConfiguredEngines(text: string, direction: TranslationDirection) {
  return sendRuntimeMessage<TranslationEngineResponse, { text: string, direction: TranslationDirection }>(
    'lexi-translate-text',
    { text, direction },
  )
}

export function testConfiguredTranslationEngine(engine: TranslationEngineConfig) {
  return sendRuntimeMessage<TranslationEngineResponse, TranslationEngineConfig>(
    'lexi-test-translation-engine',
    engine,
  )
}
