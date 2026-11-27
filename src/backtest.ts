import {
  defaultParams,
  marketCondition,
  matchStrategyToMarket,
  riskFor,
  signalFor,
  sizeForStopRisk,
  tunedParams,
  withRisk,
  type BotConfig,
} from './bot'
import { pipSize, type AssetClass, type Instrument } from './market'
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
  /** Mean bar return divided by its standard deviation, per tick. */
  sharpe: number | null
  /** Gross winning trades divided by gross losing trades. */
  profitFactor: number | null
  /** Average win/loss in multiples of what the stop risked. */
  avgR: number | null
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
 * Replays the bot's rules over a synthetic tape, including modelled costs.
 */
export function runBacktest(opts: {
  symbol: string
  assetClass?: AssetClass
  vol: number
  startPrice: number
  cfg: BotConfig
  seed: number
  ticks?: number
  /** Estimated full spread width and one-way slippage, in basis points. */
  spreadBps?: number
  slippageBps?: number
}): BacktestResult {
  const ticks = opts.ticks ?? TICKS
  const series = syntheticSeries(opts.vol, opts.startPrice, ticks, opts.seed)
  let portfolio = startingPortfolio()
  let trades = 0
  let wins = 0
  let peak = START_CASH
  let maxDrawdown = 0
  const curve: number[] = [START_CASH]
  const equityBars: number[] = [START_CASH]
  let grossWin = 0
  let grossLoss = 0
  const rMultiples: number[] = []
  const tuning = tunedParams(opts.cfg)
  let openStopPct = 0
  let openTargetPct = 0
  const assetClass = opts.assetClass ?? 'Crypto'

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
    const simulatedInstrument: Instrument = {
      symbol: opts.symbol,
      name: opts.symbol,
      cls: assetClass,
      dp: 2,
      price,
      prevClose: history[0],
      history,
      vol: opts.vol,
      base: opts.startPrice,
      historyVerified: false,
    }
    const match =
      opts.cfg.strategyMode === 'market-fit'
        ? matchStrategyToMarket(simulatedInstrument, opts.cfg)
        : null
    const strategy = match?.strategy ?? opts.cfg.strategy
    const risk = riskFor(opts.cfg, strategy)
    const activeTuning =
      opts.cfg.strategyMode === 'market-fit'
        ? { ...defaultParams(strategy), ...(opts.cfg.params[strategy] ?? {}) }
        : tuning
    const signal = signalFor(strategy, history, activeTuning, pipSize(price, assetClass))
    let side: 'buy' | 'sell' | null = null
    let qty = 0

    if (held && held.qty > 1e-8) {
      const gain = (price / held.avgCost - 1) * 100
      if (gain <= -openStopPct || gain >= openTargetPct || signal.dir < 0) {
        side = 'sell'
        qty = held.qty
        // R multiple: how far the trade travelled in units of the stop risked.
        rMultiples.push(gain / (openStopPct || 1))
      }
    } else if (
      signal.dir > 0 &&
      (opts.cfg.strategyMode !== 'market-fit' || (match?.strategy && match.dir === 1))
    ) {
      const equity = equityAt(price)
      const budget = sizeForStopRisk(
        equity,
        risk.riskPct,
        risk.stopLossPct,
        equity * (opts.cfg.maxAllocPct / 100),
        portfolio.cash,
        marketCondition(history).volatilityPct,
      )
      if (budget > equity * 0.005) {
        side = 'buy'
        qty = budget / price
        openStopPct = risk.stopLossPct
        openTargetPct = risk.takeProfitPct
      }
    }

    if (side) {
      const spread = (opts.spreadBps ?? 5) / 20_000
      const slippage = (opts.slippageBps ?? 5) / 10_000
      const executionPrice = price * (1 + (side === 'buy' ? 1 : -1) * (spread + slippage))
      const result = applyOrder(portfolio, opts.symbol, executionPrice, side, qty)
      if (result.ok) {
        portfolio = result.portfolio
        trades += 1
        if (side === 'sell') {
          openStopPct = 0
          openTargetPct = 0
          const pnl = result.pnl ?? 0
          if (pnl > 0) {
            wins += 1
            grossWin += pnl
          } else {
            grossLoss += Math.abs(pnl)
          }
        }
      }
    }

    const equity = equityAt(price)
    peak = Math.max(peak, equity)
    maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100)
    curve.push(equity)
    equityBars.push(equity)
  }

  const last = series[series.length - 1]
  const endEquity = equityAt(last)
  const sells = trades > 0 ? Math.ceil(trades / 2) : 0

  const barReturns: number[] = []
  for (let i = 1; i < equityBars.length; i++) {
    if (equityBars[i - 1] > 0) barReturns.push(equityBars[i] / equityBars[i - 1] - 1)
  }
  let sharpe: number | null = null
  if (barReturns.length > 1) {
    const mean = barReturns.reduce((a, b) => a + b, 0) / barReturns.length
    const variance =
      barReturns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (barReturns.length - 1)
    const sd = Math.sqrt(variance)
    if (sd > 0) sharpe = mean / sd
  }
  const avgR =
    rMultiples.length > 0
      ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length
      : null

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
    sharpe,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgR,
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
  assetClass?: AssetClass
  vol: number
  startPrice: number
  baseCfg: BotConfig
  seeds: number[]
  stopPct: number
  takeProfitPct: number
  riskPct: number
  ticks?: number
  spreadBps?: number
  slippageBps?: number
}): SweepRow {
  const cfg: BotConfig = withRisk({ ...opts.baseCfg }, {
    riskPct: opts.riskPct,
    stopLossPct: opts.stopPct,
    takeProfitPct: opts.takeProfitPct,
  })
  const runs = opts.seeds.map((seed) =>
    runBacktest({
      symbol: opts.symbol,
      assetClass: opts.assetClass,
      vol: opts.vol,
      startPrice: opts.startPrice,
      cfg,
      seed,
      ticks: opts.ticks,
      spreadBps: opts.spreadBps,
      slippageBps: opts.slippageBps,
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

/** The exits a walk-forward fit landed on, and what they did out of sample. */
export interface WalkForwardResult {
  symbol: string
  fitted: { stopPct: number; takeProfitPct: number; riskPct: number }
  /** The winning combination averaged over the tapes it was fitted on. */
  inSample: BacktestAverages
  /** The same exits averaged over tapes the fit never saw. */
  outOfSample: BacktestAverages
  /** Out-of-sample return minus in-sample return, in percentage points. */
  decayPct: number
  /** True when the fitted exits still made money on unseen tapes. */
  survives: boolean
}

/**
 * Fits stop, target and risk on one set of synthetic tapes, then scores the
 * winner on a disjoint set. A combination that only works on the tapes it was
 * chosen on is curve-fit, and the decay between the two columns is the honest
 * measure of that.
 */
export function walkForward(opts: {
  symbol: string
  assetClass?: AssetClass
  vol: number
  startPrice: number
  baseCfg: BotConfig
  stopPcts: number[]
  takeProfitPcts: number[]
  riskPcts: number[]
  trainSeeds: number[]
  testSeeds: number[]
  ticks?: number
  spreadBps?: number
  slippageBps?: number
}): WalkForwardResult {
  let best: SweepRow | null = null
  for (const stopPct of opts.stopPcts) {
    for (const takeProfitPct of opts.takeProfitPcts) {
      for (const riskPct of opts.riskPcts) {
        const row = sweepCombo({
          symbol: opts.symbol,
          assetClass: opts.assetClass,
          vol: opts.vol,
          startPrice: opts.startPrice,
          baseCfg: opts.baseCfg,
          seeds: opts.trainSeeds,
          stopPct,
          takeProfitPct,
          riskPct,
          ticks: opts.ticks,
          spreadBps: opts.spreadBps,
          slippageBps: opts.slippageBps,
        })
        // The highest average return wins; ties go to the tighter stop, since
        // the fit should not be decided by luck between equal results.
        if (
          !best ||
          row.returnPct > best.returnPct + 1e-9 ||
          (Math.abs(row.returnPct - best.returnPct) <= 1e-9 && row.stopPct < best.stopPct)
        ) {
          best = row
        }
      }
    }
  }

  const fitted = best ?? { stopPct: 2.5, takeProfitPct: 6, riskPct: 3, returnPct: 0 }
  const inSample = averageBacktests(
    opts.trainSeeds.map((seed) =>
      runBacktest({
        symbol: opts.symbol,
        assetClass: opts.assetClass,
        vol: opts.vol,
        startPrice: opts.startPrice,
        cfg: withRisk({ ...opts.baseCfg }, {
          riskPct: fitted.riskPct,
          stopLossPct: fitted.stopPct,
          takeProfitPct: fitted.takeProfitPct,
        }),
        seed,
        ticks: opts.ticks,
        spreadBps: opts.spreadBps,
        slippageBps: opts.slippageBps,
      }),
    ),
  )
  const outOfSample = averageBacktests(
    opts.testSeeds.map((seed) =>
      runBacktest({
        symbol: opts.symbol,
        assetClass: opts.assetClass,
        vol: opts.vol,
        startPrice: opts.startPrice,
        cfg: withRisk({ ...opts.baseCfg }, {
          riskPct: fitted.riskPct,
          stopLossPct: fitted.stopPct,
          takeProfitPct: fitted.takeProfitPct,
        }),
        seed,
        ticks: opts.ticks,
        spreadBps: opts.spreadBps,
        slippageBps: opts.slippageBps,
      }),
    ),
  )

  return {
    symbol: opts.symbol,
    fitted: {
      stopPct: fitted.stopPct,
      takeProfitPct: fitted.takeProfitPct,
      riskPct: fitted.riskPct,
    },
    inSample,
    outOfSample,
    decayPct: outOfSample.returnPct - inSample.returnPct,
    survives: outOfSample.returnPct > 0,
  }
}
