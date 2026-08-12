import type { AiChatMessage, ChatMessageContent, ProviderModel } from './providers'
import type { AiProviderConfig, AiTestResult, FeatureScene } from './types'

/**
 * The one channel between a page's world and the AI backends.
 *
 * Requests carry a scene and a message list — never an endpoint, a plan or a credential.
 * The worker resolves the provider, attaches auth and talks to the network, so a content
 * script holds nothing worth stealing and CORS never applies to the call that matters.
 */
export const aiPortName = 'lexi-ai'

export interface AiRunCommand {
  type: 'run'
  scene: FeatureScene
  messages: AiChatMessage[]
  /** Replaces the scene prompt when a caller needs a task-specific system message. */
  system?: string
}

/**
 * A provider is passed in only when the editor is testing one it has not saved yet;
 * omitting it tests whatever provider the scene is currently bound to.
 */
export interface AiTestCommand {
  type: 'test'
  scene: FeatureScene
  provider?: AiProviderConfig
  user: ChatMessageContent
}

export interface AiModelsCommand {
  type: 'models'
  provider: AiProviderConfig
}

export type AiCommand = AiRunCommand | AiTestCommand | AiModelsCommand

export type AiEvent =
  /** Assistant text so far, not the increment: callers render it as-is. */
  | { type: 'delta', text: string }
  | { type: 'done', text: string, streamed: boolean }
  | { type: 'test', result: AiTestResult }
  | { type: 'models', models: ProviderModel[] }
  /** Scene disabled or no provider configured — a non-answer, not a failure. */
  | { type: 'empty' }
  | { type: 'error', message: string, name?: string }
