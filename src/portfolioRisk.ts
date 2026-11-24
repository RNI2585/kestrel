import type { AssetClass } from './market'

/**
 * Portfolio-level risk. The governor guards the account one trade at a time;
 * this looks at the book as a whole: how much of the equity is working, how
 * concentrated it is, which theme would hurt most if it repriced, and what the
 * currency mix actually is once FX pairs are netted against each other.
 */

export interface RiskRow {
  symbol: string
  cls: AssetClass
  /** Market value of the position, always positive on this long-only desk. */
  value: number
}

export interface Exposure {
  symbol: string
  cls: AssetClass
  value: number
  /** Share of equity, in percent. */
  pct: number
}

/** Correlated groups: a name in one of these moves with the rest of it. */
export const CLUSTERS: { id: string; name: string; symbols: string[] }[] = [
  { id: 'us-equities', name: 'US equities', symbols: ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'JPM'] },
  { id: 'metals', name: 'Precious metals', symbols: ['XAU', 'XAG', 'XPT'] },
  { id: 'crypto-majors', name: 'Crypto majors', symbols: ['BTC', 'ETH'] },
  {
    id: 'crypto-alts',
    name: 'Crypto alts',
    symbols: ['SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT', 'LTC', 'BCH', 'SUI'],
  },
  { id: 'fx', name: 'Currencies', symbols: ['EURUSD', 'USDJPY', 'GBPUSD'] },
  { id: 'energy', name: 'Energy', symbols: ['WTI', 'NG'] },
]

export interface ClusterExposure {
  id: string
  name: string
  value: number
  pct: number
  /** What a uniform shock of `shockPct` to this whole group would cost. */
  shockLoss: number
}

export interface PortfolioRisk {
  gross: number
  grossPct: number
  largest: Exposure | null
  /** Share of equity in the three biggest positions. */
  top3Pct: number
  /** Herfindahl index of position weights, 0–1. Over 0.25 is concentrated. */
  hhi: number
  clusters: ClusterExposure[]
  /** The cluster a shock would cost the most in, if anything is held. */
  worst: ClusterExposure | null
  shockPct: number
}

function clusterOf(symbol: string): string {
  for (const cluster of CLUSTERS) if (cluster.symbols.includes(symbol)) return cluster.id
  return 'other'
}

export function portfolioRisk(rows: RiskRow[], equity: number, shockPct = 5): PortfolioRisk {
  const safeEquity = equity > 0 ? equity : 0
  const sorted = [...rows].sort((a, b) => b.value - a.value)
  const gross = sorted.reduce((sum, row) => sum + row.value, 0)
  const exposure: Exposure[] = sorted.map((row) => ({
    symbol: row.symbol,
    cls: row.cls,
    value: row.value,
    pct: safeEquity > 0 ? (row.value / safeEquity) * 100 : 0,
  }))

  const weights = exposure.map((row) => (gross > 0 ? row.value / gross : 0))
  const hhi = weights.reduce((sum, w) => sum + w * w, 0)
  const top3Pct =
    safeEquity > 0
      ? (sorted.slice(0, 3).reduce((sum, row) => sum + row.value, 0) / safeEquity) * 100
      : 0

  const buckets = new Map<string, number>()
  for (const row of sorted) {
    const id = clusterOf(row.symbol)
    buckets.set(id, (buckets.get(id) ?? 0) + row.value)
  }
  const clusters: ClusterExposure[] = [...buckets.entries()]
    .map(([id, value]) => {
      const known = CLUSTERS.find((c) => c.id === id)
      return {
        id,
        name: known?.name ?? 'Other',
        value,
        pct: safeEquity > 0 ? (value / safeEquity) * 100 : 0,
        shockLoss: value * (shockPct / 100),
      }
    })
    .sort((a, b) => b.value - a.value)

  return {
    gross,
    grossPct: safeEquity > 0 ? (gross / safeEquity) * 100 : 0,
    largest: exposure[0] ?? null,
    top3Pct,
    hhi,
    clusters,
    worst: clusters[0] ?? null,
    shockPct,
  }
}

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'JPY'

/** Which two currencies a pair is exposed to: long the base, short the quote. */
const PAIR_SIDES: Record<string, [CurrencyCode, CurrencyCode]> = {
  EURUSD: ['EUR', 'USD'],
  GBPUSD: ['GBP', 'USD'],
  USDJPY: ['USD', 'JPY'],
}

export interface CurrencyExposure {
  code: CurrencyCode
  /** Signed USD value: a long exposure is positive, a short one negative. */
  value: number
  /** Share of the gross absolute currency exposure, in percent. */
  pct: number
}

/**
 * The book's currency mix in USD terms. Everything else on the desk settles in
 * dollars, so only FX pairs move this: a long EURUSD is long euro and short
 * dollars, and a long USDJPY is the other way round.
 */
export function currencyExposure(
  positions: { symbol: string; qty: number; price: number }[],
  quotes: Record<string, number> = {},
): CurrencyExposure[] {
  const values = new Map<CurrencyCode, number>()
  const add = (code: CurrencyCode, value: number) => {
    values.set(code, (values.get(code) ?? 0) + value)
  }

  for (const position of positions) {
    if (!Number.isFinite(position.qty) || position.qty === 0) continue
    const price = quotes[position.symbol] ?? position.price
    const pair = PAIR_SIDES[position.symbol]
    if (pair) {
      // A USD/JPY position's size is in dollars already; the other pairs are
      // sized in their base currency.
      const notional =
        position.symbol === 'USDJPY'
          ? Math.abs(position.qty)
          : Math.abs(position.qty * (Number.isFinite(price) ? price : 0))
      const sign = position.qty >= 0 ? 1 : -1
      add(pair[0], notional * sign)
      add(pair[1], -notional * sign)
      continue
    }
    add('USD', position.qty * (Number.isFinite(price) ? price : 0))
  }

  const gross = [...values.values()].reduce((sum, value) => sum + Math.abs(value), 0)
  return [...values.entries()]
    .filter(([, value]) => Math.abs(value) > 0.005)
    .map(([code, value]) => ({
      code,
      value,
      pct: gross > 0 ? (Math.abs(value) / gross) * 100 : 0,
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
}

