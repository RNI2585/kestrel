import { CRYPTO_SYMBOLS, type QuoteUpdate } from './market'

/**
 * Free, key-less quotes the browser may call directly (all three send
 * `Access-Control-Allow-Origin: *`):
 *
 *  - Coinbase Exchange for crypto, with the exchange's 24h open as the
 *    reference for the day's change.
 *  - gold-api.com for spot metals.
 *  - open.er-api.com for the daily FX fix.
 *
 * Stocks and energy have no free, key-less, CORS-open feed, so they keep the
 * simulated tape and are marked as such in the terminal.
 */

const METALS = ['XAU', 'XAG', 'XPT']

/** Pairs quoted as units of `quote` per one `base`, the usual FX convention. */
const FX: { symbol: string; base: string; quote: string }[] = [
  { symbol: 'EURUSD', base: 'EUR', quote: 'USD' },
  { symbol: 'USDJPY', base: 'USD', quote: 'JPY' },
  { symbol: 'GBPUSD', base: 'GBP', quote: 'USD' },
]

export interface LiveSnapshot {
  quotes: Record<string, QuoteUpdate>
  at: number
  /** Quote feeds that answered this pull, with what they cover. */
  sources: { name: string; detail: string }[]
  /** Feeds that failed, so the desk can say the tape is partly simulated. */
  failed: string[]
}

async function getJson(url: string, ms = 9000): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim())
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

async function cryptoQuotes(at: number, failed: string[]): Promise<Record<string, QuoteUpdate>> {
  const out: Record<string, QuoteUpdate> = {}
  let missed = 0
  await Promise.all(
    CRYPTO_SYMBOLS.map(async (symbol) => {
      try {
        const raw = (await getJson(
          `https://api.exchange.coinbase.com/products/${symbol}-USD/stats`,
        )) as { open?: string; last?: string }
        const price = num(raw.last)
        if (price === null) {
          missed += 1
          return
        }
        out[symbol] = { price, prevClose: num(raw.open) ?? undefined, source: 'Coinbase', at }
      } catch {
        missed += 1
      }
    }),
  )
  if (missed > 0) failed.push(`Coinbase missed ${missed} of ${CRYPTO_SYMBOLS.length} pairs`)
  return out
}

async function metalQuotes(at: number, failed: string[]): Promise<Record<string, QuoteUpdate>> {
  const out: Record<string, QuoteUpdate> = {}
  let missed = 0
  await Promise.all(
    METALS.map(async (symbol) => {
      try {
        const raw = (await getJson(`https://api.gold-api.com/price/${symbol}`)) as { price?: number }
        const price = num(raw.price)
        if (price === null) {
          missed += 1
          return
        }
        out[symbol] = { price, source: 'gold-api', at }
      } catch {
        missed += 1
      }
    }),
  )
  if (missed > 0) failed.push(`gold-api missed ${missed} of ${METALS.length} metals`)
  return out
}

async function fxQuotes(at: number, failed: string[]): Promise<Record<string, QuoteUpdate>> {
  try {
    const raw = (await getJson('https://open.er-api.com/v6/latest/USD')) as {
      result?: string
      rates?: Record<string, number>
    }
    const rates = raw.rates
    if (raw.result !== 'success' || !rates) throw new Error('no rates')
    const usdPer = (code: string) => {
      const perUsd = num(rates[code])
      return perUsd === null ? null : 1 / perUsd
    }
    const out: Record<string, QuoteUpdate> = {}
    for (const pair of FX) {
      const baseUsd = pair.base === 'USD' ? 1 : usdPer(pair.base)
      const quoteUsd = pair.quote === 'USD' ? 1 : usdPer(pair.quote)
      if (baseUsd === null || quoteUsd === null) continue
      out[pair.symbol] = { price: baseUsd / quoteUsd, source: 'open.er-api', at }
    }
    return out
  } catch {
    failed.push('open.er-api FX fix unavailable')
    return {}
  }
}

/** Pulls every live quote the terminal can reach. Never throws. */
export async function fetchLiveQuotes(): Promise<LiveSnapshot> {
  const at = Date.now()
  const failed: string[] = []
  const [crypto, metals, fx] = await Promise.all([
    cryptoQuotes(at, failed),
    metalQuotes(at, failed),
    fxQuotes(at, failed),
  ])
  const quotes = { ...crypto, ...metals, ...fx }
  const sources: { name: string; detail: string }[] = []
  if (Object.keys(crypto).length > 0) {
    sources.push({ name: 'Coinbase', detail: `${Object.keys(crypto).length} crypto pairs` })
  }
  if (Object.keys(metals).length > 0) {
    sources.push({ name: 'gold-api', detail: 'spot metals' })
  }
  if (Object.keys(fx).length > 0) {
    sources.push({ name: 'open.er-api', detail: 'daily FX fix' })
  }
  return { quotes, at, sources, failed }
}
