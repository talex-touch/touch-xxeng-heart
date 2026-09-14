<script setup lang="ts">
import browser from 'webextension-polyfill'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  getNexusAuthStatus,
  getNexusCredits,
  logoutNexus,
  pollNexusDeviceAuth,
  startNexusDeviceAuth,
} from '~/logic/nexusClient'

type PanelPhase = 'loading' | 'signed-out' | 'starting' | 'pending' | 'connected' | 'expired' | 'cancelled' | 'browser_closed' | 'rejected' | 'error'
type FeedbackTone = 'neutral' | 'success' | 'error'

type NexusAuthStatus = Awaited<ReturnType<typeof getNexusAuthStatus>>
type NexusCredits = Awaited<ReturnType<typeof getNexusCredits>>
type NexusDeviceStart = Awaited<ReturnType<typeof startNexusDeviceAuth>>
type NexusDevicePoll = Awaited<ReturnType<typeof pollNexusDeviceAuth>>

const emit = defineEmits<{
  connected: []
  loggedOut: []
}>()

const phase = ref<PanelPhase>('loading')
const authStatus = ref<NexusAuthStatus>()
const credits = ref<NexusCredits>()
const pendingAuthorization = ref<NexusDeviceStart>()
const feedback = ref('正在读取 Nexus 账号状态。')
const feedbackTone = ref<FeedbackTone>('neutral')
const popupOpenFailed = ref(false)
const creditsLoading = ref(false)
const creditsError = ref('')
const actionBusy = ref(false)
const logoutBusy = ref(false)

let attemptId = 0
let pollTimer: ReturnType<typeof setTimeout> | undefined

const statusLabel = computed(() => {
  switch (phase.value) {
    case 'loading': return '正在检查'
    case 'starting': return '正在启动'
    case 'pending': return '等待授权'
    case 'connected': return '已连接'
    case 'expired': return '授权已过期'
    case 'cancelled': return '授权已取消'
    case 'browser_closed': return '授权页已关闭'
    case 'rejected': return '授权未通过'
    case 'error': return '需要处理'
    default: return '未登录'
  }
})

const publicStatus = computed(() => {
  if (phase.value === 'loading' || phase.value === 'signed-out')
    return 'signed-out'
  if (phase.value === 'starting')
    return 'signing-in'
  if (phase.value === 'pending')
    return 'awaiting'
  return phase.value
})

const statusTone = computed(() => {
  if (phase.value === 'connected')
    return 'connected'
  if (phase.value === 'pending' || phase.value === 'starting' || phase.value === 'loading')
    return 'active'
  if (['expired', 'browser_closed', 'rejected', 'error'].includes(phase.value))
    return 'error'
  return 'neutral'
})

const loginLabel = computed(() => phase.value === 'signed-out' ? '登录 Nexus' : '重新登录')

const accessExpiryLabel = computed(() => formatTimestamp(authStatus.value?.accessTokenExpiresAt))
const authorizationExpiryLabel = computed(() => formatTimestamp(pendingAuthorization.value?.expiresAt))

function beginAttempt() {
  attemptId += 1
  if (pollTimer !== undefined) {
    clearTimeout(pollTimer)
    pollTimer = undefined
  }
  return attemptId
}

function setFeedback(message: string, tone: FeedbackTone = 'neutral') {
  feedback.value = message
  feedbackTone.value = tone
}

function parseTimestamp(value?: number | string | null) {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function formatTimestamp(value?: number | string | null) {
  const timestamp = parseTimestamp(value)
  if (timestamp === undefined)
    return '未知'

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function formatCredits(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

function remainingCredits(account: { quota: number, used: number }) {
  return Math.max(0, account.quota - account.used)
}

function readableError(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function pollMessage(result: NexusDevicePoll, fallback: string) {
  return 'message' in result && typeof result.message === 'string' && result.message.trim()
    ? result.message
    : fallback
}

async function loadCredits(currentAttempt: number) {
  creditsLoading.value = true
  creditsError.value = ''
  try {
    const nextCredits = await getNexusCredits()
    if (currentAttempt !== attemptId)
      return
    credits.value = nextCredits
  }
  catch (error) {
    if (currentAttempt !== attemptId)
      return
    credits.value = undefined
    creditsError.value = readableError(error, '暂时无法读取 Nexus 额度。')
  }
  finally {
    if (currentAttempt === attemptId)
      creditsLoading.value = false
  }
}

async function refreshStatus() {
  const currentAttempt = beginAttempt()
  const wasConnected = phase.value === 'connected'
  actionBusy.value = true
  if (!wasConnected)
    phase.value = 'loading'
  setFeedback('正在刷新 Nexus 账号状态。')

  try {
    const status = await getNexusAuthStatus()
    if (currentAttempt !== attemptId)
      return

    authStatus.value = status
    if (!status.signedIn) {
      phase.value = 'signed-out'
      credits.value = undefined
      setFeedback('当前浏览器会话尚未登录 Nexus。')
      emit('loggedOut')
      return
    }

    phase.value = 'connected'
    setFeedback('Nexus 账号已连接，可使用自动路由。', 'success')
    emit('connected')
    await loadCredits(currentAttempt)
  }
  catch (error) {
    if (currentAttempt !== attemptId)
      return
    phase.value = wasConnected ? 'connected' : 'error'
    setFeedback(readableError(error, '无法读取 Nexus 账号状态。'), 'error')
  }
  finally {
    if (currentAttempt === attemptId)
      actionBusy.value = false
  }
}

function schedulePoll(currentAttempt: number, intervalSeconds: number) {
  const authorization = pendingAuthorization.value
  if (currentAttempt !== attemptId || !authorization)
    return

  const expiresAt = parseTimestamp(authorization.expiresAt)
  if (expiresAt === undefined) {
    finishExpired(currentAttempt, '无法确认授权码有效期，请重新登录。')
    return
  }

  const remainingMs = expiresAt - Date.now()
  if (remainingMs <= 0) {
    finishExpired(currentAttempt)
    return
  }

  const intervalMs = Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds * 1000 : 1000
  pollTimer = setTimeout(() => {
    pollTimer = undefined
    void pollAuthorization(currentAttempt)
  }, Math.min(intervalMs, remainingMs))
}

function scheduleExpiry(currentAttempt: number) {
  const authorization = pendingAuthorization.value
  if (currentAttempt !== attemptId || !authorization)
    return

  const expiresAt = parseTimestamp(authorization.expiresAt)
  if (expiresAt === undefined || expiresAt <= Date.now()) {
    finishExpired(currentAttempt)
    return
  }

  pollTimer = setTimeout(() => {
    pollTimer = undefined
    finishExpired(currentAttempt)
  }, expiresAt - Date.now())
}

function finishExpired(currentAttempt: number, message = '授权码已过期，请重新登录。') {
  if (currentAttempt !== attemptId)
    return
  pendingAuthorization.value = undefined
  phase.value = 'expired'
  actionBusy.value = false
  setFeedback(message, 'error')
}

async function completeAuthorization(currentAttempt: number, message: string) {
  const status = await getNexusAuthStatus()
  if (currentAttempt !== attemptId)
    return

  pendingAuthorization.value = undefined
  authStatus.value = status
  if (!status.signedIn) {
    phase.value = 'error'
    actionBusy.value = false
    setFeedback('授权已完成，但当前会话尚未取得可用凭据。请重试登录。', 'error')
    emit('loggedOut')
    return
  }

  phase.value = 'connected'
  actionBusy.value = false
  setFeedback(message, 'success')
  emit('connected')
  await loadCredits(currentAttempt)
}

async function pollAuthorization(currentAttempt: number) {
  const authorization = pendingAuthorization.value
  if (currentAttempt !== attemptId || !authorization)
    return

  const expiresAt = parseTimestamp(authorization.expiresAt)
  if (expiresAt === undefined || Date.now() >= expiresAt) {
    finishExpired(currentAttempt)
    return
  }

  try {
    const result = await pollNexusDeviceAuth(authorization.deviceCode)
    if (currentAttempt !== attemptId)
      return

    switch (result.status) {
      case 'pending':
        setFeedback(pollMessage(result, '等待你在 Nexus 授权页面确认。'))
        schedulePoll(currentAttempt, authorization.intervalSeconds)
        return
      case 'approved':
        await completeAuthorization(currentAttempt, pollMessage(result, '授权成功，Nexus 已可用于自动路由。'))
        return
      case 'expired':
        finishExpired(currentAttempt, pollMessage(result, '授权码已过期，请重新登录。'))
        return
      case 'cancelled':
        pendingAuthorization.value = undefined
        phase.value = 'cancelled'
        actionBusy.value = false
        setFeedback(pollMessage(result, '本次 Nexus 授权已取消。'))
        return
      case 'browser_closed':
        pendingAuthorization.value = undefined
        phase.value = 'browser_closed'
        actionBusy.value = false
        setFeedback(pollMessage(result, '授权页面已关闭，未完成登录。'), 'error')
        return
      case 'rejected':
        pendingAuthorization.value = undefined
        phase.value = 'rejected'
        actionBusy.value = false
        setFeedback(pollMessage(result, 'Nexus 未批准本次授权。'), 'error')
    }
  }
  catch (error) {
    if (currentAttempt !== attemptId)
      return
    pendingAuthorization.value = undefined
    phase.value = 'error'
    actionBusy.value = false
    setFeedback(readableError(error, '检查授权状态失败，请重新登录。'), 'error')
  }
}

async function startAuthorization() {
  const currentAttempt = beginAttempt()
  pendingAuthorization.value = undefined
  popupOpenFailed.value = false
  phase.value = 'starting'
  actionBusy.value = true
  setFeedback('正在创建 Nexus 设备授权。')

  try {
    const authorization = await startNexusDeviceAuth()
    if (currentAttempt !== attemptId)
      return

    pendingAuthorization.value = authorization
    phase.value = 'pending'
    setFeedback('等待你在 Nexus 授权页面确认。')

    try {
      await browser.tabs.create({ url: authorization.authorizeUrl })
    }
    catch {
      if (currentAttempt !== attemptId)
        return
      popupOpenFailed.value = true
      actionBusy.value = false
      setFeedback('未能自动打开授权页面，请使用下方安全链接继续。', 'error')
      scheduleExpiry(currentAttempt)
      return
    }

    if (currentAttempt !== attemptId)
      return
    schedulePoll(currentAttempt, authorization.intervalSeconds)
    actionBusy.value = false
  }
  catch (error) {
    if (currentAttempt !== attemptId)
      return
    phase.value = 'error'
    actionBusy.value = false
    setFeedback(readableError(error, '无法开始 Nexus 登录。'), 'error')
  }
}

function resumeAuthorizationPolling() {
  const authorization = pendingAuthorization.value
  if (phase.value !== 'pending' || !authorization || !popupOpenFailed.value)
    return

  if (pollTimer !== undefined) {
    clearTimeout(pollTimer)
    pollTimer = undefined
  }

  popupOpenFailed.value = false
  setFeedback('等待你在 Nexus 授权页面确认。')
  schedulePoll(attemptId, authorization.intervalSeconds)
}

function cancelAuthorization() {
  if (phase.value !== 'pending')
    return

  beginAttempt()
  pendingAuthorization.value = undefined
  popupOpenFailed.value = false
  actionBusy.value = false
  phase.value = 'cancelled'
  setFeedback('已停止等待本次 Nexus 授权。')
}

async function logout() {
  const currentAttempt = beginAttempt()
  actionBusy.value = true
  logoutBusy.value = true
  setFeedback('正在退出 Nexus。')
  try {
    await logoutNexus()
    if (currentAttempt !== attemptId)
      return
    authStatus.value = undefined
    credits.value = undefined
    pendingAuthorization.value = undefined
    popupOpenFailed.value = false
    phase.value = 'signed-out'
    setFeedback('已退出 Nexus；现有功能绑定已保留。', 'success')
    emit('loggedOut')
  }
  catch (error) {
    if (currentAttempt !== attemptId)
      return
    phase.value = 'connected'
    setFeedback(readableError(error, '退出 Nexus 失败，请重试。'), 'error')
  }
  finally {
    if (currentAttempt === attemptId)
      actionBusy.value = false
    if (currentAttempt === attemptId)
      logoutBusy.value = false
  }
}

onMounted(() => void refreshStatus())
onBeforeUnmount(() => beginAttempt())
</script>

<template>
  <section class="nexus-account-panel" aria-labelledby="nexus-account-title" :data-nexus-status="publicStatus">
    <div class="nexus-account-panel__header">
      <div class="nexus-account-panel__heading">
        <span class="i-lucide-orbit nexus-account-panel__icon" aria-hidden="true" />
        <div>
          <h2 id="nexus-account-title">
            Nexus 账号
          </h2>
          <p>通过账号授权接入固定通道，无需填写 Endpoint、密钥或模型。</p>
        </div>
      </div>
      <span class="nexus-account-panel__status" :data-tone="statusTone">
        <span aria-hidden="true" />
        {{ statusLabel }}
      </span>
    </div>
    <p class="nexus-account-panel__session-note" data-nexus-session-note>
      Nexus 访问凭据只保存在当前浏览器会话中；关闭浏览器后需要重新登录。
    </p>

    <div v-if="phase === 'loading'" class="nexus-account-panel__loading" role="status">
      <span class="i-lucide-loader-circle" aria-hidden="true" />
      正在读取当前浏览器会话…
    </div>

    <div v-else-if="phase === 'pending' && pendingAuthorization" class="nexus-account-panel__authorization">
      <div class="nexus-account-panel__code">
        <span>设备授权码</span>
        <code data-nexus-user-code>{{ pendingAuthorization.userCode }}</code>
        <small>有效至 {{ authorizationExpiryLabel }}</small>
      </div>
      <div class="nexus-account-panel__authorization-copy">
        <p>请在 Nexus 页面核对并确认此授权码。本页会按服务端要求的间隔自动检查结果。</p>
        <a
          v-if="popupOpenFailed"
          :href="pendingAuthorization.authorizeUrl"
          target="_blank"
          rel="noopener noreferrer"
          data-nexus-authorize-link
          @click="resumeAuthorizationPolling"
        >
          打开 Nexus 安全授权页
          <span class="i-lucide-external-link" aria-hidden="true" />
        </a>
        <div class="nexus-account-panel__authorization-actions">
          <BaseButton size="sm" data-nexus-action="restart" :disabled="actionBusy" @click="startAuthorization">
            重新开始
          </BaseButton>
          <BaseButton size="sm" data-nexus-action="cancel" :disabled="actionBusy" @click="cancelAuthorization">
            取消等待
          </BaseButton>
        </div>
      </div>
    </div>

    <div v-else-if="phase === 'connected'" class="nexus-account-panel__connected">
      <div class="nexus-account-panel__session">
        <strong>当前浏览器会话已登录</strong>
        <span>访问凭据有效至 {{ accessExpiryLabel }}</span>
      </div>

      <div class="nexus-account-panel__credits" aria-label="Nexus 额度">
        <div class="nexus-account-panel__credits-heading">
          <strong>额度</strong>
          <span v-if="credits" data-nexus-month>{{ credits.month }}</span>
        </div>
        <p v-if="creditsLoading" class="nexus-account-panel__credits-message" role="status">
          正在读取额度…
        </p>
        <p v-else-if="creditsError" class="nexus-account-panel__credits-message is-error" role="alert">
          {{ creditsError }}
        </p>
        <dl v-else-if="credits && (credits.user || credits.team)">
          <div v-if="credits.user">
            <dt>个人额度</dt>
            <dd data-nexus-remaining>
              {{ formatCredits(remainingCredits(credits.user)) }} / {{ formatCredits(credits.user.quota) }} 剩余
            </dd>
            <small>已使用 {{ formatCredits(credits.user.used) }}</small>
          </div>
          <div v-if="credits.team">
            <dt>团队额度</dt>
            <dd data-nexus-team-remaining :data-nexus-remaining="credits.user ? undefined : ''">
              {{ formatCredits(remainingCredits(credits.team)) }} / {{ formatCredits(credits.team.quota) }} 剩余
            </dd>
            <small>已使用 {{ formatCredits(credits.team.used) }}</small>
          </div>
        </dl>
        <p v-else class="nexus-account-panel__credits-message">
          当前账号没有可展示的个人或团队额度。
        </p>
      </div>
    </div>

    <div class="nexus-account-panel__footer">
      <p
        class="nexus-account-panel__feedback"
        :class="`is-${feedbackTone}`"
        :role="feedbackTone === 'error' ? 'alert' : 'status'"
        :aria-live="feedbackTone === 'error' ? 'assertive' : 'polite'"
        aria-atomic="true"
      >
        {{ feedback }}
      </p>
      <div class="nexus-account-panel__actions">
        <template v-if="phase === 'connected'">
          <BaseButton size="sm" data-nexus-action="refresh" :loading="actionBusy && !logoutBusy" loading-label="正在刷新账号状态" :disabled="actionBusy" @click="refreshStatus">
            <template #icon>
              <span class="i-lucide-refresh-cw" aria-hidden="true" />
            </template>
            刷新状态
          </BaseButton>
          <BaseButton variant="danger" size="sm" data-nexus-action="logout" :loading="logoutBusy" loading-label="正在退出 Nexus" :disabled="actionBusy && !logoutBusy" @click="logout">
            退出登录
          </BaseButton>
        </template>
        <BaseButton
          v-else-if="phase !== 'loading' && phase !== 'pending'"
          variant="primary"
          size="sm"
          data-nexus-action="start"
          :loading="phase === 'starting'"
          loading-label="正在开始 Nexus 登录"
          @click="startAuthorization"
        >
          {{ loginLabel }}
        </BaseButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.nexus-account-panel {
  min-width: 0;
  padding: 16px;
  color: var(--lexi-ink);
  background: var(--lexi-subtle);
  border-radius: 12px;
}

.nexus-account-panel__header,
.nexus-account-panel__footer,
.nexus-account-panel__heading,
.nexus-account-panel__credits-heading {
  min-width: 0;
  display: flex;
  align-items: center;
}

.nexus-account-panel__header,
.nexus-account-panel__footer,
.nexus-account-panel__credits-heading {
  justify-content: space-between;
  gap: 12px;
}

.nexus-account-panel__header {
  align-items: flex-start;
}

.nexus-account-panel__heading {
  align-items: flex-start;
  gap: 12px;
}

.nexus-account-panel__heading > div {
  min-width: 0;
}

.nexus-account-panel__icon {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--lexi-accent);
}

.nexus-account-panel h2,
.nexus-account-panel p {
  margin: 0;
}

.nexus-account-panel h2 {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
}

.nexus-account-panel__heading p,
.nexus-account-panel__authorization-copy p,
.nexus-account-panel__session-note {
  max-width: 68ch;
  margin-top: 4px;
  color: var(--lexi-ink-muted);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  text-wrap: pretty;
}

.nexus-account-panel__session-note {
  margin-top: 8px;
}

.nexus-account-panel__status {
  min-height: 24px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  color: var(--lexi-ink-secondary);
  background: var(--lexi-surface);
  border-radius: 8px;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.25;
}

.nexus-account-panel__status > span {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  background: currentColor;
  border-radius: 999px;
}

.nexus-account-panel__status[data-tone="connected"],
.nexus-account-panel__status[data-tone="active"] {
  color: var(--lexi-accent);
  background: color-mix(in srgb, var(--lexi-accent) 10%, var(--lexi-surface));
}

.nexus-account-panel__status[data-tone="error"] {
  color: var(--lexi-danger);
  background: color-mix(in srgb, var(--lexi-danger) 8%, var(--lexi-surface));
}

.nexus-account-panel__loading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  color: var(--lexi-ink-muted);
  font-size: 12px;
}

.nexus-account-panel__loading > span {
  width: 16px;
  height: 16px;
  animation: nexus-account-spin 800ms linear infinite;
}

.nexus-account-panel__authorization,
.nexus-account-panel__connected {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 15rem) minmax(0, 1fr);
  gap: 16px;
  margin-top: 16px;
}

.nexus-account-panel__code,
.nexus-account-panel__session,
.nexus-account-panel__credits {
  min-width: 0;
}

.nexus-account-panel__authorization-copy,
.nexus-account-panel__credits {
  padding-left: 16px;
  border-left: 1px solid var(--lexi-border);
}

.nexus-account-panel__code {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nexus-account-panel__code span,
.nexus-account-panel__code small,
.nexus-account-panel__session span,
.nexus-account-panel__credits-heading span,
.nexus-account-panel__credits small {
  color: var(--lexi-ink-muted);
  font-size: 11.5px;
  line-height: 1.5;
}

.nexus-account-panel__code code {
  color: var(--lexi-ink);
  font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.nexus-account-panel__authorization-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}

.nexus-account-panel__authorization-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.nexus-account-panel__authorization-copy p {
  margin-top: 0;
}

.nexus-account-panel__authorization-copy a {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--lexi-accent);
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
  text-underline-offset: 3px;
}

.nexus-account-panel__authorization-copy a:focus-visible {
  outline: 2px solid var(--lexi-accent);
  outline-offset: 2px;
  border-radius: 4px;
}

.nexus-account-panel__authorization-copy a > span {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}

.nexus-account-panel__session strong,
.nexus-account-panel__credits strong {
  font-size: 12.5px;
  font-weight: 600;
}

.nexus-account-panel__session span {
  display: block;
  margin-top: 8px;
}

.nexus-account-panel__credits dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 12px 0 0;
}

.nexus-account-panel__credits dl > div {
  min-width: 0;
}

.nexus-account-panel__credits dt {
  color: var(--lexi-ink-muted);
  font-size: 11.5px;
  line-height: 1.5;
}

.nexus-account-panel__credits dd {
  margin: 4px 0 0;
  color: var(--lexi-ink);
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.nexus-account-panel__credits-message {
  margin-top: 12px;
  color: var(--lexi-ink-muted);
  font-size: 12px;
  line-height: 1.5;
}

.nexus-account-panel__credits-message.is-error {
  color: var(--lexi-danger);
}

.nexus-account-panel__footer {
  align-items: flex-end;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--lexi-border);
}

.nexus-account-panel__feedback {
  min-width: 0;
  color: var(--lexi-ink-muted);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.nexus-account-panel__feedback.is-success {
  color: var(--lexi-accent);
}

.nexus-account-panel__feedback.is-error {
  color: var(--lexi-danger);
}

.nexus-account-panel__actions {
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

@keyframes nexus-account-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .nexus-account-panel {
    padding: 12px;
  }

  .nexus-account-panel__credits dl {
    grid-template-columns: minmax(0, 1fr);
  }

  .nexus-account-panel__authorization,
  .nexus-account-panel__connected {
    grid-template-columns: minmax(0, 1fr);
  }

  .nexus-account-panel__authorization-copy,
  .nexus-account-panel__credits {
    padding-top: 12px;
    padding-left: 0;
    border-top: 1px solid var(--lexi-border);
    border-left: 0;
  }

  .nexus-account-panel__header,
  .nexus-account-panel__footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .nexus-account-panel__status {
    margin-left: 32px;
  }

  .nexus-account-panel__actions {
    width: 100%;
    justify-content: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .nexus-account-panel__loading > span {
    animation: none;
  }
}
</style>
