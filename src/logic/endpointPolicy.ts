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
