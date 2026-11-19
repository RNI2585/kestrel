import { signalFor, tunedParams, type BotConfig } from './bot'
import { applyOrder, START_CASH, startingPortfolio } from './trade'

export interface BacktestAverages {
  runs: number
  returnPct: number
  buyHoldPct: number
  trades: number
  winRate: number | null
  maxDrawdownPct: number
  perRoundTrip: number | null
  bestReturnPct: number
  worstReturnPct: number
  profitableRuns: number
}

export interface SweepRow {
  stopPct: number
  takeProfitPct: number
  riskPct: number
  runs: number
  returnPct: number
  perRoundTrip: number | null
  winRate: number | null
  trades: number
  maxDrawdownPct: number
  profitableRuns: number
}

export interface BacktestResult {
  symbol: string
  seed: number
  ticks: number
  trades: number
  wins: number
  winRate: number | null
  startEquity: number
  endEquity: number
  returnPct: number
  buyHoldPct: number
  maxDrawdownPct: number
  curve: number[]
}

/** Small deterministic PRNG so a given seed always replays the same tape. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A synthetic price path with the instrument's own volatility and a soft pull to its base. */
export function syntheticSeries(vol: number, start: number, ticks: number, seed: number): number[] {
  const rnd = mulberry32(seed)
  const out: number[] = [start]
  let p = start
  for (let i = 1; i < ticks; i++) {
    const u = Math.max(rnd(), 1e-9)
    const v = Math.max(rnd(), 1e-9)
    const shock = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * vol
    const pull = ((start - p) / start) * 0.0015
    p = Math.max(p * (1 + shock + pull), start * 0.2)
    out.push(p)
  }
  return out
}

const WARMUP = 60
const TICKS = 600

function downsample(points: number[], target = 140): number[] {
  if (points.length <= target) return points
  const step = (points.length - 1) / (target - 1)
  const out: number[] = []
  for (let i = 0; i < target; i++) out.push(points[Math.round(i * step)])
  return out
}

/**
 * Replays the bot's rules over a synthetic tape for one instrument: same
 * signals, same stop/target exits, same commission, same risk sizing.
 */
export function runBacktest(opts: {
  symbol: string
  vol: number
  startPrice: number
  cfg: BotConfig
  seed: number
  ticks?: number
}): BacktestResult {
  const ticks = opts.ticks ?? TICKS
  const series = syntheticSeries(opts.vol, opts.startPrice, ticks, opts.seed)
  let portfolio = startingPortfolio()
  let trades = 0
  let wins = 0
  let peak = START_CASH
  let maxDrawdown = 0
  const curve: number[] = [START_CASH]
  const tuning = tunedParams(opts.cfg)

  const equityAt = (price: number) => {
    const held = portfolio.holdings[opts.symbol]
    return portfolio.cash + (held ? held.qty * price : 0)
  }

  // Push rather than slice: copying the window every tick was the bulk of the cost.
  const history: number[] = []
  for (let t = 0; t < series.length; t++) {
    history.push(series[t])
    if (t < WARMUP) continue
    const price = series[t]
    const held = portfolio.holdings[opts.symbol]
    const signal = signalFor(opts.cfg.strategy, history, tuning)
    let side: 'buy' | 'sell' | null = null
    let qty = 0

    if (held && held.qty > 1e-8) {
      const gain = (price / held.avgCost - 1) * 100
      if (gain <= -opts.cfg.stopLossPct || gain >= opts.cfg.takeProfitPct || signal.dir < 0) {
        side = 'sell'
        qty = held.qty
      }
    } else if (signal.dir > 0) {
      const equity = equityAt(price)
      const budget = Math.min(equity * (opts.cfg.riskPct / 100), portfolio.cash)
      if (budget > equity * 0.005) {
        side = 'buy'
        qty = budget / price
      }
    }

    if (side) {
      const result = applyOrder(portfolio, opts.symbol, price, side, qty)
      if (result.ok) {
        portfolio = result.portfolio
        trades += 1
        if (side === 'sell' && (result.pnl ?? 0) > 0) wins += 1
      }
    }

    const equity = equityAt(price)
    peak = Math.max(peak, equity)
    maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100)
    curve.push(equity)
  }

  const last = series[series.length - 1]
  const endEquity = equityAt(last)
  const sells = trades > 0 ? Math.ceil(trades / 2) : 0

  return {
    symbol: opts.symbol,
    seed: opts.seed,
    ticks,
    trades,
    wins,
    winRate: sells > 0 ? (wins / sells) * 100 : null,
    startEquity: START_CASH,
    endEquity,
    returnPct: ((endEquity - START_CASH) / START_CASH) * 100,
    buyHoldPct: ((last - series[WARMUP]) / series[WARMUP]) * 100,
    maxDrawdownPct: maxDrawdown,
    curve: downsample(curve),
  }
}

/**
 * Averages several replays so a plan is judged on its typical outcome rather
 * than one lucky or unlucky synthetic path. `perRoundTrip` is the average
 * return divided by the average number of round trips.
 */
export function averageBacktests(runs: BacktestResult[]): BacktestAverages {
  const n = runs.length
  if (n === 0) {
    return {
      runs: 0,
      returnPct: 0,
      buyHoldPct: 0,
      trades: 0,
      winRate: null,
      maxDrawdownPct: 0,
      perRoundTrip: null,
      bestReturnPct: 0,
      worstReturnPct: 0,
      profitableRuns: 0,
    }
  }

  const sum = (pick: (r: BacktestResult) => number) => runs.reduce((acc, r) => acc + pick(r), 0)
  const returns = runs.map((r) => r.returnPct)
  const roundTrips = runs.map((r) => Math.ceil(r.trades / 2))
  const totalRoundTrips = roundTrips.reduce((a, b) => a + b, 0)
  const winRates = runs.map((r) => r.winRate).filter((v): v is number => v !== null)
  const avgReturn = sum((r) => r.returnPct) / n

  return {
    runs: n,
    returnPct: avgReturn,
    buyHoldPct: sum((r) => r.buyHoldPct) / n,
    trades: sum((r) => r.trades) / n,
    winRate: winRates.length > 0 ? winRates.reduce((a, b) => a + b, 0) / winRates.length : null,
    maxDrawdownPct: sum((r) => r.maxDrawdownPct) / n,
    perRoundTrip: totalRoundTrips > 0 ? avgReturn / (totalRoundTrips / n) : null,
    bestReturnPct: Math.max(...returns),
    worstReturnPct: Math.min(...returns),
    profitableRuns: returns.filter((v) => v > 0).length,
  }
}

/** One cell of the sweep: fixed stop, target and risk, averaged over several tapes. */
export function sweepCombo(opts: {
  symbol: string
  vol: number
  startPrice: number
  baseCfg: BotConfig
  seeds: number[]
  stopPct: number
  takeProfitPct: number
  riskPct: number
}): SweepRow {
  const cfg: BotConfig = {
    ...opts.baseCfg,
    riskPct: opts.riskPct,
    stopLossPct: opts.stopPct,
    takeProfitPct: opts.takeProfitPct,
  }
  const runs = opts.seeds.map((seed) =>
    runBacktest({
      symbol: opts.symbol,
      vol: opts.vol,
      startPrice: opts.startPrice,
      cfg,
      seed,
    }),
  )
  const avg = averageBacktests(runs)
  return {
    stopPct: opts.stopPct,
    takeProfitPct: opts.takeProfitPct,
    riskPct: opts.riskPct,
    runs: avg.runs,
    returnPct: avg.returnPct,
    perRoundTrip: avg.perRoundTrip,
    winRate: avg.winRate,
    trades: avg.trades,
    maxDrawdownPct: avg.maxDrawdownPct,
    profitableRuns: avg.profitableRuns,
  }
}
