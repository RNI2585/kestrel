import type { StrategyId } from './bot'
import { FEE, type Fill } from './trade'
import type { EquityPoint } from './timeline'

/**
 * Trade analytics. A fill is one side of an order; a round trip is a matched
 * entry and exit, which is the only unit a win rate or an expectancy means
 * anything on. Buys open lots, sells consume the oldest lot first, so the
 * figures here agree with the per-strategy record the rest of the desk uses.
 */

export interface RoundTrip {
  symbol: string
  /** The model that opened the trade, when one did. */
  strategy?: StrategyId
  qty: number
  entryTs: number
  exitTs: number
  entryPrice: number
  exitPrice: number
  /** Gross of fees, so the fee drag can be shown separately. */
  pnl: number
  fees: number
}

interface Lot {
  qty: number
  price: number
  ts: number
  strategy?: StrategyId
}

export function roundTrips(fills: Fill[]): RoundTrip[] {
  const lots = new Map<string, Lot[]>()
  const out: RoundTrip[] = []

  for (const fill of [...fills].sort((a, b) => a.ts - b.ts)) {
    if (!Number.isFinite(fill.qty) || fill.qty <= 0) continue
    if (fill.side === 'buy') {
      const queue = lots.get(fill.symbol) ?? []
      queue.push({
        qty: fill.qty,
        price: fill.price,
        ts: fill.ts,
        strategy: fill.strategy,
      })
      lots.set(fill.symbol, queue)
      continue
    }

    const queue = lots.get(fill.symbol) ?? []
    let remaining = fill.qty
    while (remaining > 1e-9 && queue.length > 0) {
      const lot = queue[0]
      const take = Math.min(lot.qty, remaining)
      out.push({
        symbol: fill.symbol,
        strategy: fill.strategy ?? lot.strategy,
        qty: take,
        entryTs: lot.ts,
        exitTs: fill.ts,
        entryPrice: lot.price,
        exitPrice: fill.price,
        pnl: (fill.price - lot.price) * take,
        fees: (lot.price + fill.price) * take * FEE,
      })
      lot.qty -= take
      remaining -= take
      if (lot.qty <= 1e-9) queue.shift()
    }
    lots.set(fill.symbol, queue)
  }

  return out
}

export interface Stats {
  trades: number
  wins: number
  losses: number
  /** 0–100, or null before the first closed trade. */
  winRate: number | null
  /** Sum of winning round trips, positive. */
  grossProfit: number
  /** Sum of losing round trips, positive. */
  grossLoss: number
  /** Gross profit ÷ gross loss; null until there is a loss to divide by. */
  profitFactor: number | null
  /** Average result per trade, after fees. */
  expectancy: number
  avgWin: number
  avgLoss: number
  best: number
  worst: number
  /** Closed trades in a row at the best and worst runs. */
  maxWinStreak: number
  maxLossStreak: number
  fees: number
  /** Mean holding time, in milliseconds. */
  avgHoldMs: number
}

export function tradeStats(trips: RoundTrip[]): Stats {
  const net = trips.map((t) => t.pnl - t.fees)
  const wins = net.filter((v) => v > 0)
  const losses = net.filter((v) => v < 0)
  const grossProfit = wins.reduce((sum, v) => sum + v, 0)
  const grossLoss = Math.abs(losses.reduce((sum, v) => sum + v, 0))
  const fees = trips.reduce((sum, t) => sum + t.fees, 0)

  let maxWinStreak = 0
  let maxLossStreak = 0
  let run = 0
  for (const value of net) {
    if (value > 0) run = run > 0 ? run + 1 : 1
    else if (value < 0) run = run < 0 ? run - 1 : -1
    else run = 0
    maxWinStreak = Math.max(maxWinStreak, run)
    maxLossStreak = Math.max(maxLossStreak, -run)
  }

  return {
    trades: trips.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trips.length > 0 ? (wins.length / trips.length) * 100 : null,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    expectancy: net.length > 0 ? net.reduce((sum, v) => sum + v, 0) / net.length : 0,
    avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
    best: net.length > 0 ? Math.max(...net) : 0,
    worst: net.length > 0 ? Math.min(...net) : 0,
    maxWinStreak,
    maxLossStreak,
    fees,
    avgHoldMs:
      trips.length > 0
        ? trips.reduce((sum, t) => sum + Math.max(0, t.exitTs - t.entryTs), 0) / trips.length
        : 0,
  }
}

export interface GroupedStats {
  key: string
  stats: Stats
}

function group(trips: RoundTrip[], keyOf: (t: RoundTrip) => string): GroupedStats[] {
  const buckets = new Map<string, RoundTrip[]>()
  for (const trip of trips) {
    const key = keyOf(trip)
    const bucket = buckets.get(key) ?? []
    bucket.push(trip)
    buckets.set(key, bucket)
  }
  return [...buckets.entries()]
    .map(([key, bucket]) => ({ key, stats: tradeStats(bucket) }))
    .sort((a, b) => b.stats.trades - a.stats.trades)
}

/** Round trips by instrument, busiest first. */
export function bySymbol(trips: RoundTrip[]): GroupedStats[] {
  return group(trips, (t) => t.symbol)
}

/** Round trips by model, with unattributed trades kept under one label. */
export function byStrategy(trips: RoundTrip[]): GroupedStats[] {
  return group(trips, (t) => t.strategy ?? 'manual')
}

/**
 * A sample Sharpe ratio over the session's equity curve: mean return over its
 * standard deviation, scaled by the square root of the sample count. It is not
 * annualised — a session is not a year — so it is only comparable between
 * sessions of the same rough length.
 */
export function sharpe(points: EquityPoint[]): number | null {
  if (points.length < 4) return null
  const returns: number[] = []
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1].v
    if (previous > 0) returns.push(points[i].v / previous - 1)
  }
  if (returns.length < 3) return null
  const mean = returns.reduce((sum, v) => sum + v, 0) / returns.length
  const variance =
    returns.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(1, returns.length - 1)
  const sd = Math.sqrt(variance)
  if (!(sd > 0)) return null
  return (mean / sd) * Math.sqrt(returns.length)
}
