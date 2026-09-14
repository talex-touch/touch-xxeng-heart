import type { AiChatMessage, ChatMessageContent, ProviderModel } from './providers'
import type { AiProviderConfig, AiTestResult, FeatureScene, TranslationDirection } from './types'

/**
 * The one channel between a page's world and the AI backends.
 *
 * Requests carry a scene and a message list — never an endpoint, a plan or a credential.
 * The worker resolves the provider, attaches auth and talks to the network, so a content
 * script holds nothing worth stealing and CORS never applies to the call that matters.
 */
export const aiPortName = 'lexi-ai'

/** One unit of direct translation work: the text and the id its answer must keep. */
export interface DirectTranslationItem {
  id: string
  text: string
}

/**
 * Marks a turn as translation of known items rather than a free-form prompt.
 *
 * A Nexus provider must answer this through the translation capability, item by item, and
 * return only the items it actually translated. Callers that cannot satisfy the descriptor
 * fall back to the ordinary prompt path, which is why the messages stay attached.
 */
export interface DirectTranslationDescriptor {
  items: DirectTranslationItem[]
  direction: TranslationDirection
  /** `text` returns the single item's translation; `items-json` returns `{"items":[…]}`. */
  output: 'text' | 'items-json'
}

export interface AiRunCommand {
  type: 'run'
  scene: FeatureScene
  messages: AiChatMessage[]
  /** Replaces the scene prompt when a caller needs a task-specific system message. */
  system?: string
  /** Translation work uses the shared translation queue rather than the generic AI queue. */
  translation?: boolean
  /** Set when the turn is direct translation; the worker may answer per item. */
  directTranslation?: DirectTranslationDescriptor
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
