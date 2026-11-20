import type { AssetClass, Instrument } from './market'
import { applyOrder, type Fill, type Portfolio } from './trade'

export type StrategyId =
  | 'momentum'
  | 'meanrev'
  | 'breakout'
  | 'rsi'
  | 'macd'
  | 'dip'
  | 'scalp'

/** One knob a strategy exposes. Values are stored as numbers in the bot config. */
export interface ParamDef {
  key: string
  label: string
  min: number
  max: number
  step: number
  value: number
  unit?: string
}

export type StrategyParams = Partial<Record<StrategyId, Record<string, number>>>

export interface BotConfig {
  running: boolean
  strategy: StrategyId
  riskPct: number
  stopLossPct: number
  takeProfitPct: number
  maxAllocPct: number
  classes: AssetClass[]
  /** Per-strategy tuning. Anything missing falls back to the defaults below. */
  params: StrategyParams
  /** Send the bot's orders to the routed venue instead of filling them locally. */
  routeToBroker: boolean
}

export const DEFAULT_BOT: BotConfig = {
  running: false,
  strategy: 'momentum',
  riskPct: 4,
  stopLossPct: 2.5,
  takeProfitPct: 6,
  maxAllocPct: 60,
  classes: ['Stocks', 'Metals', 'Crypto', 'Fx', 'Energy'],
  params: {},
  routeToBroker: false,
}

export const PARAM_DEFS: Record<StrategyId, ParamDef[]> = {
  momentum: [
    { key: 'fast', label: 'Fast average', min: 4, max: 40, step: 1, value: 12, unit: ' ticks' },
    { key: 'slow', label: 'Slow average', min: 20, max: 120, step: 2, value: 48, unit: ' ticks' },
    { key: 'edge', label: 'Trigger spread', min: 0.05, max: 0.6, step: 0.05, value: 0.15, unit: '%' },
  ],
  meanrev: [
    { key: 'window', label: 'Mean window', min: 10, max: 90, step: 2, value: 30, unit: ' ticks' },
    { key: 'z', label: 'Entry z-score', min: 0.5, max: 3, step: 0.1, value: 1.1, unit: 'σ' },
  ],
  breakout: [
    { key: 'window', label: 'Range window', min: 12, max: 120, step: 4, value: 40, unit: ' ticks' },
  ],
  rsi: [
    { key: 'period', label: 'RSI period', min: 5, max: 30, step: 1, value: 14, unit: ' ticks' },
    { key: 'low', label: 'Oversold below', min: 10, max: 45, step: 1, value: 30 },
    { key: 'high', label: 'Overbought above', min: 55, max: 90, step: 1, value: 70 },
  ],
  macd: [
    { key: 'fast', label: 'Fast EMA', min: 3, max: 20, step: 1, value: 12 },
    { key: 'slow', label: 'Slow EMA', min: 10, max: 50, step: 1, value: 26 },
    { key: 'signal', label: 'Signal EMA', min: 3, max: 20, step: 1, value: 9 },
  ],
  dip: [
    { key: 'look', label: 'High lookback', min: 20, max: 160, step: 4, value: 80, unit: ' ticks' },
    { key: 'drop', label: 'Dip depth', min: 0.4, max: 4, step: 0.1, value: 1.2, unit: '%' },
    { key: 'turn', label: 'Turn window', min: 2, max: 10, step: 1, value: 3, unit: ' ticks' },
    { key: 'exit', label: 'Exit near high', min: 0.1, max: 1.5, step: 0.1, value: 0.3, unit: '%' },
  ],
  scalp: [
    { key: 'burst', label: 'Burst window', min: 2, max: 8, step: 1, value: 3, unit: ' ticks' },
    { key: 'punch', label: 'Punch threshold', min: 0.04, max: 0.5, step: 0.01, value: 0.12, unit: '%' },
    { key: 'fade', label: 'Cut when faded', min: 0.2, max: 1, step: 0.05, value: 0.5, unit: '× punch' },
  ],
}

/** The knobs the chosen strategy exposes, for the panel and the backtest label. */
export function paramDefs(strategy: StrategyId): ParamDef[] {
  return PARAM_DEFS[strategy]
}

export function defaultParams(strategy: StrategyId): Record<string, number> {
  const out: Record<string, number> = {}
  for (const def of PARAM_DEFS[strategy]) out[def.key] = def.value
  return out
}

/** The live tuning for a strategy: saved overrides on top of the defaults. */
export function tunedParams(cfg: BotConfig): Record<string, number> {
  return { ...defaultParams(cfg.strategy), ...(cfg.params[cfg.strategy] ?? {}) }
}

export const STRATEGIES: { id: StrategyId; name: string; blurb: string }[] = [
  {
    id: 'momentum',
    name: 'Trend following',
    blurb: 'Buys when the short average lifts above the long average and sells when it falls back.',
  },
  {
    id: 'meanrev',
    name: 'Mean reversion',
    blurb: 'Buys sharp stretches below the mean and sells stretches above it.',
  },
  {
    id: 'breakout',
    name: 'Breakout',
    blurb: 'Buys a fresh high on the recent range and sells a fresh low.',
  },
  {
    id: 'rsi',
    name: 'RSI reversal',
    blurb: 'Buys when RSI falls under the oversold line and sells it climbing past overbought.',
  },
  {
    id: 'macd',
    name: 'MACD crossover',
    blurb: 'Buys when the MACD line crosses above its signal line and sells the cross back down.',
  },
  {
    id: 'dip',
    name: 'Dip buyer',
    blurb: 'Waits for a dip off the recent high and buys once price turns back up.',
  },
  {
    id: 'scalp',
    name: 'Scalping',
    blurb:
      'Buys a fast punch up over a few ticks and cuts the moment the punch fades, holding moments rather than trends.',
  },
]

const COOLDOWN_TICKS = 8
/** Scalping is meant to trade often, so it rests a symbol for far fewer scans. */
const SCALP_COOLDOWN_TICKS = 3

function cooldownFor(strategy: StrategyId): number {
  return strategy === 'scalp' ? SCALP_COOLDOWN_TICKS : COOLDOWN_TICKS
}

function sma(history: number[], n: number): number | null {
  if (history.length < n) return null
  let sum = 0
  for (let i = history.length - n; i < history.length; i++) sum += history[i]
  return sum / n
}

export interface Signal {
  dir: -1 | 0 | 1
  note: string
}

function rsi(history: number[], n: number): number | null {
  if (history.length < n + 1) return null
  let gains = 0
  let losses = 0
  for (let i = history.length - n; i < history.length; i++) {
    const diff = history[i] - history[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  if (losses === 0) return 100
  const rs = gains / losses
  return 100 - 100 / (1 + rs)
}

/** Exponential moving averages, each starting at the first full window. */
function emaSeries(values: number[], n: number): number[] {
  if (values.length < n) return []
  const k = 2 / (n + 1)
  let prev = 0
  for (let i = 0; i < n; i++) prev += values[i]
  prev /= n
  const out = [prev]
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}

function macd(
  history: number[],
  fast: number,
  slow: number,
  signal: number,
): { hist: number; prevHist: number } | null {
  const fastEma = emaSeries(history, fast)
  const slowEma = emaSeries(history, slow)
  if (slowEma.length < signal + 1) return null
  const offset = slow - fast
  const line: number[] = []
  for (let i = 0; i < slowEma.length; i++) line.push(fastEma[i + offset] - slowEma[i])
  const signalEma = emaSeries(line, signal)
  if (signalEma.length < 2) return null
  return {
    hist: line[line.length - 1] - signalEma[signalEma.length - 1],
    prevHist: line[line.length - 2] - signalEma[signalEma.length - 2],
  }
}

export function signalFor(
  strategy: StrategyId,
  history: number[],
  tuning?: Record<string, number>,
): Signal {
  const p = { ...defaultParams(strategy), ...(tuning ?? {}) }
  const last = history[history.length - 1]

  if (strategy === 'momentum') {
    const fastN = Math.max(2, Math.round(p.fast))
    const slowN = Math.max(3, Math.round(p.slow))
    if (fastN >= slowN) {
      return { dir: 0, note: 'Set the fast average shorter than the slow average' }
    }
    const fast = sma(history, fastN)
    const slow = sma(history, slowN)
    if (fast === null || slow === null) return { dir: 0, note: 'Warming up' }
    const spread = ((fast - slow) / slow) * 100
    if (spread > p.edge) {
      return {
        dir: 1,
        note: `Short average ${spread.toFixed(2)}% above the long average`,
      }
    }
    if (spread < -p.edge) {
      return {
        dir: -1,
        note: `Short average ${Math.abs(spread).toFixed(2)}% below the long average`,
      }
    }
    return { dir: 0, note: 'Averages flat' }
  }

  if (strategy === 'meanrev') {
    const n = Math.max(5, Math.round(p.window))
    const mean = sma(history, n)
    if (mean === null) return { dir: 0, note: 'Warming up' }
    let variance = 0
    for (let i = history.length - n; i < history.length; i++) {
      variance += (history[i] - mean) ** 2
    }
    const sd = Math.sqrt(variance / n) || 1e-9
    const z = (last - mean) / sd
    if (z < -p.z) return { dir: 1, note: `Stretched ${z.toFixed(2)}σ below the ${n}-tick mean` }
    if (z > p.z) return { dir: -1, note: `Stretched +${z.toFixed(2)}σ above the ${n}-tick mean` }
    return { dir: 0, note: `Price ${z >= 0 ? '+' : ''}${z.toFixed(2)}σ from the mean` }
  }

  if (strategy === 'rsi') {
    const period = Math.max(2, Math.round(p.period))
    const value = rsi(history, period)
    if (value === null) return { dir: 0, note: 'Warming up' }
    if (value < p.low) return { dir: 1, note: `RSI ${value.toFixed(1)} — oversold` }
    if (value > p.high) return { dir: -1, note: `RSI ${value.toFixed(1)} — overbought` }
    return { dir: 0, note: `RSI ${value.toFixed(1)} — inside the bands` }
  }

  if (strategy === 'macd') {
    const fastN = Math.max(2, Math.round(p.fast))
    const slowN = Math.max(3, Math.round(p.slow))
    const signalN = Math.max(2, Math.round(p.signal))
    if (fastN >= slowN) {
      return { dir: 0, note: 'Set the fast EMA shorter than the slow EMA' }
    }
    const m = macd(history, fastN, slowN, signalN)
    if (!m) return { dir: 0, note: 'Warming up' }
    if (m.hist > 0 && m.prevHist <= 0) {
      return { dir: 1, note: 'MACD crossed above its signal line' }
    }
    if (m.hist < 0 && m.prevHist >= 0) {
      return { dir: -1, note: 'MACD crossed below its signal line' }
    }
    return {
      dir: 0,
      note: `MACD histogram ${m.hist >= 0 ? '+' : ''}${m.hist.toFixed(4)}`,
    }
  }

  if (strategy === 'dip') {
    const look = Math.max(8, Math.round(p.look))
    const back = Math.max(1, Math.round(p.turn))
    if (history.length < look + back + 1) return { dir: 0, note: 'Warming up' }
    const high = Math.max(...history.slice(-look))
    const drop = ((high - last) / high) * 100
    const turning = last > history[history.length - 1 - back]
    if (drop >= p.drop && turning) {
      return { dir: 1, note: `${drop.toFixed(1)}% dip off the ${look}-tick high, turning up` }
    }
    if (drop <= p.exit) return { dir: -1, note: 'Back at the recent high' }
    return { dir: 0, note: `${drop.toFixed(1)}% below the ${look}-tick high` }
  }

  if (strategy === 'scalp') {
    const burst = Math.max(2, Math.round(p.burst))
    if (history.length < burst + 1) return { dir: 0, note: 'Warming up' }
    const move = (last / history[history.length - 1 - burst] - 1) * 100
    if (move >= p.punch) {
      return { dir: 1, note: `Scalp punch ${move.toFixed(2)}% in ${burst} ticks` }
    }
    if (move <= -p.punch * p.fade) {
      return { dir: -1, note: `Punch faded ${move.toFixed(2)}% — cutting the scalp` }
    }
    return { dir: 0, note: `Tape ${move >= 0 ? '+' : ''}${move.toFixed(2)}% in ${burst} ticks` }
  }

  const look = Math.max(8, Math.round(p.window))
  if (history.length < look + 1) return { dir: 0, note: 'Warming up' }
  const window = history.slice(-look - 1, -1)
  const high = Math.max(...window)
  const low = Math.min(...window)
  if (last > high) return { dir: 1, note: `New ${look}-tick high` }
  if (last < low) return { dir: -1, note: `New ${look}-tick low` }
  return { dir: 0, note: 'Inside the recent range' }
}

/** A trade the bot wants to make, handed to the caller to fill or route. */
export interface BotIntent {
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  price: number
  reason: string
}

export interface BotStepResult {
  portfolio: Portfolio
  fills: Fill[]
  intents: BotIntent[]
}

/**
 * One scan of the bot across every instrument in the enabled asset classes.
 * Exits (stops, targets, signal flips) are checked before entries, and a
 * per-symbol cooldown keeps it from churning.
 *
 * With `route` set the scan only proposes orders: nothing is booked here, so
 * the caller can send each one to the routed venue first and book it only once
 * the venue accepts. The cooldown is taken either way.
 */
export function runBotStep(
  instruments: Instrument[],
  start: Portfolio,
  cfg: BotConfig,
  cooldowns: Record<string, number>,
  tick: number,
  route = false,
): BotStepResult {
  let portfolio = start
  const fills: Fill[] = []
  const intents: BotIntent[] = []

  const holdingsValue = () =>
    Object.entries(portfolio.holdings).reduce((sum, [symbol, held]) => {
      const ins = instruments.find((i) => i.symbol === symbol)
      return sum + held.qty * (ins?.price ?? 0)
    }, 0)

  const tuning = tunedParams(cfg)
  const rest = cooldownFor(cfg.strategy)

  for (const ins of instruments) {
    if (!cfg.classes.includes(ins.cls)) continue
    if (tick - (cooldowns[ins.symbol] ?? -999) < rest) continue

    const signal = signalFor(cfg.strategy, ins.history, tuning)
    const held = portfolio.holdings[ins.symbol]
    let side: 'buy' | 'sell' | null = null
    let qty = 0
    let reason = ''

    if (held && held.qty > 1e-8) {
      const gain = (ins.price / held.avgCost - 1) * 100
      if (gain <= -cfg.stopLossPct) {
        side = 'sell'
        qty = held.qty
        reason = `Stop loss at ${gain.toFixed(2)}%`
      } else if (gain >= cfg.takeProfitPct) {
        side = 'sell'
        qty = held.qty
        reason = `Take profit at +${gain.toFixed(2)}%`
      } else if (signal.dir < 0) {
        side = 'sell'
        qty = held.qty
        reason = signal.note
      }
    } else if (signal.dir > 0) {
      const equity = portfolio.cash + holdingsValue()
      const room = equity * (cfg.maxAllocPct / 100) - holdingsValue()
      const budget = Math.min(equity * (cfg.riskPct / 100), room, portfolio.cash)
      if (budget > Math.max(20, equity * 0.005)) {
        side = 'buy'
        qty = budget / ins.price
        reason = signal.note
      }
    }

    if (!side || qty <= 0) continue

    cooldowns[ins.symbol] = tick

    if (route) {
      intents.push({ symbol: ins.symbol, side, qty, price: ins.price, reason })
      continue
    }

    const result = applyOrder(portfolio, ins.symbol, ins.price, side, qty)
    if (!result.ok) continue

    portfolio = result.portfolio
    fills.push({
      id: `${tick}-${ins.symbol}-${side}-${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
      symbol: ins.symbol,
      side,
      qty,
      price: ins.price,
      source: 'bot',
      reason,
      pnl: result.pnl,
    })
  }

  return { portfolio, fills, intents }
}
