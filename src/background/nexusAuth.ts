import browser from 'webextension-polyfill'
import { NEXUS_BASE_URL } from '~/logic/nexusClient'
import type {
  NexusAuthStatus,
  NexusClientErrorKind,
  NexusCreditBalance,
  NexusCreditSummary,
  NexusDevicePollResult,
  NexusDevicePollStatus,
  NexusDeviceStart,
  NexusRuntimeReply,
} from '~/logic/nexusClient'
import { listenRuntimeMessage } from '~/logic/runtimeMessaging'
import { nexusDeviceIdStorageKey, nexusTokenBundleStorageKey } from '~/logic/storageKeys'

/**
 * Worker half of the Nexus channel.
 *
 * The tokens live here and nowhere else: `storage.session` (trusted contexts only, wiped
 * when the browser closes) with a plain in-memory fallback for browsers that lack it.
 * Nothing in this module logs, returns or stores a credential anywhere else — callers get
 * token-free state and an authorized fetch that attaches the bearer itself.
 */

/** Refresh this long before the access token expires, so a request never races the clock. */
const REFRESH_SKEW_MS = 5 * 60 * 1000
const DEVICE_REQUEST_TIMEOUT_MS = 15_000
const CREDITS_REQUEST_TIMEOUT_MS = 15_000
const MIN_POLL_INTERVAL_SECONDS = 1
const MAX_POLL_INTERVAL_SECONDS = 60
const DEFAULT_POLL_INTERVAL_SECONDS = 3
const MAX_SERVER_MESSAGE_LENGTH = 200
const MAX_IDENTIFIER_LENGTH = 256

export interface NexusTokenBundle {
  accessToken: string
  refreshToken: string
  /** Epoch ms, derived from the server's `ttlSeconds`. */
  accessExpiresAt: number
  /** Epoch ms, derived from the server's `refreshTtlSeconds`. */
  refreshExpiresAt: number
  obtainedAt: number
}

export type NexusAuthErrorKind = 'no-token' | 'unauthorized' | 'transient' | 'rate-limited' | 'invalid'

/** A bounded failure. Its message is safe to show and never contains server text or a token. */
export class NexusAuthError extends Error {
  readonly kind: NexusAuthErrorKind

  constructor(kind: NexusAuthErrorKind, message: string) {
    super(message)
    this.name = 'NexusAuthError'
    this.kind = kind
  }
}

/** What the browser gives us for `storage.session`; the polyfill does not type it. */
interface NexusSessionArea {
  get: (key: string) => Promise<Record<string, unknown> | undefined>
  set: (items: Record<string, unknown>) => Promise<void>
  remove: (key: string) => Promise<void>
  setAccessLevel?: (options: { accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }) => Promise<void>
}

/**
 * In-memory mirror of the last valid bundle.
 *
 * The session area is the primary home; this holds the same bundle so an unreadable
 * session area (or a browser without one) still answers with the latest good state.
 * It is process memory only — nothing here is written anywhere else.
 */
let volatileBundle: NexusTokenBundle | null = null
let trustedAccessLevelRequested = false
let refreshInFlight: Promise<NexusTokenBundle> | null = null
let deviceIdInFlight: Promise<string> | null = null

function getSessionArea(): NexusSessionArea | null {
  const area = (browser.storage as unknown as { session?: Partial<NexusSessionArea> }).session
  if (!area || typeof area.get !== 'function' || typeof area.set !== 'function' || typeof area.remove !== 'function')
    return null

  return area as NexusSessionArea
}

/**
 * Pins the session area to trusted contexts.
 *
 * That is already the default, so this is a declaration rather than a fix: a content
 * script must not be able to read a token even if a future browser widens the default.
 */
function requestTrustedAccessLevel(area: NexusSessionArea) {
  if (trustedAccessLevelRequested || typeof area.setAccessLevel !== 'function')
    return

  trustedAccessLevelRequested = true
  void Promise.resolve(area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })).catch(() => {})
}

function normalizeTokenBundle(value: unknown): NexusTokenBundle | null {
  if (!value || typeof value !== 'object')
    return null

  const source = value as Record<string, unknown>
  const accessToken = readIdentifier(source.accessToken, 4096)
  const refreshToken = readIdentifier(source.refreshToken, 4096)
  const accessExpiresAt = readTimestamp(source.accessExpiresAt)
  const refreshExpiresAt = readTimestamp(source.refreshExpiresAt)
  const obtainedAt = readTimestamp(source.obtainedAt)
  if (!accessToken || !refreshToken || !accessExpiresAt || !refreshExpiresAt || !obtainedAt)
    return null

  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, obtainedAt }
}

async function readTokenBundle(): Promise<NexusTokenBundle | null> {
  const area = getSessionArea()
  if (!area)
    return volatileBundle

  requestTrustedAccessLevel(area)
  try {
    const stored = await area.get(nexusTokenBundleStorageKey)
    const bundle = normalizeTokenBundle(stored?.[nexusTokenBundleStorageKey])
    if (!bundle)
      return volatileBundle

    volatileBundle = bundle
    return bundle
  }
  catch {
    return volatileBundle
  }
}

async function writeTokenBundle(bundle: NexusTokenBundle) {
  volatileBundle = bundle

  const area = getSessionArea()
  if (!area)
    return

  requestTrustedAccessLevel(area)
  try {
    await area.set({ [nexusTokenBundleStorageKey]: bundle })
  }
  catch {
    // The mirror set above already holds this bundle.
  }
}

export async function clearNexusAuth(): Promise<void> {
  volatileBundle = null
  const area = getSessionArea()
  if (!area)
    return

  try {
    await area.remove(nexusTokenBundleStorageKey)
  }
  catch {
    // An unreadable session area holds nothing we can trust anyway.
  }
}

/**
 * True when the text carries a control character or any Unicode whitespace.
 *
 * Identifier checks compare code points instead of using a control-character range
 * in a regular expression, and `trim()` catches the full Unicode whitespace set.
 */
function hasIdentifierBreakingCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code <= 0x1F || code === 0x7F || character.trim() === '')
      return true
  }

  return false
}

function readIdentifier(value: unknown, maxLength = MAX_IDENTIFIER_LENGTH): string | null {
  if (typeof value !== 'string')
    return null

  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength || hasIdentifierBreakingCharacter(trimmed))
    return null

  return trimmed
}

function readTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null
}

function readSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null
}

function readExpiresAt(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0)
    return new Date(value).toISOString()

  if (typeof value !== 'string')
    return null

  return Number.isNaN(Date.parse(value)) ? null : value
}

/** Resolves a server-supplied link, refusing any origin other than the canonical one. */
function resolveCanonicalNexusUrl(value: string): string | null {
  try {
    const url = new URL(value, NEXUS_BASE_URL)
    return url.origin === NEXUS_BASE_URL ? url.toString() : null
  }
  catch {
    return null
  }
}

/** Turns every control character into a space so server text cannot smuggle line breaks. */
function blankControlCharacters(value: string): string {
  let result = ''
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    result += code <= 0x1F || code === 0x7F ? ' ' : character
  }

  return result
}

/**
 * Strips control characters and anything shaped like a JWT from a server message.
 *
 * The worker may pass a rejection reason through to the UI, so it is bounded twice:
 * length, and credential-looking runs — a device code must never ride along.
 */
function sanitizeServerMessage(value: unknown): string | undefined {
  if (typeof value !== 'string')
    return undefined

  const cleaned = blankControlCharacters(value)
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned)
    return undefined

  const redacted = cleaned.replace(/[\w-]{20,}\.[\w-]{10,}\.[\w-]{10,}/g, '[已隐藏]')
  return redacted.length > MAX_SERVER_MESSAGE_LENGTH ? `${redacted.slice(0, MAX_SERVER_MESSAGE_LENGTH)}…` : redacted
}

function isAbortFailure(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
}

/** Collapses anything thrown below into one of five bounded, redacted failures. */
function toNexusAuthError(error: unknown): NexusAuthError {
  if (error instanceof NexusAuthError)
    return error

  return isAbortFailure(error)
    ? new NexusAuthError('transient', 'Nexus 请求超时，请稍后再试')
    : new NexusAuthError('transient', '无法连接 Nexus 服务')
}

function nexusHttpFailure(status: number): NexusAuthError {
  if (status === 429)
    return new NexusAuthError('rate-limited', 'Nexus 请求过于频繁，请稍后再试')
  if (status === 401 || status === 403)
    return new NexusAuthError('unauthorized', 'Nexus 授权已失效，请重新登录')
  if (status >= 500)
    return new NexusAuthError('transient', `Nexus 服务暂时不可用（HTTP ${status}）`)

  return new NexusAuthError('invalid', `Nexus 拒绝了这次请求（HTTP ${status}）`)
}

function startRequestClock(upstream: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const forwardAbort = () => controller.abort()

  if (upstream) {
    if (upstream.aborted)
      controller.abort()
    else
      upstream.addEventListener('abort', forwardAbort, { once: true })
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      upstream?.removeEventListener('abort', forwardAbort)
    },
  }
}

/**
 * One unauthenticated device-flow request.
 *
 * Cookies are withheld and redirects are refused so a compromised or misrouted response
 * cannot carry the session anywhere: Nexus answers these two routes directly.
 */
async function sendDeviceRequest(path: string, init: { method: 'GET' | 'POST', body?: string, timeoutMs: number }): Promise<unknown> {
  const clock = startRequestClock(undefined, init.timeoutMs)
  try {
    const response = await fetch(`${NEXUS_BASE_URL}${path}`, {
      method: init.method,
      headers: init.body ? { 'content-type': 'application/json' } : undefined,
      body: init.body,
      credentials: 'omit',
      redirect: 'error',
      signal: clock.signal,
    })
    if (!response.ok)
      throw nexusHttpFailure(response.status)

    try {
      return await response.json()
    }
    catch {
      throw new NexusAuthError('invalid', 'Nexus 返回了无法解析的响应')
    }
  }
  catch (error) {
    throw toNexusAuthError(error)
  }
  finally {
    clock.dispose()
  }
}

function createRandomIdentifier(): string {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi)
    throw new NexusAuthError('transient', '当前环境无法生成设备标识')

  if (typeof cryptoApi.randomUUID === 'function')
    return cryptoApi.randomUUID()

  const bytes = new Uint8Array(16)
  cryptoApi.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

async function loadOrCreateNexusDeviceId(): Promise<string> {
  const stored = await browser.storage.local.get(nexusDeviceIdStorageKey)
  const existing = readIdentifier(stored?.[nexusDeviceIdStorageKey])
  if (existing)
    return existing

  const created = createRandomIdentifier()
  await browser.storage.local.set({ [nexusDeviceIdStorageKey]: created })
  return created
}

/** One id per profile, resolved once even if two device flows start together. */
function resolveNexusDeviceId(): Promise<string> {
  if (!deviceIdInFlight) {
    deviceIdInFlight = loadOrCreateNexusDeviceId().catch((error) => {
      deviceIdInFlight = null
      throw toNexusAuthError(error)
    })
  }

  return deviceIdInFlight
}

function decodeDeviceStart(payload: unknown): NexusDeviceStart {
  const source = (payload ?? {}) as Record<string, unknown>
  const deviceCode = readIdentifier(source.deviceCode)
  const userCode = readIdentifier(source.userCode)
  const authorizeUrl = typeof source.authorizeUrl === 'string' ? resolveCanonicalNexusUrl(source.authorizeUrl) : null
  const expiresAt = readExpiresAt(source.expiresAt)
  if (!deviceCode || !userCode || !authorizeUrl || !expiresAt)
    throw new NexusAuthError('invalid', 'Nexus 设备授权响应不完整')

  const requestedInterval = readSeconds(source.intervalSeconds) ?? DEFAULT_POLL_INTERVAL_SECONDS
  return {
    deviceCode,
    userCode,
    authorizeUrl,
    expiresAt,
    intervalSeconds: Math.min(Math.max(requestedInterval, MIN_POLL_INTERVAL_SECONDS), MAX_POLL_INTERVAL_SECONDS),
  }
}

const devicePollStatuses: Record<NexusDevicePollStatus, true> = {
  pending: true,
  approved: true,
  expired: true,
  cancelled: true,
  browser_closed: true,
  rejected: true,
}

function decodeDevicePoll(payload: unknown): NexusDevicePollResult {
  const source = (payload ?? {}) as Record<string, unknown>
  const status = source.status
  if (typeof status !== 'string' || !Object.prototype.hasOwnProperty.call(devicePollStatuses, status))
    throw new NexusAuthError('invalid', 'Nexus 返回了未知的设备授权状态')

  const message = sanitizeServerMessage(source.message)
  return message
    ? { status: status as NexusDevicePollStatus, message }
    : { status: status as NexusDevicePollStatus }
}

/** Stores an approval. Expiries come from the server's own ttl fields, never from a guess. */
async function persistApprovedTokens(payload: unknown): Promise<void> {
  const source = (payload ?? {}) as Record<string, unknown>
  const accessToken = readIdentifier(source.appToken, 4096)
  const refreshToken = readIdentifier(source.refreshToken, 4096)
  const ttlSeconds = readSeconds(source.ttlSeconds)
  const refreshTtlSeconds = readSeconds(source.refreshTtlSeconds)
  if (!accessToken || !refreshToken || !ttlSeconds || !refreshTtlSeconds)
    throw new NexusAuthError('invalid', 'Nexus 返回的授权信息不完整')

  const now = Date.now()
  await writeTokenBundle({
    accessToken,
    refreshToken,
    accessExpiresAt: now + ttlSeconds * 1000,
    refreshExpiresAt: now + refreshTtlSeconds * 1000,
    obtainedAt: now,
  })
}

export async function startNexusDeviceAuthorization(): Promise<NexusDeviceStart> {
  const deviceId = await resolveNexusDeviceId()
  const payload = await sendDeviceRequest('/api/app-auth/device/start', {
    method: 'POST',
    body: JSON.stringify({ deviceId, clientType: 'external' }),
    timeoutMs: DEVICE_REQUEST_TIMEOUT_MS,
  })
  return decodeDeviceStart(payload)
}

export async function pollNexusDeviceAuthorization(deviceCode: string): Promise<NexusDevicePollResult> {
  const code = readIdentifier(deviceCode)
  if (!code)
    throw new NexusAuthError('invalid', '设备授权码无效，请重新登录')

  const payload = await sendDeviceRequest(`/api/app-auth/device/poll?device_code=${encodeURIComponent(code)}`, {
    method: 'GET',
    timeoutMs: DEVICE_REQUEST_TIMEOUT_MS,
  })
  const approval = ((payload ?? {}) as Record<string, unknown>).status === 'approved'
  if (approval) {
    await persistApprovedTokens(payload)
    return { status: 'approved' }
  }

  return decodeDevicePoll(payload)
}

/**
 * Exchanges the refresh token for a new access token.
 *
 * A refusal means the grant is gone, so both halves are dropped; a transport or 5xx
 * failure is not the account's fault, so the bundle survives and the caller decides.
 * The refresh token itself does not rotate, so its original expiry still stands.
 */
async function performNexusRefresh(current: NexusTokenBundle): Promise<NexusTokenBundle> {
  const clock = startRequestClock(undefined, DEVICE_REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${NEXUS_BASE_URL}/api/app-auth/refresh`, {
      method: 'POST',
      headers: { authorization: `Bearer ${current.refreshToken}` },
      credentials: 'omit',
      redirect: 'error',
      signal: clock.signal,
    })
  }
  catch (error) {
    throw toNexusAuthError(error)
  }
  finally {
    clock.dispose()
  }

  if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 422) {
    await clearNexusAuth()
    throw new NexusAuthError('unauthorized', 'Nexus 登录已失效，请重新登录')
  }

  if (!response.ok)
    throw nexusHttpFailure(response.status)

  let payload: unknown
  try {
    payload = await response.json()
  }
  catch {
    payload = null
  }

  const accessToken = readIdentifier((payload as Record<string, unknown> | null)?.appToken, 4096)
  const ttlSeconds = readSeconds((payload as Record<string, unknown> | null)?.ttlSeconds)
  if (!accessToken || !ttlSeconds) {
    await clearNexusAuth()
    throw new NexusAuthError('unauthorized', 'Nexus 登录已失效，请重新登录')
  }

  const refreshed: NexusTokenBundle = {
    ...current,
    accessToken,
    accessExpiresAt: Date.now() + ttlSeconds * 1000,
  }
  await writeTokenBundle(refreshed)
  return refreshed
}

/** Concurrent callers share one refresh; a rejected one clears state exactly once. */
function refreshNexusTokens(current: NexusTokenBundle): Promise<NexusTokenBundle> {
  if (!refreshInFlight) {
    refreshInFlight = performNexusRefresh(current).finally(() => {
      refreshInFlight = null
    })
  }

  return refreshInFlight
}

/** Returns a usable bundle, refreshing ahead of expiry; throws when the session is gone. */
async function ensureAccessBundle(): Promise<NexusTokenBundle> {
  const bundle = await readTokenBundle()
  if (!bundle)
    throw new NexusAuthError('no-token', '尚未登录 Nexus')

  if (bundle.accessExpiresAt - Date.now() > REFRESH_SKEW_MS)
    return bundle

  if (bundle.refreshExpiresAt <= Date.now()) {
    await clearNexusAuth()
    throw new NexusAuthError('unauthorized', 'Nexus 登录已过期，请重新登录')
  }

  return refreshNexusTokens(bundle)
}

export interface NexusFetchInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: string
  headers?: Record<string, string>
  signal?: AbortSignal
}

/**
 * Turns a caller's path into a canonical-origin request URL.
 *
 * Only relative `/api/` paths are accepted: an absolute URL, a protocol-relative host or
 * anything carrying whitespace or a fragment is refused rather than resolved, so this
 * function can never be pointed at another server.
 */
function resolveNexusApiUrl(path: string): string {
  if (typeof path !== 'string' || !path.startsWith('/api/') || path.startsWith('//') || /[\s\\#]/.test(path))
    throw new NexusAuthError('invalid', 'Nexus 请求路径不合法')

  let url: URL
  try {
    url = new URL(path, NEXUS_BASE_URL)
  }
  catch {
    throw new NexusAuthError('invalid', 'Nexus 请求路径不合法')
  }

  if (url.origin !== NEXUS_BASE_URL || !url.pathname.startsWith('/api/'))
    throw new NexusAuthError('invalid', 'Nexus 请求路径不合法')

  return url.toString()
}

function buildAuthorizedRequest(bundle: NexusTokenBundle, init: NexusFetchInit | undefined): RequestInit {
  const method = init?.method ?? 'GET'
  const headers = new Headers()
  for (const [name, value] of Object.entries(init?.headers ?? {}))
    headers.set(name, value)

  // Set last so a caller cannot replace it, and rebuilt per attempt so a retry never
  // reuses a header object that already saw a token.
  headers.set('authorization', `Bearer ${bundle.accessToken}`)

  const allowBody = method !== 'GET' && method !== 'DELETE'
  return {
    method,
    headers,
    body: allowBody ? init?.body : undefined,
    credentials: 'omit',
    redirect: 'error',
    signal: init?.signal,
  }
}

/**
 * The only way an authorized Nexus call may be made.
 *
 * The caller names a relative path; the bearer is attached here, ahead of expiry, and
 * after a 401 exactly one refresh-and-retry follows. Nothing about the token — value,
 * hint or expiry — is ever returned to the caller.
 */
export async function nexusAuthorizedFetch(path: string, init?: NexusFetchInit): Promise<Response> {
  const url = resolveNexusApiUrl(path)
  const bundle = await ensureAccessBundle()

  let response: Response
  try {
    response = await fetch(url, buildAuthorizedRequest(bundle, init))
  }
  catch (error) {
    throw toNexusAuthError(error)
  }

  if (response.status !== 401)
    return response

  const latest = await readTokenBundle()
  if (latest && latest.accessToken !== bundle.accessToken && latest.accessExpiresAt > Date.now()) {
    try {
      return await fetch(url, buildAuthorizedRequest(latest, init))
    }
    catch (error) {
      throw toNexusAuthError(error)
    }
  }

  const refreshed = await refreshNexusTokens(latest ?? bundle)
  try {
    return await fetch(url, buildAuthorizedRequest(refreshed, init))
  }
  catch (error) {
    throw toNexusAuthError(error)
  }
}

export async function readNexusAuthStatus(): Promise<NexusAuthStatus> {
  const bundle = await readTokenBundle()
  if (!bundle)
    return { signedIn: false }

  if (bundle.accessExpiresAt - Date.now() > REFRESH_SKEW_MS)
    return { signedIn: true, accessTokenExpiresAt: bundle.accessExpiresAt }

  try {
    const fresh = await ensureAccessBundle()
    return { signedIn: true, accessTokenExpiresAt: fresh.accessExpiresAt }
  }
  catch (error) {
    // A refusal has already cleared the tokens; a transport failure has not, and the
    // stored expiry is still the truth we can report.
    return error instanceof NexusAuthError && error.kind === 'unauthorized'
      ? { signedIn: false }
      : { signedIn: true, accessTokenExpiresAt: bundle.accessExpiresAt }
  }
}

function readCreditBalance(value: unknown): NexusCreditBalance | null {
  if (!value || typeof value !== 'object')
    return null

  const source = value as Record<string, unknown>
  const quota = typeof source.quota === 'number' && Number.isFinite(source.quota) ? Math.max(0, source.quota) : null
  const used = typeof source.used === 'number' && Number.isFinite(source.used) ? Math.max(0, source.used) : null
  if (quota === null && used === null)
    return null

  const resolvedQuota = quota ?? 0
  const resolvedUsed = used ?? 0
  return { quota: resolvedQuota, used: resolvedUsed }
}

function decodeCreditSummary(payload: unknown): NexusCreditSummary {
  if (!payload || typeof payload !== 'object')
    throw new NexusAuthError('invalid', 'Nexus 余额响应无法解析')

  const source = payload as Record<string, unknown>
  const month = typeof source.month === 'string' ? source.month : ''
  const user = readCreditBalance(source.user)
  const team = readCreditBalance(source.team)
  if (!month && !user && !team)
    throw new NexusAuthError('invalid', 'Nexus 余额响应无法解析')

  return { month, user, team }
}

export async function readNexusCredits(): Promise<NexusCreditSummary> {
  const clock = startRequestClock(undefined, CREDITS_REQUEST_TIMEOUT_MS)
  try {
    const response = await nexusAuthorizedFetch('/api/credits/summary', { signal: clock.signal })
    if (!response.ok)
      throw nexusHttpFailure(response.status)

    try {
      return decodeCreditSummary(await response.json())
    }
    catch (error) {
      throw toNexusAuthError(error)
    }
  }
  finally {
    clock.dispose()
  }
}

const clientErrorKinds: Record<NexusAuthErrorKind, NexusClientErrorKind> = {
  'no-token': 'denied',
  'unauthorized': 'expired',
  'transient': 'unavailable',
  'rate-limited': 'rate-limited',
  'invalid': 'invalid',
}

/** Answers a client with either token-free data or one bounded, redacted message. */
async function replyToClient<T>(operation: () => Promise<T>): Promise<NexusRuntimeReply<T>> {
  try {
    return { ok: true, data: await operation() }
  }
  catch (error) {
    const failure = toNexusAuthError(error)
    return { ok: false, error: failure.message, kind: clientErrorKinds[failure.kind] }
  }
}

/**
 * Registers the Nexus runtime listeners.
 *
 * Called from the background entry point only: importing this module must not have side
 * effects, or a unit test would start answering messages.
 */
export function startNexusAuthService(): void {
  listenRuntimeMessage('lexi-nexus-device-start', () => replyToClient(() => startNexusDeviceAuthorization()))
  listenRuntimeMessage<{ deviceCode?: unknown }>('lexi-nexus-device-poll', data =>
    replyToClient(() => pollNexusDeviceAuthorization(typeof data?.deviceCode === 'string' ? data.deviceCode : '')))
  listenRuntimeMessage<unknown>('lexi-nexus-auth-status', () => readNexusAuthStatus())
  listenRuntimeMessage<unknown>('lexi-nexus-credits', () => replyToClient(() => readNexusCredits()))
  listenRuntimeMessage<unknown>('lexi-nexus-logout', () => replyToClient(async () => {
    await clearNexusAuth()
  }))
}
