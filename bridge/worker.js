/**
 * Kestrel ↔ PrimeXBT signing bridge.
 *
 * The terminal normally signs PrimeXBT requests in the browser, which means the
 * Ed25519 secret has to live next to it, in browser storage. This Worker takes
 * that secret out of the browser: Kestrel talks to this endpoint with a bridge
 * token, and the Worker signs the PrimeXBT request with a key that never leaves
 * Cloudflare.
 *
 * Routes, matching what the terminal's "Custom bridge" connection sends:
 *   GET  /account   prove the key works, return the account behind it
 *   POST /orders    place a market order (terminal symbol, buy/sell, qty)
 *   GET  /health    what this deployment is configured with, no secrets
 *
 * Configuration (Cloudflare secrets, never in the repo and never in the app):
 *   PRIMEXBT_KEY_ID     the key id, as issued (starts pxk_)
 *   PRIMEXBT_SECRET     the Ed25519 private key, base64 PKCS#8
 *   BRIDGE_TOKEN        bearer token the terminal must present
 *   BRIDGE_SECRET       optional: a second credential, sent as X-Bridge-Key
 *   ALLOWED_ORIGIN      optional: pin CORS to one origin instead of *
 *
 * The bridge refuses to run without all three required values. A half-configured
 * deployment that accepts orders is worse than one that answers 503.
 */

const BASE = 'https://www.primexbt.partners'
const ACCOUNT_PATH = '/v3/trading/account'
const POSITIONS_PATH = '/v3/trading/positions'
const ORDER_PATH = '/v3/trading/orders/market/place'
const UPSTREAM_TIMEOUT_MS = 8000

const encoder = new TextEncoder()

/** A deployment problem, reported as 503 rather than a mystery upstream error. */
class ConfigError extends Error {}

/** Terminal symbols the venue lists, and the names it lists them under. */
const PAIRS = {
  BTC: 'BTC/USD',
  ETH: 'ETH/USD',
  SOL: 'SOL/USD',
  XRP: 'XRP/USD',
  ADA: 'ADA/USD',
  DOGE: 'DOGE/USD',
  AVAX: 'AVAX/USD',
  LINK: 'LINK/USD',
  DOT: 'DOT/USD',
  LTC: 'LTC/USD',
  BCH: 'BCH/USD',
  SUI: 'SUI/USD',
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const cors = corsHeaders(env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return json(
        {
          bridge: 'kestrel-primexbt',
          venue: 'PrimeXBT',
          configured: {
            key: Boolean(env.PRIMEXBT_KEY_ID),
            secret: Boolean(env.PRIMEXBT_SECRET),
            token: Boolean(env.BRIDGE_TOKEN),
            secondKey: Boolean(env.BRIDGE_SECRET),
          },
          routes: { account: 'GET /account', orders: 'POST /orders' },
        },
        200,
        cors,
      )
    }

    if (!env.BRIDGE_TOKEN) {
      return json({ error: 'BRIDGE_TOKEN is not set on this deployment' }, 503, cors)
    }
    if (!authorised(request, env.BRIDGE_TOKEN)) {
      return json({ error: 'Bridge token missing or wrong' }, 401, cors)
    }
    if (env.BRIDGE_SECRET) {
      const second = (request.headers.get('x-bridge-key') ?? '').trim()
      if (!sameSecret(second, env.BRIDGE_SECRET)) {
        return json({ error: 'Second bridge key missing or wrong' }, 401, cors)
      }
    }
    if (!env.PRIMEXBT_KEY_ID || !env.PRIMEXBT_SECRET) {
      return json(
        { error: 'PRIMEXBT_KEY_ID and PRIMEXBT_SECRET are not set on this deployment' },
        503,
        cors,
      )
    }

    if (url.pathname === '/account' && request.method === 'GET') {
      return account(env, cors)
    }

    if (url.pathname === '/orders' && request.method === 'POST') {
      return order(request, env, cors)
    }

    return json({ error: `No route for ${request.method} ${url.pathname}` }, 404, cors)
  },
}

async function account(env, cors) {
  const first = await callVenue(env, 'GET', ACCOUNT_PATH)
  // The account route is not in the public reference; positions is, and shows
  // the same key working. Only fall back when the account route is not there.
  if (first.status === 404) {
    const second = await callVenue(env, 'GET', POSITIONS_PATH)
    return relay(second, cors)
  }
  return relay(first, cors)
}

async function order(request, env, cors) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400, cors)
  }
  if (!body || typeof body !== 'object') return json({ error: 'Body must be JSON' }, 400, cors)

  const symbol = normaliseSymbol(body.symbol)
  if (!symbol) {
    return json({ error: `Unknown instrument ${String(body.symbol)} — send BTC, ETH, SOL or a pair like BTC/USD` }, 400, cors)
  }

  const side = String(body.side ?? '').toUpperCase()
  if (side !== 'BUY' && side !== 'SELL') {
    return json({ error: 'side must be buy or sell' }, 400, cors)
  }

  const qty = Number(body.qty)
  if (!Number.isFinite(qty) || qty <= 0) {
    return json({ error: 'qty must be a positive number' }, 400, cors)
  }

  const payload = { symbol, side, qty }
  const clientOrderId = cleanId(body.client_order_id ?? body.clientOrderId)
  if (clientOrderId) payload.clientOrderId = clientOrderId

  const result = await callVenue(env, 'POST', ORDER_PATH, payload)
  return relay(result, cors)
}

/** The venue's symbol for a terminal one, or null when it cannot be mapped. */
function normaliseSymbol(raw) {
  const value = String(raw ?? '').trim().toUpperCase()
  if (!value) return null
  if (PAIRS[value]) return PAIRS[value]
  if (/^[A-Z]{2,10}\/[A-Z]{2,10}$/.test(value)) return value
  return null
}

/** clientOrderId: 1–36 chars of letters, digits or . _ : - */
function cleanId(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  const safe = value.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 36)
  return safe.length >= 1 ? safe : ''
}

async function callVenue(env, method, path, payload) {
  const bodyText = payload ? JSON.stringify(payload) : ''
  const query = ''
  try {
    const signed = await sign(env, method, path, query, bodyText)
    const res = await fetch(`${BASE}${path}${query}`, {
      method,
      headers: {
        ...signed,
        accept: 'application/json',
        ...(bodyText ? { 'content-type': 'application/json' } : {}),
      },
      body: bodyText || undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    return { status: res.status, text: await res.text() }
  } catch (err) {
    if (err instanceof ConfigError) {
      return { status: 503, text: JSON.stringify({ error: err.message }) }
    }
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return {
      status: timedOut ? 504 : 502,
      text: JSON.stringify({
        error: timedOut ? 'PrimeXBT did not answer in time' : 'PrimeXBT could not be reached',
      }),
    }
  }
}

/**
 * PrimeXBT wants five lines: method, path, query, timestamp, sha256(body) in
 * hex. The venue's own reference signs exactly this, empty query included.
 */
async function sign(env, method, path, query, bodyText) {
  const timestamp = String(Date.now())
  const digest = await sha256Hex(bodyText)
  const message = [method, path, query, timestamp, digest].join('\n')

  let key
  try {
    key = await crypto.subtle.importKey(
      'pkcs8',
      fromBase64(env.PRIMEXBT_SECRET),
      { name: 'Ed25519' },
      false,
      ['sign'],
    )
  } catch {
    throw new ConfigError(
      'PRIMEXBT_SECRET is not a base64 PKCS#8 Ed25519 key — copy the secret shown once when the key was issued',
    )
  }

  const signature = await crypto.subtle.sign('Ed25519', key, encoder.encode(message))
  return {
    'X-API-KEY': env.PRIMEXBT_KEY_ID,
    'X-API-TIMESTAMP': timestamp,
    'X-API-SIGNATURE': toBase64(signature),
  }
}

function relay(result, cors) {
  const headers = { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' }
  return new Response(result.text, { status: result.status, headers })
}

function json(value, status, cors) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...cors,
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  })
}

/** The bridge is token-authenticated, so a wildcard origin leaks nothing a
 *  token holder did not already have. Pin ALLOWED_ORIGIN to narrow it. */
function corsHeaders(env) {
  const allow = (env.ALLOWED_ORIGIN ?? '').trim() || '*'
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-bridge-key',
    'access-control-max-age': '600',
    vary: 'origin',
  }
}

function authorised(request, token) {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? sameSecret(match[1].trim(), token) : false
}

/** Length-equal comparison without an early exit on a mismatched byte. */
function sameSecret(a, b) {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i]
  return diff === 0
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function fromBase64(value) {
  const binary = atob(String(value ?? '').trim())
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}
