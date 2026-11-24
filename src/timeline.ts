/** One sample of the account's equity, kept with the moment it was taken. */
export interface EquityPoint {
  t: number
  v: number
}

const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

/** A labelled moment on the session clock. */
export interface TimeTick {
  ms: number
  label: string
}

export const AXIS_NOTE = '15s → 1m every 15s · 15m → 1h every 15m · then every 4h'

function tickLabel(ms: number): string {
  if (ms < MINUTE) return `${Math.round(ms / SECOND)}s`
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`
  return `${Math.round(ms / HOUR)}h`
}

/**
 * The session clock the charts read on: marks every 15 seconds up to the
 * one-minute mark, every 15 minutes up to the hour, then every 4 hours. The
 * ladder is stretched to cover the span on screen plus one step, so the axis
 * always ends past the latest sample.
 */
export function timeTicks(spanMs: number): TimeTick[] {
  const marks: number[] = []
  for (let ms = 15 * SECOND; ms <= MINUTE; ms += 15 * SECOND) marks.push(ms)
  for (let ms = 15 * MINUTE; ms <= HOUR; ms += 15 * MINUTE) marks.push(ms)
  for (let ms = 4 * HOUR; marks.length < 90; ms += 4 * HOUR) {
    marks.push(ms)
    if (ms > spanMs + 4 * HOUR) break
  }
  return marks.map((ms) => ({ ms, label: tickLabel(ms) }))
}

/**
 * Where a moment sits on that stretched axis, 0 at the session's start and 1
 * at the far right. Each stretch between two marks gets equal width, so the
 * first minute and the hours either side of it all stay readable.
 */
export function positionOf(ts: number, startTs: number, ticks: TimeTick[]): number {
  if (ticks.length === 0) return 0
  const elapsed = Math.max(0, ts - startTs)
  let lower = 0
  for (let i = 0; i < ticks.length; i++) {
    const upper = ticks[i].ms
    if (elapsed < upper) return (i + (elapsed - lower) / (upper - lower)) / ticks.length
    lower = upper
  }
  return 1
}

/** Reads a saved equity curve, accepting the bare numbers older saves held. */
export function parseEquity(raw: unknown): EquityPoint[] {
  if (!Array.isArray(raw)) return []
  const now = Date.now()
  const points: EquityPoint[] = []
  raw.forEach((entry, i) => {
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      // Old saves kept one value per scan with no clock; spread them a second
      // apart ending now so the curve still draws.
      points.push({ t: now - (raw.length - i) * SECOND, v: entry })
      return
    }
    if (entry && typeof entry === 'object') {
      const source = entry as Partial<EquityPoint>
      if (typeof source.t === 'number' && typeof source.v === 'number' && Number.isFinite(source.v)) {
        points.push({ t: source.t, v: source.v })
      }
    }
  })
  return points.slice(-1200)
}
