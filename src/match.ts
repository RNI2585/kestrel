import {
  STRATEGIES,
  indicatorReadings,
  signalFor,
  tradesClass,
  type BotConfig,
  type StrategyId,
} from './bot'
import { pipSize, type Instrument } from './market'
import type { Fill, Side } from './trade'

export type MatchVerdict = 'Profitable' | 'Minor loss' | 'Risky'

/**
 * The model that best explains a fill at the moment it was booked, judged on
 * the tape it traded and on how that model has actually done on this account.
 */
export interface FillMatch {
  strategy: StrategyId
  name: string
  /** 0–100 confidence the fill is on the right side of the better model. */
  score: number
  verdict: MatchVerdict
  note: string
  indicators: Fill['indicators']
}

export interface StrategyRecord {
  trades: number
  wins: number
  pnl: number
}

interface Lot {
  qty: number
  price: number
  strategy?: StrategyId
}

const EMPTY_RECORDS: Partial<Record<StrategyId, StrategyRecord>> = {}

/**
 * Closed-trade record per strategy, rebuilt from the fills: buys open lots,
 * sells consume the oldest lot first, and each round trip is credited to the
 * strategy that opened it.
 */
export function strategyRecords(fills: Fill[]): Partial<Record<StrategyId, StrategyRecord>> {
  const lots = new Map<string, Lot[]>()
  const out: Partial<Record<StrategyId, StrategyRecord>> = {}
  const credit = (id: StrategyId, pnl: number) => {
    const record = out[id] ?? { trades: 0, wins: 0, pnl: 0 }
    record.trades += 1
    record.pnl += pnl
    if (pnl > 0) record.wins += 1
    out[id] = record
  }

  for (const fill of [...fills].sort((a, b) => a.ts - b.ts)) {
    if (fill.side === 'buy') {
      const queue = lots.get(fill.symbol) ?? []
      queue.push({ qty: fill.qty, price: fill.price, strategy: fill.strategy })
      lots.set(fill.symbol, queue)
      continue
    }
    const queue = lots.get(fill.symbol) ?? []
    let remaining = fill.qty
    while (remaining > 1e-9 && queue.length > 0) {
      const lot = queue[0]
      const take = Math.min(lot.qty, remaining)
      const id = fill.strategy ?? lot.strategy
      if (id) credit(id, (fill.price - lot.price) * take)
      lot.qty -= take
      remaining -= take
      if (lot.qty <= 1e-9) queue.shift()
    }
    lots.set(fill.symbol, queue)
  }
  return out
}

function verdictFor(score: number): MatchVerdict {
  if (score >= 72) return 'Profitable'
  if (score >= 55) return 'Minor loss'
  return 'Risky'
}

/**
 * Scores every model that can trade the instrument for this fill and returns
 * the best fit. A model that points the same way as the fill, on a tape it
 * knows, and that has been earning on this account wins.
 */
export function matchFill(
  instrument: Instrument,
  side: Side,
  bot: BotConfig,
  records: Partial<Record<StrategyId, StrategyRecord>> = EMPTY_RECORDS,
): FillMatch {
  const dir = side === 'buy' ? 1 : -1
  const pip = pipSize(instrument.price, instrument.cls)

  const candidates = STRATEGIES.filter((s) => tradesClass(s.id, instrument.cls)).map((entry) => {
    const signal = signalFor(entry.id, instrument.history, bot.params[entry.id], pip)
    const record = records[entry.id]
    const winRate = record && record.trades > 0 ? (record.wins / record.trades) * 100 : null

    let score = 40
    if (signal.dir === dir) score += 30
    else if (signal.dir === 0) score += 8
    else score -= 12
    if (winRate !== null) score += (winRate - 50) * 0.3
    if (record && record.pnl > 0) score += 5
    score = Math.max(1, Math.min(99, Math.round(score)))

    const stance =
      signal.dir === dir
        ? `backing the ${side}`
        : signal.dir === 0
          ? 'neutral here'
          : `reading against the ${side}`

    return {
      strategy: entry.id,
      name: entry.name,
      score,
      verdict: verdictFor(score),
      note:
        `${entry.name} is ${stance}: ${signal.note}` +
        (winRate === null
          ? '. No closed trades on this model yet.'
          : `. ${record!.trades} closed at ${winRate.toFixed(0)}% win rate for ${
              record!.pnl >= 0 ? '+' : '−'
            }${Math.abs(record!.pnl).toFixed(2)}.`),
      indicators: indicatorReadings(entry.id, instrument.history, bot.params[entry.id], pip),
      recordPnl: record?.pnl ?? 0,
    }
  })

  if (candidates.length === 0) {
    const fallback = STRATEGIES[0]
    return {
      strategy: fallback.id,
      name: fallback.name,
      score: 1,
      verdict: 'Risky',
      note: 'No model trades this instrument.',
      indicators: [],
    }
  }

  candidates.sort((a, b) => b.score - a.score || b.recordPnl - a.recordPnl)
  const best = candidates[0]
  return {
    strategy: best.strategy,
    name: best.name,
    score: best.score,
    verdict: best.verdict,
    note: best.note,
    indicators: best.indicators,
  }
}
