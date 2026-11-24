import type { StrategyId } from './bot'
import type { StrategyRecord } from './match'
import type { Fill } from './trade'

/**
 * The limits that stand between an unattended bot and the account. Everything
 * here is expressed as a percentage or a count so it survives a change of
 * account size, and every limit only ever blocks *new entries*: stops, targets
 * and signal-flip exits must always be allowed to close a position, otherwise
 * a limit would trap the account in the very trade it was meant to contain.
 */
export interface RiskLimits {
  /** Stop opening trades once the day is down this much from its opening equity. */
  maxDailyLossPct: number
  /** Gross position value as a share of equity. */
  maxExposurePct: number
  /** Open positions at once. */
  maxPositions: number
  /** Entries per session. */
  maxTradesPerDay: number
  /** Stop entering after this many closed losers in a row. */
  maxConsecutiveLosses: number
  /** Only let a model trade unattended once it has a live record. */
  requireGraduation: boolean
  /** Closed round trips a model needs before it may trade unattended. */
  graduationTrades: number
  /** A live quote older than this is treated as absent. */
  maxQuoteAgeSec: number
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxDailyLossPct: 3,
  maxExposurePct: 80,
  maxPositions: 6,
  maxTradesPerDay: 30,
  maxConsecutiveLosses: 4,
  requireGraduation: true,
  graduationTrades: 20,
  maxQuoteAgeSec: 180,
}

export type BlockCode =
  | 'daily-loss'
  | 'exposure'
  | 'positions'
  | 'trade-cap'
  | 'streak'
  | 'graduation'

export interface RiskBlock {
  code: BlockCode
  /** Shown in the banner and the desk log, so it has to read as a sentence. */
  reason: string
}

const LIMIT_FIELDS: { key: keyof RiskLimits; min: number; max: number }[] = [
  { key: 'maxDailyLossPct', min: 0.1, max: 100 },
  { key: 'maxExposurePct', min: 1, max: 1000 },
  { key: 'maxPositions', min: 1, max: 100 },
  { key: 'maxTradesPerDay', min: 1, max: 2000 },
  { key: 'maxConsecutiveLosses', min: 1, max: 100 },
  { key: 'graduationTrades', min: 1, max: 500 },
  { key: 'maxQuoteAgeSec', min: 15, max: 86_400 },
]

/** Coerces whatever was stored into usable limits, field by field. */
export function clampLimits(source: Partial<RiskLimits> | undefined | null): RiskLimits {
  const limits: RiskLimits = { ...DEFAULT_RISK_LIMITS }
  if (!source || typeof source !== 'object') return limits
  const patch: Partial<Record<keyof RiskLimits, number>> = {}
  for (const field of LIMIT_FIELDS) {
    const raw = source[field.key]
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      patch[field.key] = Math.min(field.max, Math.max(field.min, raw))
    }
  }
  return {
    ...limits,
    ...patch,
    requireGraduation:
      typeof source.requireGraduation === 'boolean'
        ? source.requireGraduation
        : limits.requireGraduation,
  }
}

/** A local calendar day, so the daily loss limit resets at the trader's midnight. */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The equity the day opened at. */
export interface DayAnchor {
  day: string
  startEquity: number
}

export function newDayAnchor(equity: number, now: number): DayAnchor {
  return { day: dayKey(now), startEquity: equity }
}

/** Entries the account has already taken today. */
export function entriesToday(fills: Fill[], now: number): number {
  const day = dayKey(now)
  return fills.filter((f) => f.side === 'buy' && f.source === 'bot' && dayKey(f.ts) === day).length
}

/** Rolls the anchor over at midnight; returns the same object when it still fits. */
export function rollDay(anchor: DayAnchor | null, equity: number, now: number): DayAnchor {
  if (!anchor || anchor.day !== dayKey(now) || !(anchor.startEquity > 0)) {
    return newDayAnchor(equity, now)
  }
  return anchor
}

/** How many closed losers the account has booked in a row. */
export function consecutiveLosses(fills: Fill[]): number {
  const closed = [...fills]
    .filter((f) => typeof f.pnl === 'number')
    .sort((a, b) => a.ts - b.ts)
  let streak = 0
  for (let i = closed.length - 1; i >= 0; i -= 1) {
    const pnl = closed[i].pnl ?? 0
    if (pnl < 0) streak += 1
    else break
  }
  return streak
}

/** The model's live record against the graduation bar. */
export function graduationBlock(
  name: string,
  record: StrategyRecord | undefined,
  limits: RiskLimits,
): RiskBlock | null {
  if (!limits.requireGraduation) return null
  const trades = record?.trades ?? 0
  const pnl = record?.pnl ?? 0
  if (trades < limits.graduationTrades) {
    return {
      code: 'graduation',
      reason: `${name} has ${trades} of ${limits.graduationTrades} closed trades needed before it may trade unattended`,
    }
  }
  if (pnl <= 0) {
    return {
      code: 'graduation',
      reason: `${name} is down ${Math.abs(pnl).toFixed(2)} over ${trades} closed trades, so it may not trade unattended`,
    }
  }
  return null
}

export interface RiskInput {
  equity: number
  startEquity: number
  /** Gross position value as a share of equity, in percent. */
  exposurePct: number
  positions: number
  tradesToday: number
  /** Closed losers in a row across the account. */
  losingStreak: number
  /** The model the bot is armed with, and its live record. */
  strategy: { id: StrategyId; name: string; record?: StrategyRecord }
  /** Graduation only applies to hands-off execution. */
  auto: boolean
  limits: RiskLimits
}

/** Every limit currently breached, worst first. An empty list means clear. */
export function evaluateRisk(input: RiskInput): RiskBlock[] {
  const blocks: RiskBlock[] = []
  const { limits } = input

  if (input.startEquity > 0) {
    const dayPct = (input.equity / input.startEquity - 1) * 100
    if (dayPct <= -limits.maxDailyLossPct) {
      blocks.push({
        code: 'daily-loss',
        reason: `Day is down ${Math.abs(dayPct).toFixed(2)}% against a ${limits.maxDailyLossPct}% daily loss limit`,
      })
    }
  }

  if (input.exposurePct > limits.maxExposurePct + 1e-9) {
    blocks.push({
      code: 'exposure',
      reason: `Exposure is ${input.exposurePct.toFixed(0)}% of equity against a ${limits.maxExposurePct}% cap`,
    })
  }

  if (input.positions >= limits.maxPositions) {
    blocks.push({
      code: 'positions',
      reason: `${input.positions} of ${limits.maxPositions} position slots are full`,
    })
  }

  if (input.tradesToday >= limits.maxTradesPerDay) {
    blocks.push({
      code: 'trade-cap',
      reason: `${input.tradesToday} entries taken today, the cap is ${limits.maxTradesPerDay}`,
    })
  }

  if (input.losingStreak >= limits.maxConsecutiveLosses) {
    blocks.push({
      code: 'streak',
      reason: `${input.losingStreak} losing trades in a row against a ${limits.maxConsecutiveLosses} streak limit`,
    })
  }

  if (input.auto) {
    const graduation = graduationBlock(
      input.strategy.name,
      input.strategy.record,
      limits,
    )
    if (graduation) blocks.push(graduation)
  }

  return blocks
}
