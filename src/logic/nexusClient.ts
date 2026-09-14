import { sendRuntimeMessage } from './runtimeMessaging'
import type { AiProviderConfig } from './types'

/**
 * Client half of the Nexus channel.
 *
 * Everything here is token-free by construction: the device flow, the account status and
 * the credit summary all travel as runtime messages, and the worker is the only place a
 * credential ever exists. A content script may import this module; it can never read a
 * token from it, from storage, from settings or from a URL.
 */

/** Canonical Nexus origin. Callers never get to name a host. */
export const NEXUS_BASE_URL = 'https://tuff.tagzxia.com'

/** Provider id in the Lexi provider list; the wire protocol id is `nexus-intelligence`. */
export const NEXUS_PROVIDER_ID = 'tuff-nexus'

export interface NexusDeviceStart {
  deviceCode: string
  userCode: string
  /** Absolute sign-in URL on the canonical origin; the caller opens it in a tab. */
  authorizeUrl: string
  /** ISO timestamp of the device authorization's own expiry (server clock). */
  expiresAt: string
  intervalSeconds: number
}

export type NexusDevicePollStatus
  = | 'pending'
  | 'approved'
  | 'expired'
  | 'cancelled'
  | 'browser_closed'
  | 'rejected'

export interface NexusDevicePollResult {
  status: NexusDevicePollStatus
  /** Human reason the server attached to `rejected`; already bounded and redacted. */
  message?: string
}

export interface NexusAuthStatus {
  signedIn: boolean
  /** Epoch ms of the access token expiry; absent when not signed in. */
  accessTokenExpiresAt?: number
}

export interface NexusCreditBalance {
  quota: number
  used: number
}

export interface NexusCreditSummary {
  /** Accounting month key, e.g. `2026-09`. */
  month: string
  /** The signed-in user's own pool; null when the server reports none. */
  user: NexusCreditBalance | null
  /** The active team pool; null when this account has no team pool. */
  team: NexusCreditBalance | null
}

export type NexusClientErrorKind
  = | 'denied'
  | 'expired'
  | 'unavailable'
  | 'rate-limited'
  | 'invalid'
  | 'unknown'

/** A redacted failure the caller may show as-is; it never carries server text or a token. */
export class NexusClientError extends Error {
  readonly kind: NexusClientErrorKind

  constructor(kind: NexusClientErrorKind, message: string) {
    super(message)
    this.name = 'NexusClientError'
    this.kind = kind
  }
}

/** The worker's reply envelope; the success half holds token-free data only. */
export type NexusRuntimeReply<T>
  = | { ok: true, data: T }
  | { ok: false, error: string, kind: NexusClientErrorKind }

function isRuntimeReply<T>(value: unknown): value is NexusRuntimeReply<T> {
  if (!value || typeof value !== 'object' || !('ok' in value))
    return false

  const reply = value as { ok?: unknown, error?: unknown, kind?: unknown }
  if (reply.ok === true)
    return 'data' in (value as object)

  return reply.ok === false && typeof reply.error === 'string'
}

function readErrorKind(value: unknown): NexusClientErrorKind {
  switch (value) {
    case 'denied':
    case 'expired':
    case 'unavailable':
    case 'rate-limited':
    case 'invalid':
    case 'unknown':
      return value
    default:
      return 'unknown'
  }
}

/**
 * Sends one Nexus command to the worker and unwraps the reply.
 *
 * A rejected send means the worker itself is gone (reload, crash), which is a
 * transport failure rather than an authorization failure.
 */
async function requestNexus<T>(type: Parameters<typeof sendRuntimeMessage>[0], data: unknown): Promise<T> {
  let reply: unknown
  try {
    reply = await sendRuntimeMessage<NexusRuntimeReply<T>>(type, data)
  }
  catch {
    throw new NexusClientError('unavailable', 'Nexus 后台服务未响应，请稍后重试')
  }

  if (!isRuntimeReply<T>(reply))
    throw new NexusClientError('unknown', 'Nexus 返回了无法识别的响应')
  if (!reply.ok)
    throw new NexusClientError(readErrorKind(reply.kind), reply.error || 'Nexus 请求失败')

  return reply.data
}

/** Starts a device authorization; the returned URL is for the caller to open. */
export function startNexusDeviceAuth() {
  return requestNexus<NexusDeviceStart>('lexi-nexus-device-start', undefined)
}

/** Polls one device authorization. Call on the server's `intervalSeconds`. */
export function pollNexusDeviceAuth(deviceCode: string) {
  return requestNexus<NexusDevicePollResult>('lexi-nexus-device-poll', { deviceCode })
}

/**
 * Reads the token-free sign-in state.
 *
 * Never throws: a worker that cannot answer is indistinguishable from "not signed in",
 * and both are safe to render.
 */
export async function getNexusAuthStatus(): Promise<NexusAuthStatus> {
  try {
    const status = await sendRuntimeMessage<NexusAuthStatus>('lexi-nexus-auth-status', undefined)
    if (!status || typeof status !== 'object' || typeof status.signedIn !== 'boolean')
      return { signedIn: false }

    return typeof status.accessTokenExpiresAt === 'number'
      ? { signedIn: status.signedIn, accessTokenExpiresAt: status.accessTokenExpiresAt }
      : { signedIn: status.signedIn }
  }
  catch {
    return { signedIn: false }
  }
}

/** Forgets the local session. The server-side device grant is left for the account page. */
export function logoutNexus() {
  return requestNexus<void>('lexi-nexus-logout', undefined)
}

/** Reads the active credit pools for the signed-in account. */
export function getNexusCredits() {
  return requestNexus<NexusCreditSummary>('lexi-nexus-credits', undefined)
}

/**
 * The provider entry for Nexus.
 *
 * It carries no credential: the adapter asks the worker to sign each request instead.
 * Disabled by default — Nexus is a paid channel, never the default translation engine.
 */
export function createNexusProviderConfig(priority: number): AiProviderConfig {
  return {
    id: NEXUS_PROVIDER_ID,
    label: 'Tuff Nexus',
    endpoint: NEXUS_BASE_URL,
    apiKey: '',
    model: 'auto',
    enabled: false,
    protocol: 'nexus-intelligence',
    priority,
    delayMs: 0,
    updatedAt: Date.now(),
  }
}
