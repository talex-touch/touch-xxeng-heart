const httpProtocol = 'http:'
const httpsProtocol = 'https:'

export function normalizeEndpointApproval(endpoint: string) {
  const value = endpoint.trim()
  if (!value)
    return ''

  try {
    const url = new URL(value)
    url.hash = ''
    const normalizedPath = url.pathname.replace(/\/+$/, '')
    url.pathname = normalizedPath || '/'
    return url.toString().replace(/\/$/, '')
  }
  catch {
    return value.replace(/\/+$/, '')
  }
}

export function isHttpEndpoint(endpoint: string) {
  try {
    return new URL(endpoint.trim()).protocol === httpProtocol
  }
  catch {
    return false
  }
}

export function approveHttpEndpoint(approved: string[], endpoint: string) {
  const normalized = normalizeEndpointApproval(endpoint)
  if (!normalized || !isHttpEndpoint(normalized))
    return approved

  return [...new Set([...approved.map(normalizeEndpointApproval), normalized])]
}

export function revokeHttpEndpoint(approved: string[], endpoint: string) {
  const normalized = normalizeEndpointApproval(endpoint)
  return approved.filter(item => normalizeEndpointApproval(item) !== normalized)
}

function isUnderApprovedEndpoint(approved: string, url: URL) {
  let base: URL
  try {
    base = new URL(normalizeEndpointApproval(approved))
  }
  catch {
    return false
  }

  if (base.origin !== url.origin)
    return false

  const basePath = base.pathname.replace(/\/+$/, '')
  return !basePath || url.pathname === basePath || url.pathname.startsWith(`${basePath}/`)
}

/**
 * Same rule as `assertEndpointAllowed`, but for a route the adapters already resolved.
 *
 * Approval is recorded against the configured base (`http://localhost:11434/v1`) while the
 * request that goes out carries the protocol path (`.../v1/chat/completions`), so the
 * approved entry has to match as a prefix rather than exactly.
 */
export function assertRequestUrlAllowed(requestUrl: string, approvedHttpEndpoints: string[]) {
  let url: URL
  try {
    url = new URL(requestUrl.trim())
  }
  catch {
    throw new Error('AI 请求地址无效，请检查 Endpoint 配置。')
  }

  if (url.protocol === httpsProtocol)
    return

  if (url.protocol !== httpProtocol)
    throw new Error('AI Endpoint 仅支持 HTTPS 或经确认的 HTTP 地址。')

  if (approvedHttpEndpoints.some(item => isUnderApprovedEndpoint(item, url)))
    return

  throw new Error(`HTTP Endpoint 尚未确认：${normalizeEndpointApproval(requestUrl)}。请在 Lexi 设置页确认风险后再使用。`)
}

export function assertEndpointAllowed(endpoint: string, approvedHttpEndpoints: string[]) {
  const normalized = normalizeEndpointApproval(endpoint)
  let protocol: string
  try {
    protocol = new URL(normalized).protocol
  }
  catch {
    throw new Error('AI Endpoint 地址无效，请填写完整 URL。')
  }

  if (protocol === httpsProtocol)
    return

  if (protocol === httpProtocol && approvedHttpEndpoints.some(item => normalizeEndpointApproval(item) === normalized))
    return

  if (protocol === httpProtocol)
    throw new Error(`HTTP Endpoint 尚未确认：${normalized}。请在 Lexi 设置页确认风险后再使用。`)

  throw new Error('AI Endpoint 仅支持 HTTPS 或经确认的 HTTP 地址。')
}
