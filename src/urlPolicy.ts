/** Rejects insecure remote URLs while allowing local development bridges. */
export function httpUrlError(raw: string, label: string, allowQuery = false): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return `Enter a valid ${label} URL.`
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const loopback =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    return `${label} URL must use HTTPS; HTTP is allowed only for localhost.`
  }
  if (url.username || url.password) return `${label} URL must not contain credentials.`
  if (url.hash || (!allowQuery && url.search)) {
    return `${label} URL must not contain a query string or fragment.`
  }
  return null
}
