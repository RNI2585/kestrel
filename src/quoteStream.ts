import type { QuoteUpdate } from './market'
import { httpUrlError } from './urlPolicy'

/**
 * Streaming quotes.
 *
 * Coinbase's public ticker socket is key-less and open to browsers, so crypto
 * arrives as it trades instead of being polled once a minute. Everything else
 * on this desk either has a slow public feed (metals, the daily FX fix) or no
 * key-less feed at all (stocks, energy) — those can be streamed from a bridge
 * you run yourself, pointed at with an SSE URL in Settings. Both paths degrade
 * to the poller when they are unavailable.
 */

export type StreamState = 'idle' | 'connecting' | 'live' | 'closed' | 'error'

export interface StreamStatus {
  state: StreamState
  detail: string
  at: number
}

export const COINBASE_WS = 'wss://ws-feed.exchange.coinbase.com'

export interface TickerMsg {
  symbol: string
  price: number
  prevClose?: number
}

function positive(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Reads one Coinbase ticker frame; anything else returns null. */
export function coinbaseTicker(raw: unknown): TickerMsg | null {
  if (typeof raw !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const body = parsed as Record<string, unknown>
  if (body.type !== 'ticker') return null
  const product = typeof body.product_id === 'string' ? body.product_id : ''
  const symbol = product.split('-')[0]
  if (!symbol) return null
  const price = positive(body.price)
  if (price === null) return null
  return { symbol, price, prevClose: positive(body.open_24h) ?? undefined }
}

/**
 * Reads one bridge event: a single quote, or a batch of them. That is the shape
 * the settings screen documents, and one shape is enough.
 */
export function bridgeQuotes(raw: string): Record<string, QuoteUpdate> {
  const at = Date.now()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }

  const out: Record<string, QuoteUpdate> = {}
  const add = (symbol: unknown, price: unknown, prevClose?: unknown, source?: unknown) => {
    if (typeof symbol !== 'string') return
    const value = positive(price)
    if (value === null) return
    out[symbol] = {
      price: value,
      prevClose: positive(prevClose) ?? undefined,
      source: typeof source === 'string' && source ? source : 'bridge stream',
      at,
    }
  }

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue
      const row = entry as Record<string, unknown>
      add(row.symbol, row.price ?? row.last, row.prevClose ?? row.open, row.source)
    }
    return out
  }

  if (!parsed || typeof parsed !== 'object') return out
  const body = parsed as Record<string, unknown>
  add(body.symbol, body.price ?? body.last, body.prevClose ?? body.open, body.source)
  return out
}

export interface StreamHandlers {
  onQuotes: (quotes: Record<string, QuoteUpdate>) => void
  onStatus: (status: StreamStatus) => void
  /** Overridable for tests and for a different public ticker. */
  url?: string
}

/**
 * Connects the Coinbase ticker socket and reconnects with backoff when it
 * drops. Returns a stop function; calling it closes the socket for good.
 */
export function startCoinbaseStream(symbols: string[], handlers: StreamHandlers): () => void {
  const { onQuotes, onStatus } = handlers
  const url = handlers.url ?? COINBASE_WS
  const products = symbols.map((s) => `${s}-USD`)
  if (products.length === 0) return () => {}

  if (typeof WebSocket === 'undefined') {
    onStatus({ state: 'idle', detail: 'This browser has no WebSocket support', at: Date.now() })
    return () => {}
  }

  let socket: WebSocket | null = null
  let retry = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const connect = () => {
    if (stopped) return
    onStatus({ state: 'connecting', detail: `Opening Coinbase ticker for ${products.length} pairs`, at: Date.now() })
    let next: WebSocket
    try {
      next = new WebSocket(url)
    } catch {
      onStatus({ state: 'error', detail: 'Coinbase socket could not be opened', at: Date.now() })
      schedule()
      return
    }
    socket = next

    next.onopen = () => {
      retry = 0
      try {
        next.send(
          JSON.stringify({
            type: 'subscribe',
            product_ids: products,
            channels: ['ticker'],
          }),
        )
      } catch {
        // the close handler will deal with a socket that cannot take a send
      }
      onStatus({ state: 'live', detail: `Streaming ${products.length} crypto pairs from Coinbase`, at: Date.now() })
    }

    next.onmessage = (event: MessageEvent) => {
      const ticker = coinbaseTicker(typeof event.data === 'string' ? event.data : '')
      if (!ticker) return
      onQuotes({
        [ticker.symbol]: {
          price: ticker.price,
          prevClose: ticker.prevClose,
          source: 'Coinbase stream',
          at: Date.now(),
        },
      })
    }

    next.onerror = () => {
      if (stopped) return
      onStatus({ state: 'error', detail: 'Coinbase stream dropped — retrying', at: Date.now() })
    }

    next.onclose = () => {
      if (stopped) return
      onStatus({ state: 'closed', detail: 'Coinbase stream closed — retrying', at: Date.now() })
      schedule()
    }
  }

  const schedule = () => {
    if (stopped || timer) return
    retry = Math.min(retry + 1, 5)
    const wait = Math.min(20_000, 1_000 * 2 ** (retry - 1))
    timer = setTimeout(() => {
      timer = null
      connect()
    }, wait)
  }

  connect()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      try {
        socket.close()
      } catch {
        // already gone
      }
      socket = null
    }
  }
}

/**
 * Subscribes to an SSE bridge that emits quote JSON. EventSource reconnects on
 * its own, so there is no retry loop here. Returns a stop function.
 */
export function startBridgeStream(url: string, handlers: Omit<StreamHandlers, 'url'>): () => void {
  const { onQuotes, onStatus } = handlers
  const target = url.trim()
  if (!target) return () => {}
  const urlProblem = httpUrlError(target, 'Quote stream')
  if (urlProblem) {
    onStatus({ state: 'error', detail: urlProblem, at: Date.now() })
    return () => {}
  }
  if (typeof EventSource === 'undefined') {
    onStatus({ state: 'idle', detail: 'This browser has no EventSource support', at: Date.now() })
    return () => {}
  }

  let source: EventSource
  try {
    source = new EventSource(target)
  } catch {
    onStatus({ state: 'error', detail: 'The quote stream URL could not be opened', at: Date.now() })
    return () => {}
  }

  source.onopen = () =>
    onStatus({ state: 'live', detail: `Streaming your bridge at ${target}`, at: Date.now() })
  source.onmessage = (event: MessageEvent) => {
    const quotes = bridgeQuotes(typeof event.data === 'string' ? event.data : '')
    if (Object.keys(quotes).length > 0) onQuotes(quotes)
  }
  source.onerror = () =>
    onStatus({ state: 'error', detail: 'The quote stream dropped — retrying', at: Date.now() })

  return () => {
    source.onopen = null
    source.onmessage = null
    source.onerror = null
    source.close()
  }
}
