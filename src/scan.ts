import {
  STRATEGIES,
  signalFor,
  tradesClass,
  tunedParams,
  type BotConfig,
  type StrategyId,
} from './bot'
import { changePct, pipSize, type AssetClass, type Instrument } from './market'

/** One strategy's read on one instrument, kept for the scan's vote column. */
export interface Vote {
  strategy: StrategyId
  name: string
  dir: -1 | 0 | 1
  note: string
}

export interface ScanRow {
  instrument: Instrument
  change: number
  votes: Vote[]
  bulls: number
  bears: number
  /** 0–100: 50 is a dead split, 100 is every strategy pointing up. */
  score: number
  bias: 'Bullish' | 'Bearish' | 'Mixed'
  regime: 'Trending' | 'Ranging'
  /** Average absolute move per tick, in percent — how much room a stop needs. */
  atrPct: number
}

function sma(history: number[], n: number): number | null {
  if (history.length < n) return null
  let sum = 0
  for (let i = history.length - n; i < history.length; i++) sum += history[i]
  return sum / n
}

/** Mean absolute tick change over the last `n` bars, as a percentage. */
function atrPct(history: number[], n = 20): number {
  const start = Math.max(1, history.length - n)
  let sum = 0
  let count = 0
  for (let i = start; i < history.length; i++) {
    sum += Math.abs(history[i] / history[i - 1] - 1)
    count += 1
  }
  return count > 0 ? (sum / count) * 100 : 0
}

/**
 * Whether the tape is trending or ranging: the distance between the fast and
 * slow averages, measured against the instrument's own noise.
 */
function regimeOf(instrument: Instrument): 'Trending' | 'Ranging' {
  const fast = sma(instrument.history, 20)
  const slow = sma(instrument.history, 60)
  const noise = atrPct(instrument.history)
  if (fast === null || slow === null || noise <= 0) return 'Ranging'
  const gap = (Math.abs(fast - slow) / instrument.price) * 100
  return gap > noise * 2.2 ? 'Trending' : 'Ranging'
}

/**
 * Runs every strategy over every instrument in the enabled classes and ranks
 * them by agreement. This is the desk's decision engine: the bot itself trades
 * one strategy, while the scan shows where the whole toolbox points.
 */
export function scanMarkets(
  instruments: Instrument[],
  bot: BotConfig,
  filter: AssetClass | 'All',
): ScanRow[] {
  const tuning = tunedParams(bot)
  const rows: ScanRow[] = []

  for (const instrument of instruments) {
    if (filter !== 'All' && instrument.cls !== filter) continue
    const pip = pipSize(instrument.price, instrument.cls)
    // The pip model only reads FX and crypto, so it stays out of the vote on
    // markets it cannot trade rather than counting as a flat opinion.
    const votes: Vote[] = STRATEGIES.filter((s) => tradesClass(s.id, instrument.cls)).map(
      (s) => {
        const signalForStrategy = signalFor(s.id, instrument.history, bot.params[s.id], pip)
        return {
          strategy: s.id,
          name: s.name,
          dir: signalForStrategy.dir,
          // The armed strategy's note already reflects the bot's live tuning.
          note:
            s.id === bot.strategy
              ? signalFor(s.id, instrument.history, tuning, pip).note
              : signalForStrategy.note,
        }
      },
    )
    const bulls = votes.filter((v) => v.dir > 0).length
    const bears = votes.filter((v) => v.dir < 0).length
    const score = Math.round(50 + ((bulls - bears) / votes.length) * 50)
    rows.push({
      instrument,
      change: changePct(instrument),
      votes,
      bulls,
      bears,
      score,
      bias: bulls > bears ? 'Bullish' : bears > bulls ? 'Bearish' : 'Mixed',
      regime: regimeOf(instrument),
      atrPct: atrPct(instrument.history),
    })
  }

  rows.sort((a, b) => b.score - a.score || Math.abs(b.change) - Math.abs(a.change))
  return rows
}
