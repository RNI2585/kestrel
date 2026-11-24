export type AssetClass = 'Stocks' | 'Metals' | 'Crypto' | 'Fx' | 'Energy'

export const ASSET_CLASSES: AssetClass[] = ['Stocks', 'Metals', 'Crypto', 'Fx', 'Energy']

export const CLASS_COLOR: Record<AssetClass, string> = {
  Stocks: '#4da3ff',
  Metals: '#00b24b',
  Crypto: '#a48be8',
  Fx: '#5fa8ff',
  Energy: '#ffb020',
}

export interface Instrument {
  symbol: string
  name: string
  cls: AssetClass
  /** decimal places for quoting */
  dp: number
  price: number
  prevClose: number
  history: number[]
  vol: number
  base: number
  /** True once a live quote feed has anchored this instrument. */
  live?: boolean
  /** The feed that last set the price, e.g. Coinbase. */
  source?: string
  /** When the live price was last applied. */
  liveAt?: number
}

/** One live price a feed returns, already normalised to US dollars. */
export interface QuoteUpdate {
  price: number
  /** The reference close the feed reports, when it has one. */
  prevClose?: number
  source: string
  at: number
}

interface InstrumentDef {
  symbol: string
  name: string
  cls: AssetClass
  base: number
  vol: number
  dp: number
}

const DEFS: InstrumentDef[] = [
  { symbol: 'AAPL', name: 'Apple', cls: 'Stocks', base: 228.4, vol: 0.0011, dp: 2 },
  { symbol: 'NVDA', name: 'Nvidia', cls: 'Stocks', base: 118.6, vol: 0.0018, dp: 2 },
  { symbol: 'TSLA', name: 'Tesla', cls: 'Stocks', base: 251.2, vol: 0.0019, dp: 2 },
  { symbol: 'MSFT', name: 'Microsoft', cls: 'Stocks', base: 417.8, vol: 0.001, dp: 2 },
  { symbol: 'JPM', name: 'JPMorgan Chase', cls: 'Stocks', base: 219.5, vol: 0.0009, dp: 2 },
  { symbol: 'XAU', name: 'Gold spot', cls: 'Metals', base: 2412.6, vol: 0.0008, dp: 2 },
  { symbol: 'XAG', name: 'Silver spot', cls: 'Metals', base: 29.42, vol: 0.0012, dp: 3 },
  { symbol: 'XPT', name: 'Platinum spot', cls: 'Metals', base: 962.1, vol: 0.0011, dp: 2 },
  { symbol: 'BTC', name: 'Bitcoin', cls: 'Crypto', base: 63850, vol: 0.0016, dp: 2 },
  { symbol: 'ETH', name: 'Ether', cls: 'Crypto', base: 2480.4, vol: 0.0017, dp: 2 },
  { symbol: 'SOL', name: 'Solana', cls: 'Crypto', base: 142.6, vol: 0.0021, dp: 2 },
  { symbol: 'XRP', name: 'XRP', cls: 'Crypto', base: 0.612, vol: 0.0024, dp: 4 },
  { symbol: 'ADA', name: 'Cardano', cls: 'Crypto', base: 0.624, vol: 0.0025, dp: 4 },
  { symbol: 'DOGE', name: 'Dogecoin', cls: 'Crypto', base: 0.1524, vol: 0.0028, dp: 4 },
  { symbol: 'AVAX', name: 'Avalanche', cls: 'Crypto', base: 36.42, vol: 0.0026, dp: 2 },
  { symbol: 'LINK', name: 'Chainlink', cls: 'Crypto', base: 16.84, vol: 0.0024, dp: 3 },
  { symbol: 'DOT', name: 'Polkadot', cls: 'Crypto', base: 7.35, vol: 0.0023, dp: 3 },
  { symbol: 'LTC', name: 'Litecoin', cls: 'Crypto', base: 82.4, vol: 0.002, dp: 2 },
  { symbol: 'BCH', name: 'Bitcoin Cash', cls: 'Crypto', base: 468.2, vol: 0.0022, dp: 2 },
  { symbol: 'SUI', name: 'Sui', cls: 'Crypto', base: 1.784, vol: 0.0029, dp: 3 },
  { symbol: 'EURUSD', name: 'Euro / US dollar', cls: 'Fx', base: 1.0842, vol: 0.0004, dp: 4 },
  { symbol: 'USDJPY', name: 'US dollar / yen', cls: 'Fx', base: 151.36, vol: 0.0005, dp: 3 },
  { symbol: 'GBPUSD', name: 'Sterling / US dollar', cls: 'Fx', base: 1.2718, vol: 0.0005, dp: 4 },
  { symbol: 'WTI', name: 'WTI crude oil', cls: 'Energy', base: 78.42, vol: 0.0014, dp: 2 },
  { symbol: 'NG', name: 'Natural gas', cls: 'Energy', base: 2.684, vol: 0.0022, dp: 3 },
]

const HISTORY = 320

/** The crypto symbols, derived once so the poller and the socket agree. */
export const CRYPTO_SYMBOLS = DEFS.filter((d) => d.cls === 'Crypto').map((d) => d.symbol)

function randn(): number {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export class MarketEngine {
  instruments: Instrument[]

  constructor() {
    this.instruments = DEFS.map((d) => {
      const history: number[] = []
      let p = d.base * (1 + (Math.random() - 0.5) * 0.012)
      for (let i = 0; i < HISTORY; i++) {
        const shock = randn() * d.vol
        const pull = ((d.base - p) / d.base) * 0.0035
        p = Math.max(p * (1 + shock + pull), d.base * 0.4)
        history.push(p)
      }
      const dp = d.cls === 'Fx' && d.base > 10 ? 3 : d.dp
      return {
        symbol: d.symbol,
        name: d.name,
        cls: d.cls,
        dp,
        price: history[history.length - 1],
        prevClose: history[0],
        history,
        vol: d.vol,
        base: d.base,
      }
    })
  }

  get(symbol: string): Instrument | undefined {
    return this.instruments.find((i) => i.symbol === symbol)
  }

  /**
   * Anchors instruments to live quotes: the history is rescaled so the chart
   * joins the real price, the day's reference close comes from the feed, and
   * the simulation's drift then works around that price instead of its own.
   * Returns how many instruments were updated.
   */
  applyLive(updates: Record<string, QuoteUpdate>): number {
    let applied = 0
    for (const ins of this.instruments) {
      const quote = updates[ins.symbol]
      if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) continue
      const ratio = quote.price / ins.price
      if (!Number.isFinite(ratio) || ratio <= 0) continue
      ins.history = ins.history.map((p) => p * ratio)
      ins.prevClose =
        quote.prevClose && quote.prevClose > 0 ? quote.prevClose : ins.prevClose * ratio
      ins.price = quote.price
      ins.base = quote.price
      ins.live = true
      ins.source = quote.source
      ins.liveAt = quote.at
      applied += 1
    }
    return applied
  }

  tick(): void {
    for (const ins of this.instruments) {
      const shock = randn() * ins.vol
      const pull = ((ins.base - ins.price) / ins.base) * 0.002
      let next = ins.price * (1 + shock + pull)
      // occasional data spike keeps the tape lively
      if (Math.random() < 0.004) next *= 1 + randn() * ins.vol * 9
      ins.price = Math.max(next, ins.base * 0.25)
      ins.history.push(ins.price)
      if (ins.history.length > HISTORY) ins.history.shift()
    }
  }
}

export function changePct(ins: Instrument): number {
  return ((ins.price - ins.prevClose) / ins.prevClose) * 100
}

/**
 * The pip a market is quoted in. FX uses the conventional pip, with the yen
 * pairs on 0.01. Crypto has no single standard, so the pip steps with the
 * price tier to keep one pip a similar slice of the tape across coins.
 */
export function pipSize(priceValue: number, cls?: AssetClass): number {
  const abs = Math.abs(priceValue)
  if (cls === 'Fx') return abs > 10 ? 0.01 : 0.0001
  if (abs >= 10_000) return 10
  if (abs >= 1_000) return 1
  if (abs >= 100) return 0.1
  if (abs >= 10) return 0.01
  if (abs >= 1) return 0.001
  return 0.0001
}

/** A pip size shown the way the market quotes it. */
export function pipLabel(step: number): string {
  if (step >= 1) return step.toFixed(1)
  if (step >= 0.01) return step.toFixed(2)
  return step.toFixed(4)
}
