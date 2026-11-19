import { STRATEGIES, type StrategyId } from './bot'
import type { Instrument } from './market'
import { stepCode, type ScriptStep } from './scripts'

export type PlanTone = 'entry' | 'stop' | 'target'

export interface PlanLevel {
  label: string
  price: number
  tone: PlanTone
}

export interface ChartRead {
  symbol: string
  name: string
  price: number
  dp: number
  bias: 'bullish' | 'bearish' | 'flat'
  trendPct: number
  rsi: number
  /** average bar move, used as an ATR stand-in, in percent */
  atrPct: number
  /** where price sits inside the recent range, 0 at the low, 100 at the high */
  rangePct: number
  momentumPct: number
  support: number
  resistance: number
  bars: number
  notes: string[]
}

export interface ChartPlan {
  read: ChartRead
  strategy: StrategyId
  strategyName: string
  headline: string
  summary: string
  entry: number | null
  stop: number | null
  target: number | null
  qty: number
  riskPct: number
  stopLossPct: number
  takeProfitPct: number
  steps: ScriptStep[]
  code: string
  levels: PlanLevel[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundTo(value: number, dp: number): number {
  return Number(value.toFixed(dp))
}

function ema(values: number[], period: number): number {
  if (values.length === 0) return 0
  const n = Math.min(period, values.length)
  const k = 2 / (n + 1)
  let seed = 0
  for (let i = 0; i < n; i++) seed += values[i]
  let prev = seed / n
  for (let i = n; i < values.length; i++) prev = values[i] * k + prev * (1 - k)
  return prev
}

function rsiOf(values: number[], period: number): number {
  if (values.length < period + 1) return 50
  let gains = 0
  let losses = 0
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  if (losses === 0) return 100
  const rs = gains / losses
  return 100 - 100 / (1 + rs)
}

/** Average absolute bar move in percent — the volatility the plan sizes against. */
function meanAbsMove(values: number[], period: number): number {
  const n = Math.min(period, values.length - 1)
  if (n <= 0) return 0
  let sum = 0
  for (let i = values.length - n; i < values.length; i++) {
    sum += Math.abs(values[i] - values[i - 1]) / values[i - 1]
  }
  return (sum / n) * 100
}

function roundQty(qty: number): number {
  if (qty >= 100) return Math.floor(qty)
  if (qty >= 1) return Math.floor(qty * 100) / 100
  return Math.floor(qty * 10000) / 10000
}

/**
 * Reads the visible chart of one instrument and writes a trade plan: bias,
 * the levels that matter, a risk-sized entry, a structural stop and a target.
 * The plan is turned into the same script steps the plain-English generator
 * produces, so both routes run through identical code.
 *
 * There is no shorting in this account, so a bearish read produces an
 * exit-only plan rather than a short entry.
 */
export function planFromChart(
  instrument: Instrument,
  options: { equity: number; cash: number; holdingQty?: number },
): ChartPlan {
  const history = instrument.history.slice(-160)
  const bars = history.length
  const price = instrument.price
  const fmt = (value: number) => value.toFixed(instrument.dp)

  const fastN = Math.round(clamp(bars / 12, 3, 12))
  const slowN = Math.round(clamp(bars / 3, 8, 48))
  const fast = ema(history, fastN)
  const slow = ema(history, slowN)
  const trendPct = slow > 0 ? ((fast - slow) / slow) * 100 : 0

  const rsiValue = rsiOf(history, 14)
  const atrPct = meanAbsMove(history, 20)
  const lookback = Math.min(60, bars)
  const swing = history.slice(-lookback)
  const support = Math.min(...swing)
  const resistance = Math.max(...swing)
  const span = resistance - support || price * 0.002 || 1
  const rangePct = clamp(((price - support) / span) * 100, 0, 100)
  const momentumPct = (() => {
    const back = history[Math.max(0, bars - 11)]
    return back > 0 ? (price / back - 1) * 100 : 0
  })()

  const bias: ChartRead['bias'] =
    trendPct > 0.08 && price > slow ? 'bullish' : trendPct < -0.08 && price < slow ? 'bearish' : 'flat'

  const volatility =
    atrPct >= 1.4 ? 'high' : atrPct >= 0.6 ? 'normal' : 'quiet'
  const rsiWord = rsiValue < 35 ? 'oversold' : rsiValue > 70 ? 'overbought' : 'neutral'

  const notes = [
    `Price sits ${rangePct.toFixed(0)}% up the last ${lookback}-bar range (${fmt(support)} – ${fmt(resistance)}).`,
    `RSI(14) reads ${rsiValue.toFixed(1)} — ${rsiWord}; short average ${trendPct >= 0 ? '+' : ''}${trendPct.toFixed(2)}% against the long average.`,
    `10-bar momentum ${momentumPct >= 0 ? '+' : ''}${momentumPct.toFixed(2)}% with ${volatility} ${atrPct.toFixed(2)}% bars.`,
  ]
  if (bias === 'bearish') {
    notes.push('This account cannot go short, so a downtrend means stand aside or take the exit.')
  }

  const wantsLong = bias !== 'bearish'

  let entry = 0
  let stop = 0
  let target = 0
  let riskPct = 2
  let stopLossPct = 2.5
  let takeProfitPct = 6

  if (wantsLong) {
    const barMove = price * (atrPct / 100)
    const pullback = price - barMove * 0.8
    const base = bias === 'bullish' ? pullback : Math.min(pullback, (support + price) / 2)
    entry = Math.min(Math.max(base, support * 1.002), price * 0.9995)
    const structural = Math.min(support * 0.997, entry - barMove * 1.3)
    const stopDistance = clamp(((entry - structural) / entry) * 100, 0.8, 5)
    stop = entry * (1 - stopDistance / 100)
    stopLossPct = roundTo(((entry - stop) / entry) * 100, 1)
    takeProfitPct = roundTo(clamp(stopLossPct * 2.2, 1.2, 25), 1)
    target = entry * (1 + takeProfitPct / 100)
    riskPct = atrPct >= 1.2 ? 1 : atrPct >= 0.6 ? 1.5 : 2

    entry = roundTo(entry, instrument.dp)
    stop = roundTo(stop, instrument.dp)
    target = roundTo(target, instrument.dp)
    stopLossPct = roundTo(((entry - stop) / entry) * 100, 1)
    takeProfitPct = roundTo(((target - entry) / entry) * 100, 1)
  }

  const riskBudget = options.equity * (riskPct / 100)
  const perUnit = entry - stop
  const notionalCap = Math.min(options.cash, options.equity * 0.25)
  const qty =
    wantsLong && perUnit > 0 && entry > 0
      ? roundQty(Math.min(riskBudget / perUnit, notionalCap / entry))
      : 0

  const strategy: StrategyId =
    rsiValue < 35
      ? 'rsi'
      : rangePct > 88 && trendPct > 0.15
        ? 'breakout'
        : Math.abs(trendPct) < 0.06
          ? 'meanrev'
          : 'momentum'
  const strategyName = STRATEGIES.find((s) => s.id === strategy)?.name ?? strategy

  const holdingQty = options.holdingQty ?? 0
  const steps: ScriptStep[] = []
  if (bias === 'bearish' && holdingQty > 0) steps.push({ kind: 'close', symbol: instrument.symbol })
  steps.push({ kind: 'select', symbol: instrument.symbol })
  steps.push({ kind: 'strategy', strategy })
  steps.push({ kind: 'risk', riskPct, stopLossPct, takeProfitPct })
  if (wantsLong && qty > 0) {
    steps.push({
      kind: 'order',
      symbol: instrument.symbol,
      side: 'buy',
      qty,
      limit: entry,
    })
  }

  const headline =
    bias === 'bullish'
      ? `Buy the pullback in ${instrument.symbol}`
      : bias === 'bearish'
        ? `Stand aside in ${instrument.symbol}`
        : `Range trade in ${instrument.symbol}`

  const summary = wantsLong
    ? `${instrument.symbol} is ${bias}, ${rangePct.toFixed(0)}% up its ${lookback}-bar range with RSI ${rsiValue.toFixed(0)}. ` +
      (qty > 0
        ? `The plan rests a buy for ${qty} at ${fmt(entry)}, protects it at ${fmt(stop)} (−${stopLossPct}%) and takes profit at ${fmt(target)} (+${takeProfitPct}%) on ${riskPct}% equity risk, with ${strategyName} armed for the bot.`
        : `The account is too small to size this trade at ${riskPct}% risk, so the script only arms ${strategyName} for the bot.`)
    : `${instrument.symbol} is trending down with RSI ${rsiValue.toFixed(0)}. No short selling here, so the script takes any existing position off and arms ${strategyName} for the next reclaim.`

  const levels: PlanLevel[] =
    wantsLong && entry > 0
      ? [
          { label: 'Entry', price: entry, tone: 'entry' },
          { label: 'Stop', price: stop, tone: 'stop' },
          { label: 'Target', price: target, tone: 'target' },
        ]
      : []

  const code = [
    `// Meridian chart plan — ${instrument.symbol} read from the visible chart`,
    `// bias ${bias} · RSI ${rsiValue.toFixed(1)} · ${atrPct.toFixed(2)}% bars · ${rangePct.toFixed(0)}% of range`,
    ...steps.map(stepCode),
  ].join('\n')

  return {
    read: {
      symbol: instrument.symbol,
      name: instrument.name,
      price,
      dp: instrument.dp,
      bias,
      trendPct,
      rsi: rsiValue,
      atrPct,
      rangePct,
      momentumPct,
      support,
      resistance,
      bars,
      notes,
    },
    strategy,
    strategyName,
    headline,
    summary,
    entry: wantsLong ? entry : null,
    stop: wantsLong ? stop : null,
    target: wantsLong ? target : null,
    qty,
    riskPct,
    stopLossPct,
    takeProfitPct,
    steps,
    code,
    levels,
  }
}
