/**
 * Kestrel ↔ PrimeXBT signing bridge.
 *
 * The terminal normally signs PrimeXBT requests in the browser, which means the
 * Ed25519 secret has to live next to it, in browser storage. This Worker takes
 * that secret out of the browser: Kestrel talks to this endpoint with a bridge
 * token, and the Worker signs the PrimeXBT request with a key that never leaves
 * Cloudflare.
 *
 * Routes:
 *   GET  /account    prove the key works, return the account behind it
 *   GET  /positions  the venue's open positions
 *   POST /orders     place a market order (terminal symbol, buy/sell, qty)
 *   POST /close      close the position in one symbol
 *   POST /cancel     cancel one working order by its numeric id
 *   GET  /health     what this deployment is configured with, no secrets
 *
 * Configuration (Cloudflare secrets, never in the repo and never in the app):
 *   PRIMEXBT_KEY_ID        the key id, as issued (starts pxk_)
 *   PRIMEXBT_SECRET        the Ed25519 private key, base64 PKCS#8
 *   BRIDGE_TOKEN           bearer token the terminal must present
 *   BRIDGE_SECRET          optional: a second credential, sent as X-Bridge-Key
 *   ALLOWED_ORIGIN         optional: pin CORS to one origin instead of *
 *   ALLOWED_SYMBOLS        optional: comma list, e.g. BTC,ETH — everything else 400s
 *   MAX_NOTIONAL           optional: largest order in USD; needs a reference price
 *   RATE_LIMIT_PER_MINUTE  optional: requests per minute per client, default 30
 *   RATE_DB                optional: a D1 binding; when present the counter is
 *                          shared by every isolate, otherwise it is per-isolate
 *   CLOSE_PATH/CANCEL_PATH optional: venue paths, if they differ from the defaults
 *
 * Both paths are confirmed against the live venue: /cancel answers ORDER_NOT_FOUND
 * for an unknown id (and WRONG_ARGS for a quoted one), /close answers for a real
 * position. They stay overridable per deployment. Anything the venue refuses is
 * relayed verbatim.
 *
 * The bridge refuses to run without all three required values. A half-configured
 * deployment that accepts orders is worse than one that answers 503.
 */

const BASE = 'https://www.primexbt.partners'
const ACCOUNT_PATH = '/v3/trading/account'
const POSITIONS_PATH = '/v3/trading/positions'
const ORDER_PATH = '/v3/trading/orders/market/place'
const DEFAULT_CLOSE_PATH = '/v3/trading/positions/close'
const DEFAULT_CANCEL_PATH = '/v3/trading/orders/cancel'
const UPSTREAM_TIMEOUT_MS = 8000
const DEFAULT_RATE_LIMIT = 30

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
    const started = Date.now()
    const response = await serve(request, env)
    logRequest(request, response, started)
    return response
  },
}

/** Builds the response for one request; fetch() above logs and returns it. */
async function serve(request, env) {
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
          limits: {
            symbols: allowedSymbols(env),
            maxNotional: Number(env.MAX_NOTIONAL) > 0 ? Number(env.MAX_NOTIONAL) : null,
            rateLimitPerMinute: rateLimitOf(env),
            rateLimitScope: env.RATE_DB ? 'durable (D1)' : 'per-isolate',
          },
          routes: {
            account: 'GET /account',
            positions: 'GET /positions',
            orders: 'POST /orders',
            close: 'POST /close',
            cancel: 'POST /cancel',
          },
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

    // D1 makes the counter shared, so a token holder cannot multiply its budget
    // by landing on a fresh isolate. Without RATE_DB this is per-isolate only.
    const limit = await overLimit(env, clientKey(request))
    if (limit.limited) {
      return json(
        { error: 'Too many requests — slow down' },
        429,
        // Which counter refused; useful when proving the D1 path is live.
        { ...cors, 'x-rate-scope': limit.scope },
      )
    }

    if (url.pathname === '/account' && request.method === 'GET') {
      return account(env, cors)
    }

    if (url.pathname === '/positions' && request.method === 'GET') {
      return relay(await callVenue(env, 'GET', POSITIONS_PATH), cors)
    }

    if (url.pathname === '/orders' && request.method === 'POST') {
      return order(request, env, cors)
    }

    if (url.pathname === '/close' && request.method === 'POST') {
      return close(request, env, cors)
    }

    if (url.pathname === '/cancel' && request.method === 'POST') {
      return cancel(request, env, cors)
    }

    return json({ error: `No route for ${request.method} ${url.pathname}` }, 404, cors)
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
  if (!symbolAllowed(env, symbol)) {
    return json({ error: `${symbol} is not in ALLOWED_SYMBOLS on this deployment` }, 400, cors)
  }

  const side = String(body.side ?? '').toUpperCase()
  if (side !== 'BUY' && side !== 'SELL') {
    return json({ error: 'side must be buy or sell' }, 400, cors)
  }

  const qty = Number(body.qty)
  if (!Number.isFinite(qty) || qty <= 0) {
    return json({ error: 'qty must be a positive number' }, 400, cors)
  }

  const cap = Number(env.MAX_NOTIONAL)
  if (Number.isFinite(cap) && cap > 0) {
    const price = Number(body.reference_price ?? body.price)
    if (!Number.isFinite(price) || price <= 0) {
      return json(
        { error: 'MAX_NOTIONAL is set, so the order needs reference_price to size it' },
        400,
        cors,
      )
    }
    const notional = qty * price
    if (notional > cap) {
      return json(
        {
          error: `Order is $${notional.toFixed(2)} at the reference price, over the $${cap} cap on this deployment`,
        },
        400,
        cors,
      )
    }
  }

  const payload = { symbol, side, qty }
  const clientOrderId = cleanId(body.client_order_id ?? body.clientOrderId)
  if (clientOrderId) payload.clientOrderId = clientOrderId

  const result = await callVenue(env, 'POST', ORDER_PATH, payload)
  return relay(result, cors)
}

/** Closes the open position in one symbol. */
async function close(request, env, cors) {
  const body = await readJson(request, cors)
  if (!body) return json({ error: 'Body must be JSON' }, 400, cors)

  const symbol = normaliseSymbol(body.symbol)
  if (!symbol) return json({ error: `Unknown instrument ${String(body.symbol)}` }, 400, cors)
  if (!symbolAllowed(env, symbol)) {
    return json({ error: `${symbol} is not in ALLOWED_SYMBOLS on this deployment` }, 400, cors)
  }

  const payload = { symbol }
  const positionId = String(body.positionId ?? body.position_id ?? '').trim()
  if (positionId) payload.positionId = positionId.slice(0, 64)
  const qty = Number(body.qty)
  if (Number.isFinite(qty) && qty > 0) payload.qty = qty

  const path = (env.CLOSE_PATH ?? '').trim() || DEFAULT_CLOSE_PATH
  return relay(await callVenue(env, 'POST', path, payload), cors)
}

/**
 * Cancels one working order. The venue takes the order id as a JSON number and
 * answers WRONG_ARGS to a quoted one, so a numeric id is the only accepted form.
 */
async function cancel(request, env, cors) {
  const body = await readJson(request, cors)
  if (!body) return json({ error: 'Body must be JSON' }, 400, cors)

  const raw = String(body.orderId ?? body.order_id ?? body.clientOrderId ?? '').trim()
  if (!raw) return json({ error: 'orderId is required' }, 400, cors)
  if (!/^\d{1,19}$/.test(raw)) {
    return json(
      { error: 'orderId must be the numeric order id the venue returned, not an id like ' + JSON.stringify(raw) },
      400,
      cors,
    )
  }

  const path = (env.CANCEL_PATH ?? '').trim() || DEFAULT_CANCEL_PATH
  return relay(await callVenue(env, 'POST', path, { orderId: Number(raw) }), cors)
}

async function readJson(request, cors) {
  try {
    const body = await request.json()
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

/** ALLOWED_SYMBOLS, normalised to venue pairs; empty means every mapped pair. */
function allowedSymbols(env) {
  const raw = (env.ALLOWED_SYMBOLS ?? '').trim()
  if (!raw) return Object.values(PAIRS)
  return raw
    .split(',')
    .map((part) => normaliseSymbol(part))
    .filter(Boolean)
}

function symbolAllowed(env, venueSymbol) {
  return allowedSymbols(env).includes(venueSymbol)
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

function rateLimitOf(env) {
  const value = Number(env.RATE_LIMIT_PER_MINUTE ?? DEFAULT_RATE_LIMIT)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RATE_LIMIT
}

const buckets = new Map()

/** The shared counter when RATE_DB is bound, else the in-memory one. */
async function overLimit(env, key) {
  if (env.RATE_DB) {
    const durable = await durableLimit(env, key)
    if (durable !== null) return { limited: durable, scope: 'durable' }
  }
  return { limited: rateLimited(env, key), scope: 'memory' }
}

let rateTableReady = false

/**
 * One row per client per wall-clock minute. Returns null when D1 is unusable,
 * so a database problem degrades to the in-memory limiter instead of failing
 * requests.
 */
async function durableLimit(env, key) {
  const limit = rateLimitOf(env)
  const window = Math.floor(Date.now() / 60_000)
  try {
    if (!rateTableReady) {
      await env.RATE_DB.prepare(
        'CREATE TABLE IF NOT EXISTS rate_limit (client TEXT NOT NULL, window INTEGER NOT NULL, hits INTEGER NOT NULL, PRIMARY KEY (client, window))',
      ).run()
      rateTableReady = true
    }
    const row = await env.RATE_DB.prepare(
      'INSERT INTO rate_limit (client, window, hits) VALUES (?1, ?2, 1) ON CONFLICT(client, window) DO UPDATE SET hits = hits + 1 RETURNING hits',
    )
      .bind(key, window)
      .first()
    if (window % 15 === 0) {
      const old = window - 5
      await env.RATE_DB.prepare('DELETE FROM rate_limit WHERE window < ?1').bind(old).run()
    }
    return Number(row?.hits ?? 1) > limit
  } catch (err) {
    try {
      console.log(
        JSON.stringify({
          bridge: 'kestrel-primexbt',
          rateDb: 'unavailable',
          error: String(err?.message ?? err),
        }),
      )
    } catch {
      // logging must never break a request
    }
    return null
  }
}

/** Sliding minute counter per client, inside this isolate only. */
function rateLimited(env, key) {
  const limit = rateLimitOf(env)
  const now = Date.now()
  const entry = buckets.get(key)
  if (!entry || now - entry.start >= 60_000) {
    if (buckets.size > 500) buckets.clear()
    buckets.set(key, { start: now, count: 1 })
    return false
  }
  entry.count += 1
  return entry.count > limit
}

function clientKey(request) {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for') ??
    'unknown'
  )
}

/** One line per request: method, path, status, duration. No tokens, no bodies. */
function logRequest(request, response, started) {
  try {
    const url = new URL(request.url)
    console.log(
      JSON.stringify({
        bridge: 'kestrel-primexbt',
        method: request.method,
        path: url.pathname,
        status: response.status,
        ms: Date.now() - started,
      }),
    )
  } catch {
    // logging must never break a request
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
