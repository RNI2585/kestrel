export type BrokerKind =
  | 'paper'
  | 'alpaca'
  | 'ibkr'
  | 'bybit'
  | 'kraken'
  | 'primexbt'
  | 'primexbt-bridge'
  | 'binance'
  | 'custom'

export type BrokerGroup = 'Local' | 'Stocks' | 'Crypto & derivatives' | 'Custom'

/** How a venue authenticates a private request. */
export type AuthStyle = 'none' | 'alpaca' | 'bearer' | 'bybit' | 'kraken' | 'binance' | 'primexbt'

export interface BrokerDef {
  kind: BrokerKind
  name: string
  group: BrokerGroup
  blurb: string
  auth: AuthStyle
  defaultEndpoint: string
  accountPath: string
  orderPath: string
  keyLabel: string
  secretLabel: string
  /** The second credential is optional, so Connect can be tried with just the key. */
  secretOptional?: boolean
  secretHint: string
  docsUrl: string
  /** Which of the terminal's instruments this venue actually lists. */
  coverage: string
}

export interface BrokerConnection {
  id: string
  kind: BrokerKind
  label: string
  endpoint: string
  key: string
  secret: string
  /** optional overrides so a venue that moved a path can be fixed locally */
  accountPath?: string
  orderPath?: string
  status: 'linked' | 'error'
  message: string
  checkedAt?: number
}

export interface BrokerOrder {
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  price: number
}

export const PAPER_BROKER_ID = 'paper'

const PAPER_DEF: BrokerDef = {
  kind: 'paper',
  name: 'Paper ledger',
  group: 'Local',
  blurb: 'The terminal’s own simulated account. Instant fills, no keys, nothing leaves this browser.',
  auth: 'none',
  defaultEndpoint: '',
  accountPath: '',
  orderPath: '',
  keyLabel: '',
  secretLabel: '',
  secretHint: '',
  docsUrl: '',
  coverage: 'Every instrument in the terminal.',
}

export const BROKER_DEFS: BrokerDef[] = [
  PAPER_DEF,
  {
    kind: 'alpaca',
    name: 'Alpaca',
    group: 'Stocks',
    blurb:
      'Paper or live Alpaca equities and crypto. Browsers cannot call Alpaca directly, so point the endpoint at your own proxy or a bridge that forwards the key pair.',
    auth: 'alpaca',
    defaultEndpoint: 'https://paper-api.alpaca.markets',
    accountPath: '/v2/account',
    orderPath: '/v2/orders',
    keyLabel: 'APCA API key',
    secretLabel: 'APCA secret',
    secretHint: 'Start with paper keys from the Alpaca dashboard.',
    docsUrl: 'https://docs.alpaca.markets/docs/getting-started',
    coverage: 'US equities and BTC/USD, ETH/USD.',
  },
  {
    kind: 'ibkr',
    name: 'Interactive Brokers',
    group: 'Stocks',
    blurb:
      'Route through the IBKR Client Portal gateway or your own bridge. The order body is sent as JSON to the path you configure.',
    auth: 'bearer',
    defaultEndpoint: 'https://localhost:5000/v1/api',
    accountPath: '/portfolio/accounts',
    orderPath: '/iserver/account/orders',
    keyLabel: 'Bearer token',
    secretLabel: '',
    secretHint: 'Optional. The gateway usually authenticates with its own session cookie.',
    docsUrl: 'https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/',
    coverage: 'Stocks and ETFs listed with IBKR.',
  },
  {
    kind: 'bybit',
    name: 'Bybit',
    group: 'Crypto & derivatives',
    blurb:
      'Bybit v5 spot. Requests are signed with HMAC-SHA256 in this browser using your own API key, so nothing is signed server-side.',
    auth: 'bybit',
    defaultEndpoint: 'https://api.bybit.com',
    accountPath: '/v5/account/wallet-balance',
    orderPath: '/v5/order/create',
    keyLabel: 'API key',
    secretLabel: 'API secret',
    secretHint: 'Use a key with spot trade permission and no withdrawal rights.',
    docsUrl: 'https://bybit-exchange.github.io/docs/v5/intro',
    coverage: 'Spot BTCUSDT, ETHUSDT, SOLUSDT.',
  },
  {
    kind: 'kraken',
    name: 'Kraken',
    group: 'Crypto & derivatives',
    blurb:
      'Kraken spot. The API-Sign header is HMAC-SHA512 of the URI path and a SHA256 of the nonce and form body, built here from your private key.',
    auth: 'kraken',
    defaultEndpoint: 'https://api.kraken.com',
    accountPath: '/0/private/Balance',
    orderPath: '/0/private/AddOrder',
    keyLabel: 'API key',
    secretLabel: 'Private key',
    secretHint: 'Paste the base64 private key exactly as Kraken shows it on the API key page.',
    docsUrl: 'https://docs.kraken.com/api/docs/guides/spot-rest-auth',
    coverage: 'XBTUSD, ETHUSD, SOLUSD.',
  },
  {
    kind: 'primexbt',
    name: 'PrimeXBT',
    group: 'Crypto & derivatives',
    blurb:
      'PrimeXBT Trading API v3. Every call carries an Ed25519 signature over method, path, timestamp and a SHA256 of the body, signed locally with the key you were issued.',
    auth: 'primexbt',
    defaultEndpoint: 'https://www.primexbt.partners',
    accountPath: '/v3/trading/account',
    orderPath: '/v3/trading/orders/market/place',
    keyLabel: 'Key id',
    secretLabel: 'Secret key',
    secretHint: 'The base64 PKCS8 Ed25519 secret shown once when the key was created.',
    docsUrl: 'https://www.primexbt.partners/docs/trading.html',
    coverage: 'BTC/USD, ETH/USD, SOL/USD.',
  },
  {
    kind: 'binance',
    name: 'Binance',
    group: 'Crypto & derivatives',
    blurb:
      'Binance spot. The query string is signed with HMAC-SHA256 using your secret, so the exchange sees a normal signed request from your bridge.',
    auth: 'binance',
    defaultEndpoint: 'https://api.binance.com',
    accountPath: '/api/v3/account',
    orderPath: '/api/v3/order',
    keyLabel: 'API key',
    secretLabel: 'API secret',
    secretHint: 'Disable withdrawals on the key and keep it to this browser only.',
    docsUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api',
    coverage: 'Spot BTCUSDT, ETHUSDT, SOLUSDT.',
  },
  {
    kind: 'primexbt-bridge',
    name: 'PrimeXBT via bridge',
    group: 'Custom',
    blurb:
      'Trades a real PrimeXBT account through the signing bridge. The terminal only holds the bridge URL and its token — the PrimeXBT key id and Ed25519 secret stay on the bridge, so they never reach this browser.',
    auth: 'bearer',
    defaultEndpoint: 'https://kestrel-primexbt-bridge-ymtwnj.freebuff.site',
    accountPath: '/account',
    orderPath: '/orders',
    keyLabel: 'Bridge token',
    secretLabel: 'Second key',
    secretOptional: true,
    secretHint:
      'Bridge token: the BRIDGE_TOKEN stored as a secret on the bridge deployment, sent as a bearer token. This is not your PrimeXBT key id. Second key: only needed when the bridge also sets BRIDGE_SECRET, where it is sent as X-Bridge-Key. Leave it blank otherwise.',
    docsUrl: '',
    coverage: 'BTC/USD, ETH/USD, SOL/USD, as forwarded by the bridge.',
  },
  {
    kind: 'custom',
    name: 'Custom bridge',
    group: 'Custom',
    blurb:
      'Any HTTPS endpoint you control. GET the account path to verify, POST the order path to place a market order.',
    auth: 'bearer',
    defaultEndpoint: '',
    accountPath: '/account',
    orderPath: '/orders',
    keyLabel: 'Bearer token',
    secretLabel: 'Second key',
    secretOptional: true,
    secretHint:
      'Optional. Sent as an X-Bridge-Key header, for a bridge that wants a second credential alongside the bearer token. Leave blank if your bridge only checks the token.',
    docsUrl: '',
    coverage: 'Whatever your bridge accepts.',
  },
]

export function defineBroker(kind: BrokerKind): BrokerDef {
  return BROKER_DEFS.find((d) => d.kind === kind) ?? PAPER_DEF
}

const VENUE_PAIRS: Partial<Record<BrokerKind, Record<string, string>>> = {
  alpaca: { BTC: 'BTC/USD', ETH: 'ETH/USD' },
  bybit: { BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT' },
  binance: { BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT' },
  kraken: { BTC: 'XBTUSD', ETH: 'ETHUSD', SOL: 'SOLUSD' },
  primexbt: { BTC: 'BTC/USD', ETH: 'ETH/USD', SOL: 'SOL/USD' },
  'primexbt-bridge': { BTC: 'BTC/USD', ETH: 'ETH/USD', SOL: 'SOL/USD' },
}

const STRICT_VENUES: BrokerKind[] = [
  'bybit',
  'binance',
  'kraken',
  'primexbt',
  'primexbt-bridge',
]

/**
 * The terminal's symbol translated into the venue's instrument name, or null
 * when the venue does not list it. Crypto-only venues get nothing for gold,
 * oil and FX rather than a silently wrong pair.
 */
export function venueSymbol(kind: BrokerKind, symbol: string): string | null {
  const table = VENUE_PAIRS[kind]
  if (table && table[symbol]) return table[symbol]
  if (STRICT_VENUES.includes(kind)) return null
  return symbol
}

export function paperConnection(): BrokerConnection {
  return {
    id: PAPER_BROKER_ID,
    kind: 'paper',
    label: 'Paper ledger',
    endpoint: '',
    key: '',
    secret: '',
    status: 'linked',
    message: 'Simulated fills in this browser.',
  }
}

export function defaultConnections(): BrokerConnection[] {
  return [paperConnection()]
}

class ConfigError extends Error {}

const encoder = new TextEncoder()

function endpointOf(conn: BrokerConnection): string {
  return conn.endpoint.trim().replace(/\/+$/, '')
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function toBase64(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

type Binary = string | Uint8Array | ArrayBuffer

/** Copies into its own ArrayBuffer so WebCrypto overloads accept it. */
function bytes(value: Binary): ArrayBuffer {
  if (typeof value === 'string') return encoder.encode(value).buffer as ArrayBuffer
  if (value instanceof ArrayBuffer) return value
  const copy = new Uint8Array(value.length)
  copy.set(value)
  return copy.buffer
}

function fromBase64(value: string): ArrayBuffer {
  const bin = atob(value.trim())
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return bytes(out)
}

function subtle(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new ConfigError('This browser cannot sign API requests. Open the terminal over HTTPS.')
  }
  return crypto.subtle
}

async function hmac(
  secret: Binary,
  message: Binary,
  hash: 'SHA-256' | 'SHA-512',
): Promise<ArrayBuffer> {
  const key = await subtle().importKey('raw', bytes(secret), { name: 'HMAC', hash }, false, [
    'sign',
  ])
  return subtle().sign('HMAC', key, bytes(message))
}

async function sha256(message: string): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest('SHA-256', encoder.encode(message)))
}

function requireCreds(conn: BrokerConnection, def: BrokerDef) {
  if (!conn.key.trim()) throw new ConfigError(`Add your ${def.keyLabel || 'API key'} first.`)
  if (def.secretLabel && !conn.secret.trim()) throw new ConfigError(`Add your ${def.secretLabel} first.`)
}

interface BuiltRequest {
  url: string
  init: RequestInit
}

function bearerHeaders(key: string, second = ''): Record<string, string> {
  const headers: Record<string, string> = {}
  if (key) headers.Authorization = `Bearer ${key}`
  if (second.trim()) headers['X-Bridge-Key'] = second.trim()
  return headers
}

function alpacaHeaders(conn: BrokerConnection): Record<string, string> {
  return {
    'APCA-API-KEY-ID': conn.key.trim(),
    'APCA-API-SECRET-KEY': conn.secret,
  }
}

function asQuery(query: Record<string, string | number>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) params.set(key, String(value))
  return params.toString()
}

async function bybitRequest(
  conn: BrokerConnection,
  base: string,
  path: string,
  method: 'GET' | 'POST',
  query: Record<string, string> | null,
  body: Record<string, unknown> | null,
): Promise<BuiltRequest> {
  requireCreds(conn, defineBroker('bybit'))
  const timestamp = `${Date.now()}`
  const recvWindow = '5000'
  const queryString = query ? asQuery(query) : ''
  const rawBody = body ? JSON.stringify(body) : ''
  const payload = `${timestamp}${conn.key.trim()}${recvWindow}${body ? rawBody : `?${queryString}`}`
  const signature = toHex(await hmac(conn.secret, payload, 'SHA-256'))
  const headers: Record<string, string> = {
    'X-BAPI-API-KEY': conn.key.trim(),
    'X-BAPI-TIMESTAMP': timestamp,
    'X-BAPI-RECV-WINDOW': recvWindow,
    'X-BAPI-SIGN': signature,
  }
  if (body) headers['content-type'] = 'application/json'
  return {
    url: `${base}${path}${queryString ? `?${queryString}` : ''}`,
    init: { method, headers, body: body ? rawBody : undefined },
  }
}

async function binanceRequest(
  conn: BrokerConnection,
  base: string,
  path: string,
  method: 'GET' | 'POST',
  params: Record<string, string | number>,
): Promise<BuiltRequest> {
  requireCreds(conn, defineBroker('binance'))
  const query = asQuery({ ...params, recvWindow: 5000, timestamp: Date.now() })
  const signature = toHex(await hmac(conn.secret, query, 'SHA-256'))
  return {
    url: `${base}${path}?${query}&signature=${signature}`,
    init: {
      method,
      headers: { 'X-MBX-APIKEY': conn.key.trim() },
    },
  }
}

async function krakenRequest(
  conn: BrokerConnection,
  base: string,
  path: string,
  params: Record<string, string>,
): Promise<BuiltRequest> {
  requireCreds(conn, defineBroker('kraken'))
  let secret: ArrayBuffer
  try {
    secret = fromBase64(conn.secret)
  } catch {
    throw new ConfigError('Kraken’s private key must be the base64 value shown on the API key page.')
  }
  const nonce = `${Date.now()}`
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) body.set(key, value)
  body.set('nonce', nonce)
  const postdata = body.toString()
  const digest = await sha256(nonce + postdata)
  const pathBytes = encoder.encode(path)
  const message = new Uint8Array(pathBytes.length + digest.length)
  message.set(pathBytes)
  message.set(digest, pathBytes.length)
  const signature = toBase64(await hmac(secret, message, 'SHA-512'))
  return {
    url: `${base}${path}`,
    init: {
      method: 'POST',
      headers: {
        'API-Key': conn.key.trim(),
        'API-Sign': signature,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: postdata,
    },
  }
}

async function primexbtRequest(
  conn: BrokerConnection,
  base: string,
  path: string,
  method: 'GET' | 'POST',
  body: Record<string, unknown> | null,
): Promise<BuiltRequest> {
  requireCreds(conn, defineBroker('primexbt'))
  const timestamp = `${Date.now()}`
  const rawBody = body ? JSON.stringify(body) : ''
  const bodyDigest = toHex(await subtle().digest('SHA-256', encoder.encode(rawBody)))
  const signed = [method, path, '', timestamp, bodyDigest].join('\n')
  let key: CryptoKey
  try {
    key = await subtle().importKey('pkcs8', fromBase64(conn.secret), { name: 'Ed25519' }, false, [
      'sign',
    ])
  } catch {
    throw new ConfigError(
      'PrimeXBT needs the base64 PKCS8 Ed25519 secret issued with the key, and a browser with Ed25519 support.',
    )
  }
  const signature = toBase64(await subtle().sign('Ed25519', key, encoder.encode(signed)))
  const headers: Record<string, string> = {
    'X-API-KEY': conn.key.trim(),
    'X-API-TIMESTAMP': timestamp,
    'X-API-SIGNATURE': signature,
  }
  if (body) headers['content-type'] = 'application/json'
  return {
    url: `${base}${path}`,
    init: { method, headers, body: body ? rawBody : undefined },
  }
}

function accountPathOf(conn: BrokerConnection, def: BrokerDef): string {
  return conn.accountPath?.trim() || def.accountPath
}

function orderPathOf(conn: BrokerConnection, def: BrokerDef): string {
  return conn.orderPath?.trim() || def.orderPath
}

async function buildAccountRequest(conn: BrokerConnection, def: BrokerDef): Promise<BuiltRequest> {
  const base = endpointOf(conn)
  const path = accountPathOf(conn, def)
  switch (def.auth) {
    case 'alpaca':
      requireCreds(conn, def)
      return { url: `${base}${path}`, init: { method: 'GET', headers: alpacaHeaders(conn) } }
    case 'bybit':
      return bybitRequest(conn, base, path, 'GET', { accountType: 'UNIFIED' }, null)
    case 'binance':
      return binanceRequest(conn, base, path, 'GET', {})
    case 'kraken':
      return krakenRequest(conn, base, path, {})
    case 'primexbt':
      return primexbtRequest(conn, base, path, 'GET', null)
    default:
      return {
        url: `${base}${path}`,
        init: {
          method: 'GET',
          headers: bearerHeaders(conn.key.trim(), conn.secret),
        },
      }
  }
}

async function buildOrderRequest(
  conn: BrokerConnection,
  def: BrokerDef,
  order: BrokerOrder,
  symbol: string,
): Promise<BuiltRequest> {
  const base = endpointOf(conn)
  const path = orderPathOf(conn, def)
  const qty = Number(order.qty.toFixed(8))

  switch (def.auth) {
    case 'alpaca':
      requireCreds(conn, def)
      return {
        url: `${base}${path}`,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...alpacaHeaders(conn) },
          body: JSON.stringify({
            symbol,
            qty: String(qty),
            side: order.side,
            type: 'market',
            time_in_force: 'day',
          }),
        },
      }
    case 'bybit':
      return bybitRequest(
        conn,
        base,
        path,
        'POST',
        null,
        {
          category: 'spot',
          symbol,
          side: order.side === 'buy' ? 'Buy' : 'Sell',
          orderType: 'Market',
          qty: String(qty),
        },
      )
    case 'binance':
      return binanceRequest(conn, base, path, 'POST', {
        symbol,
        side: order.side === 'buy' ? 'BUY' : 'SELL',
        type: 'MARKET',
        quantity: String(qty),
        newOrderRespType: 'RESULT',
      })
    case 'kraken':
      return krakenRequest(conn, base, path, {
        pair: symbol,
        type: order.side,
        ordertype: 'market',
        volume: String(qty),
      })
    case 'primexbt':
      return primexbtRequest(conn, base, path, 'POST', {
        symbol,
        side: order.side === 'buy' ? 'BUY' : 'SELL',
        qty,
        clientOrderId: `kestrel-${Date.now().toString(36)}`,
      })
    default:
      return {
        url: `${base}${path}`,
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...bearerHeaders(conn.key.trim(), conn.secret),
          },
          body: JSON.stringify({
            symbol,
            side: order.side,
            qty,
            type: 'market',
            time_in_force: 'day',
            client_order_id: `kestrel-${Date.now().toString(36)}`,
            reference_price: order.price,
          }),
        },
      }
  }
}

async function withTimeout(url: string, init: RequestInit, ms = 9000): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Each venue reports refusals its own way, sometimes with HTTP 200. */
function venueError(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const body = json as Record<string, unknown>
  if (Array.isArray(body.error) && body.error.length > 0) return String(body.error[0])
  if (typeof body.retCode === 'number' && body.retCode !== 0) {
    return String(body.retMsg ?? `retCode ${body.retCode}`)
  }
  if (typeof body.success === 'boolean' && !body.success) {
    const detail = body.message ?? body.error
    return typeof detail === 'string' ? detail : 'the request was refused'
  }
  if (typeof body.code === 'number' && body.code !== 0 && body.code !== 200) {
    return String(body.msg ?? `code ${body.code}`)
  }
  return null
}

function failureHint(conn: BrokerConnection, def: BrokerDef, err: unknown): string {
  if (err instanceof ConfigError) return err.message
  if (err instanceof DOMException && err.name === 'AbortError') {
    return `${def.name} did not answer in time.`
  }
  if (def.auth === 'primexbt') {
    return `PrimeXBT refuses direct browser calls (CORS), so the signed request never got out. Use the PrimeXBT via bridge card instead — it sends your bridge token to a Worker that signs for you, with account path /account and order path /orders.`
  }
  return `${conn.label} could not be reached from this browser. Most exchanges block direct calls with CORS — run a small bridge at ${endpointOf(conn) || 'an endpoint you control'} and point this connection at it.`
}

/**
 * What a bridge reports about itself. Health is deliberately unauthenticated on
 * the bridge, so this can say which secrets are missing before a token is even
 * tried.
 */
export interface BridgeHealth {
  bridge?: string
  venue?: string
  configured?: Record<string, boolean>
  limits?: { symbols?: string[]; maxNotional?: number | null; rateLimitPerMinute?: number }
  routes?: Record<string, string>
  error?: string
}

export async function probeBridge(conn: BrokerConnection): Promise<string> {
  const base = endpointOf(conn)
  if (!base) return 'Add the bridge endpoint first.'
  try {
    const res = await withTimeout(`${base}/health`, { method: 'GET' })
    const body = safeJson(await res.text()) as BridgeHealth | null
    if (!res.ok || !body) return `The bridge answered ${res.status} without a health body.`
    if (body.error) return `The bridge reported: ${body.error}`
    const conf = body.configured ?? {}
    const ready = conf.key && conf.secret && conf.token
    const parts = Object.entries(conf).map(([name, on]) => `${name}: ${on ? 'set' : 'missing'}`)
    const cap = body.limits?.maxNotional
    const limit = body.limits?.rateLimitPerMinute
    return [
      `${body.bridge ?? 'Bridge'} ${ready ? 'is ready' : 'is not ready'} — ${parts.join(', ')}`,
      cap ? `cap $${cap} per order` : 'no notional cap',
      limit ? `${limit} req/min` : '',
      body.limits?.symbols?.length ? body.limits.symbols.slice(0, 6).join(' ') : '',
    ]
      .filter(Boolean)
      .join(' · ')
  } catch (err) {
    return failureHint(conn, defineBroker(conn.kind), err)
  }
}

/** One open position on the venue, as far as the bridge's JSON allows. */
export interface VenuePosition {
  id: string
  symbol: string
  side: string
  qty: number
}

function pick(source: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    const value = source[name]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function positionList(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== 'object') return []
  const body = json as Record<string, unknown>
  for (const key of ['positions', 'data', 'result', 'items']) {
    const value = body[key]
    if (Array.isArray(value)) return value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    if (value && typeof value === 'object') {
      const nested = positionList(value)
      if (nested.length > 0) return nested
    }
  }
  return []
}

export async function readVenuePositions(conn: BrokerConnection): Promise<VenuePosition[]> {
  const base = endpointOf(conn)
  if (!base) return []
  const res = await withTimeout(`${base}/positions`, {
    method: 'GET',
    headers: bearerHeaders(conn.key.trim(), conn.secret),
  })
  if (!res.ok) return []
  const json = safeJson(await res.text())
  return positionList(json).map((row, index) => {
    const symbol = String(pick(row, ['symbol', 'pair', 'instrument', 'market']) ?? '—')
    const rawQty = pick(row, ['qty', 'quantity', 'size', 'amount', 'volume'])
    const qty = Number(rawQty)
    return {
      id: String(pick(row, ['id', 'positionId', 'position_id']) ?? `${symbol}-${index}`),
      symbol,
      side: String(pick(row, ['side', 'direction', 'type']) ?? '—'),
      qty: Number.isFinite(qty) ? qty : 0,
    }
  })
}

/** Asks the bridge to close one position. */
export async function closeVenuePosition(
  conn: BrokerConnection,
  position: VenuePosition,
): Promise<{ ok: boolean; message: string }> {
  const base = endpointOf(conn)
  if (!base) return { ok: false, message: 'No bridge endpoint set.' }
  try {
    const res = await withTimeout(`${base}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bearerHeaders(conn.key.trim(), conn.secret) },
      body: JSON.stringify({
        symbol: position.symbol,
        positionId: position.id,
        ...(position.qty > 0 ? { qty: position.qty } : {}),
      }),
    })
    const body = safeJson(await res.text())
    if (!res.ok) {
      const detail = venueError(body)
      return { ok: false, message: `Close refused (${res.status})${detail ? ` — ${detail}` : ''}.` }
    }
    return { ok: true, message: `Close sent for ${position.symbol}.` }
  } catch (err) {
    return { ok: false, message: failureHint(conn, defineBroker(conn.kind), err) }
  }
}

/**
 * The venue's own entry price for a symbol, when the bridge exposes positions
 * in a shape this can read. Null means the terminal keeps its reference price.
 */
export async function venueFillPrice(
  conn: BrokerConnection,
  symbol: string,
): Promise<number | null> {
  const base = endpointOf(conn)
  if (!base) return null
  const wanted = venueSymbol(conn.kind, symbol) ?? symbol
  try {
    const res = await withTimeout(`${base}/positions`, {
      method: 'GET',
      headers: bearerHeaders(conn.key.trim(), conn.secret),
    })
    if (!res.ok) return null
    const rows = positionList(safeJson(await res.text()))
    const row = rows.find((r) => String(pick(r, ['symbol', 'pair', 'instrument', 'market']) ?? '') === wanted)
    if (!row) return null
    const price = Number(pick(row, ['entryPrice', 'avgPrice', 'averagePrice', 'openPrice', 'price']))
    return Number.isFinite(price) && price > 0 ? price : null
  } catch {
    return null
  }
}

/**
 * Verifies the connection by asking the endpoint for the account behind the
 * key. Anything the browser cannot reach (CORS, bad key, wrong path) is
 * reported, never treated as a success.
 */
export async function verifyBroker(
  conn: BrokerConnection,
): Promise<{ status: 'linked' | 'error'; message: string }> {
  if (conn.kind === 'paper') {
    return { status: 'linked', message: 'Simulated fills in this browser.' }
  }
  const def = defineBroker(conn.kind)
  if (!endpointOf(conn)) {
    return { status: 'error', message: 'Add the endpoint you want requests sent to first.' }
  }
  try {
    const request = await buildAccountRequest(conn, def)
    const res = await withTimeout(request.url, request.init)
    const body = safeJson(await res.text())
    if (!res.ok) {
      const detail = venueError(body)
      return {
        status: 'error',
        message: `${def.name} answered ${res.status}${detail ? ` — ${detail}` : ''}. Check the key and the account path.`,
      }
    }
    const problem = venueError(body)
    if (problem) return { status: 'error', message: `${def.name}: ${problem}` }
    return { status: 'linked', message: `Account verified with ${def.name}.` }
  } catch (err) {
    return { status: 'error', message: failureHint(conn, def, err) }
  }
}

/**
 * Sends a market order to the linked venue with a locally built signature. The
 * paper ledger only records the fill once the venue accepts the order.
 */
export async function submitBrokerOrder(
  conn: BrokerConnection,
  order: BrokerOrder,
): Promise<{ ok: boolean; message: string }> {
  if (conn.kind === 'paper') {
    return { ok: true, message: 'Filled on the paper ledger.' }
  }
  const def = defineBroker(conn.kind)
  if (!endpointOf(conn)) return { ok: false, message: 'No endpoint set for this broker.' }

  const symbol = venueSymbol(conn.kind, order.symbol)
  if (!symbol) {
    return {
      ok: false,
      message: `${def.name} does not list ${order.symbol}. It trades ${def.coverage}`,
    }
  }

  try {
    const request = await buildOrderRequest(conn, def, order, symbol)
    const res = await withTimeout(request.url, request.init)
    const body = safeJson(await res.text())
    if (!res.ok) {
      const detail = venueError(body)
      return {
        ok: false,
        message: `${def.name} rejected ${symbol} (${res.status})${detail ? ` — ${detail}` : ''}.`,
      }
    }
    const problem = venueError(body)
    if (problem) return { ok: false, message: `${def.name} rejected ${symbol}: ${problem}` }
    return {
      ok: true,
      message: `${symbol} ${order.side} ${Number(order.qty.toFixed(6))} accepted by ${def.name}.`,
    }
  } catch (err) {
    return { ok: false, message: failureHint(conn, def, err) }
  }
}
