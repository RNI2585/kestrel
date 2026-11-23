import { pipLabel, pipSize, type AssetClass, type Instrument } from './market'
import { applyOrder, type Fill, type IndicatorReading, type Portfolio } from './trade'
import type { ExitBook } from './exits'

export type StrategyId =
  | 'momentum'
  | 'meanrev'
  | 'breakout'
  | 'rsi'
  | 'macd'
  | 'dip'
  | 'scalp'
  | 'pips'

/** The money settings that travel with a strategy. */
export interface RiskSettings {
  riskPct: number
  stopLossPct: number
  takeProfitPct: number
}

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
  maxAllocPct: number
  /** Risk, stop and target per strategy, so switching strategies swaps the exits too. */
  riskPrefs: Partial<Record<StrategyId, RiskSettings>>
  classes: AssetClass[]
  /** Per-strategy tuning. Anything missing falls back to the defaults below. */
  params: StrategyParams
  /** Send the bot's orders to the routed venue instead of filling them locally. */
  routeToBroker: boolean
}

export const DEFAULT_BOT: BotConfig = {
  running: false,
  strategy: 'momentum',
  riskPrefs: {},
  maxAllocPct: 60,
  classes: ['Stocks', 'Metals', 'Crypto', 'Fx', 'Energy'],
  params: {},
  routeToBroker: false,
}

/**
 * Starting exits for each strategy. A trend trade needs room to run, while a
 * scalp is cut quickly, so the numbers travel with the strategy rather than
 * with the terminal.
 */
export const DEFAULT_RISK: Record<StrategyId, RiskSettings> = {
  momentum: { riskPct: 4, stopLossPct: 2.5, takeProfitPct: 6 },
  meanrev: { riskPct: 3, stopLossPct: 2, takeProfitPct: 4 },
  breakout: { riskPct: 4, stopLossPct: 2.5, takeProfitPct: 8 },
  rsi: { riskPct: 3, stopLossPct: 2, takeProfitPct: 5 },
  macd: { riskPct: 4, stopLossPct: 2.5, takeProfitPct: 6 },
  dip: { riskPct: 3, stopLossPct: 3, takeProfitPct: 5 },
  scalp: { riskPct: 2, stopLossPct: 1, takeProfitPct: 2 },
  pips: { riskPct: 3, stopLossPct: 1.2, takeProfitPct: 3 },
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
  pips: [
    { key: 'window', label: 'Range window', min: 20, max: 160, step: 4, value: 60, unit: ' ticks' },
    { key: 'trigger', label: 'Breakout by', min: 2, max: 30, step: 1, value: 8, unit: ' pips' },
    { key: 'fade', label: 'Cut when faded', min: 2, max: 20, step: 1, value: 6, unit: ' pips' },
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

/** The risk, stop and target the chosen strategy trades with. */
export function activeRisk(cfg: BotConfig): RiskSettings {
  return { ...DEFAULT_RISK[cfg.strategy], ...(cfg.riskPrefs[cfg.strategy] ?? {}) }
}

/** Stores new exit settings against the chosen strategy. */
export function patchRisk(cfg: BotConfig, patch: Partial<RiskSettings>): BotConfig {
  return {
    ...cfg,
    riskPrefs: { ...cfg.riskPrefs, [cfg.strategy]: { ...activeRisk(cfg), ...patch } },
  }
}

/** Exits for a replay that should not use the strategy's saved settings. */
export function withRisk(cfg: BotConfig, settings: RiskSettings): BotConfig {
  return { ...cfg, riskPrefs: { ...cfg.riskPrefs, [cfg.strategy]: { ...settings } } }
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
  {
    id: 'pips',
    name: 'Pip breakout',
    blurb:
      'FX and crypto only: buys a fresh high by a set number of pips and leaves once price fades the same way off that high.',
  },
]

/**
 * Strategies that only make sense on some markets. The pip model works on
 * currency and crypto quotes, where a pip is a known unit, and the bot skips
 * every other class while it is armed.
 */
export const STRATEGY_CLASSES: Partial<Record<StrategyId, AssetClass[]>> = {
  pips: ['Fx', 'Crypto'],
}

/** Whether a strategy trades this asset class at all. */
export function tradesClass(strategy: StrategyId, cls: AssetClass): boolean {
  const allowed = STRATEGY_CLASSES[strategy]
  return !allowed || allowed.includes(cls)
}

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
  /** The instrument's pip, so pip-denominated rules read the right unit. */
  pip?: number,
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

  if (strategy === 'pips') {
    const look = Math.max(8, Math.round(p.window))
    const step = pip ?? pipSize(last)
    if (history.length < look + 1) return { dir: 0, note: 'Warming up' }
    const window = history.slice(-look - 1, -1)
    const high = Math.max(...window)
    const low = Math.min(...window)
    const above = (last - high) / step
    const below = (low - last) / step
    if (above >= p.trigger) {
      return { dir: 1, note: `Pushed ${above.toFixed(1)} pips over the ${look}-tick high` }
    }
    if (below >= p.trigger) {
      return { dir: -1, note: `Broke ${below.toFixed(1)} pips under the ${look}-tick low` }
    }
    const faded = (high - last) / step
    if (faded >= p.fade) {
      return { dir: -1, note: `Faded ${faded.toFixed(1)} pips off the ${look}-tick high` }
    }
    return { dir: 0, note: `${((last - low) / step).toFixed(1)} pips inside the ${look}-tick range` }
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

function reading(label: string, value: number): IndicatorReading {
  const dp = Math.abs(value) >= 100 ? 2 : 4
  return {
    label,
    value: value.toLocaleString('en-US', {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    }),
  }
}

function percentReading(label: string, value: number): IndicatorReading {
  return { label, value: `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` }
}

/**
 * The values the strategy's indicators read right now. Captured with each
 * trade so the log can show the setup a trade was taken on, not whatever the
 * tape reads after the bot has moved on.
 */
export function indicatorReadings(
  strategy: StrategyId,
  history: number[],
  tuning?: Record<string, number>,
  /** The instrument's pip, so the chips are quoted the way the market is. */
  pip?: number,
): IndicatorReading[] {
  const p = { ...defaultParams(strategy), ...(tuning ?? {}) }
  const last = history[history.length - 1]
  if (!Number.isFinite(last)) return []

  if (strategy === 'momentum') {
    const fastN = Math.max(2, Math.round(p.fast))
    const slowN = Math.max(3, Math.round(p.slow))
    const fast = sma(history, fastN)
    const slow = slowN > fastN ? sma(history, slowN) : null
    if (fast === null || slow === null) return []
    return [
      reading(`SMA(${fastN})`, fast),
      reading(`SMA(${slowN})`, slow),
      percentReading('Spread', ((fast - slow) / slow) * 100),
    ]
  }

  if (strategy === 'meanrev') {
    const n = Math.max(5, Math.round(p.window))
    const mean = sma(history, n)
    if (mean === null) return []
    let variance = 0
    for (let i = history.length - n; i < history.length; i++) variance += (history[i] - mean) ** 2
    const sd = Math.sqrt(variance / n) || 1e-9
    return [
      reading(`Mean(${n})`, mean),
      { label: 'Z-score', value: `${((last - mean) / sd).toFixed(2)}σ` },
    ]
  }

  if (strategy === 'rsi') {
    const period = Math.max(2, Math.round(p.period))
    const value = rsi(history, period)
    if (value === null) return []
    return [
      { label: `RSI(${period})`, value: value.toFixed(1) },
      { label: 'Bands', value: `${p.low} / ${p.high}` },
    ]
  }

  if (strategy === 'macd') {
    const fastN = Math.max(2, Math.round(p.fast))
    const slowN = Math.max(3, Math.round(p.slow))
    const signalN = Math.max(2, Math.round(p.signal))
    if (fastN >= slowN) return []
    const fastEma = emaSeries(history, fastN)
    const slowEma = emaSeries(history, slowN)
    if (slowEma.length < signalN + 1) return []
    const offset = slowN - fastN
    const line = slowEma.map((value, i) => fastEma[i + offset] - value)
    const signalEma = emaSeries(line, signalN)
    if (signalEma.length === 0) return []
    const macdNow = line[line.length - 1]
    const signalNow = signalEma[signalEma.length - 1]
    const hist = macdNow - signalNow
    return [
      reading(`MACD(${fastN},${slowN})`, macdNow),
      reading(`Signal(${signalN})`, signalNow),
      { label: 'Histogram', value: `${hist >= 0 ? '+' : ''}${hist.toFixed(4)}` },
    ]
  }

  if (strategy === 'dip') {
    const look = Math.max(8, Math.round(p.look))
    if (history.length < look) return []
    const high = Math.max(...history.slice(-look))
    return [
      reading(`High(${look})`, high),
      percentReading('Dip', ((high - last) / high) * 100),
    ]
  }

  if (strategy === 'scalp') {
    const burst = Math.max(2, Math.round(p.burst))
    if (history.length < burst + 1) return []
    return [
      percentReading(
        `Move(${burst} ticks)`,
        (last / history[history.length - 1 - burst] - 1) * 100,
      ),
      percentReading('Punch', p.punch),
    ]
  }

  if (strategy === 'pips') {
    const look = Math.max(8, Math.round(p.window))
    const step = pip ?? pipSize(last)
    if (history.length < look) return []
    const window = history.slice(-look)
    const high = Math.max(...window)
    const low = Math.min(...window)
    const start = Math.max(1, window.length - 20)
    let moved = 0
    for (let i = start; i < window.length; i++) moved += Math.abs(window[i] - window[i - 1])
    const average = moved / Math.max(1, window.length - start) / step
    return [
      { label: 'Pip', value: pipLabel(step) },
      { label: `Range(${look})`, value: `${((high - low) / step).toFixed(0)} pips` },
      { label: 'Avg tick', value: `${average.toFixed(1)} pips` },
    ]
  }

  const look = Math.max(8, Math.round(p.window))
  if (history.length < look + 1) return []
  const window = history.slice(-look - 1, -1)
  const high = Math.max(...window)
  const low = Math.min(...window)
  return [
    reading(`High(${look})`, high),
    reading(`Low(${look})`, low),
    percentReading('Range', ((high - low) / low) * 100),
  ]
}

/** A trade the bot wants to make, handed to the caller to fill or route. */
export interface BotIntent {
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  price: number
  reason: string
  /** Strategy and indicator snapshot that produced the signal. */
  strategy?: StrategyId
  indicators?: IndicatorReading[]
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
  exits?: ExitBook,
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
  const risk = activeRisk(cfg)
  const rest = cooldownFor(cfg.strategy)

  for (const ins of instruments) {
    if (!cfg.classes.includes(ins.cls)) continue
    if (!tradesClass(cfg.strategy, ins.cls)) continue
    if (tick - (cooldowns[ins.symbol] ?? -999) < rest) continue

    const pip = pipSize(ins.price, ins.cls)
    const signal = signalFor(cfg.strategy, ins.history, tuning, pip)
    const held = portfolio.holdings[ins.symbol]
    let side: 'buy' | 'sell' | null = null
    let qty = 0
    let reason = ''

    if (held && held.qty > 1e-8) {
      const gain = (ins.price / held.avgCost - 1) * 100
      // A position taken with its own stop and target is exited by those
      // levels, not by the risk settings of whatever strategy is armed now.
      const guarded = Boolean(exits?.[ins.symbol])
      if (!guarded && gain <= -risk.stopLossPct) {
        side = 'sell'
        qty = held.qty
        reason = `Stop loss at ${gain.toFixed(2)}%`
      } else if (!guarded && gain >= risk.takeProfitPct) {
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
      const budget = Math.min(equity * (risk.riskPct / 100), room, portfolio.cash)
      if (budget > Math.max(20, equity * 0.005)) {
        side = 'buy'
        qty = budget / ins.price
        reason = signal.note
      }
    }

    if (!side || qty <= 0) continue

    cooldowns[ins.symbol] = tick

    const readings = indicatorReadings(cfg.strategy, ins.history, tuning, pip)

    if (route) {
      intents.push({
        symbol: ins.symbol,
        side,
        qty,
        price: ins.price,
        reason,
        strategy: cfg.strategy,
        indicators: readings,
      })
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
      strategy: cfg.strategy,
      indicators: readings,
    })
  }

  return { portfolio, fills, intents }
}
