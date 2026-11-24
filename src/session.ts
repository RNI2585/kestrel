import type { AssetClass, Instrument } from './market'

/**
 * Whether an instrument's market is actually trading, and whether its quote is
 * fresh enough to act on. The bot uses this so a closed market's frozen tape
 * cannot generate fills, and a live feed that has gone quiet cannot be treated
 * as the current price.
 *
 * The windows are deliberately simple UTC approximations — US cash equities
 * 13:30–20:00, energy 13:00–22:00, FX and metals from Sunday's 22:00 open to
 * Friday's 21:00 close, crypto always. They ignore exchange holidays and
 * daylight saving, which is why every skip is written to the desk log rather
 * than silently swallowed.
 */

export type MarketState = 'open' | 'closed'

const MINUTE = 60_000

function utcMinutes(at: Date): number {
  return at.getUTCHours() * 60 + at.getUTCMinutes()
}

function onWeekend(at: Date): boolean {
  const day = at.getUTCDay()
  return day === 0 || day === 6
}

export function marketState(cls: AssetClass, at: Date = new Date()): MarketState {
  const minutes = utcMinutes(at)
  const weekday = !onWeekend(at)

  if (cls === 'Crypto') return 'open'
  if (cls === 'Stocks') {
    return weekday && minutes >= 13 * 60 + 30 && minutes < 20 * 60 ? 'open' : 'closed'
  }
  if (cls === 'Energy') {
    return weekday && minutes >= 13 * 60 && minutes < 22 * 60 ? 'open' : 'closed'
  }
  // FX and metals run from Sunday's 22:00 UTC open to Friday's 21:00 close.
  const day = at.getUTCDay()
  if (day === 6) return 'closed'
  if (day === 0) return minutes >= 22 * 60 ? 'open' : 'closed'
  if (day === 5) return minutes < 21 * 60 ? 'open' : 'closed'
  return 'open'
}

/** A short sentence for the log when a market is shut. */
export function closedNote(cls: AssetClass): string {
  if (cls === 'Stocks') return 'US equities are outside the 13:30–20:00 UTC cash session'
  if (cls === 'Energy') return 'Energy is outside the 13:00–22:00 UTC pit session'
  return 'FX and metals are closed between Friday 21:00 and Sunday 22:00 UTC'
}

/**
 * True when a live-priced instrument's last quote is older than the limit.
 * Simulated instruments have no timestamp, so they are never stale — their
 * guard is the session calendar instead.
 */
export function quoteStale(ins: Instrument, now: number, maxAgeMs: number): boolean {
  if (!ins.live) return false
  if (!ins.liveAt) return true
  return now - ins.liveAt > maxAgeMs
}

export function minutesAgo(ts: number, now: number): number {
  return Math.max(0, Math.round((now - ts) / MINUTE))
}
