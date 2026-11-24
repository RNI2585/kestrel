import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RISK_LIMITS,
  clampLimits,
  consecutiveLosses,
  dayKey,
  entriesToday,
  evaluateRisk,
  graduationBlock,
  newDayAnchor,
  rollDay,
} from '../risk'
import type { Fill } from '../trade'

const fill = (over: Partial<Fill>): Fill => ({
  id: Math.random().toString(36).slice(2),
  ts: Date.now(),
  symbol: 'BTC',
  side: 'buy',
  qty: 1,
  price: 100,
  source: 'bot',
  reason: 'test',
  ...over,
})

const base = {
  equity: 100_000,
  startEquity: 100_000,
  exposurePct: 20,
  positions: 1,
  tradesToday: 0,
  losingStreak: 0,
  strategy: { id: 'momentum' as const, name: 'Momentum' },
  auto: false,
  limits: DEFAULT_RISK_LIMITS,
}

describe('the day anchor', () => {
  it('labels days on the local calendar', () => {
    expect(dayKey(new Date(2026, 10, 24, 9).getTime())).toBe('2026-11-24')
  })

  it('rolls over at midnight and keeps the anchor inside the same day', () => {
    const morning = new Date(2026, 10, 24, 9).getTime()
    const anchor = newDayAnchor(100_000, morning)
    expect(rollDay(anchor, 120_000, morning + 60_000)).toBe(anchor)
    expect(rollDay(anchor, 120_000, new Date(2026, 10, 25, 0, 5).getTime()).startEquity).toBe(
      120_000,
    )
  })
})

describe('counting the day', () => {
  it('counts only bot buys made today', () => {
    const now = new Date(2026, 10, 24, 15).getTime()
    const yesterday = new Date(2026, 10, 23, 15).getTime()
    const fills = [
      fill({ ts: now, side: 'buy', source: 'bot' }),
      fill({ ts: now, side: 'buy', source: 'manual' }),
      fill({ ts: now, side: 'sell', source: 'bot' }),
      fill({ ts: yesterday, side: 'buy', source: 'bot' }),
    ]
    expect(entriesToday(fills, now)).toBe(1)
  })

  it('counts trailing losers without looking past the last winner', () => {
    const fills = [
      fill({ ts: 1, pnl: -5 }),
      fill({ ts: 2, pnl: 3 }),
      fill({ ts: 3, pnl: -1 }),
      fill({ ts: 4, pnl: -2 }),
      fill({ ts: 5, side: 'buy' }),
    ]
    expect(consecutiveLosses(fills)).toBe(2)
  })
})

describe('evaluateRisk', () => {
  it('passes a desk inside every limit', () => {
    expect(evaluateRisk(base)).toEqual([])
  })

  it('pauses entries when the day is down past its loss limit', () => {
    const blocks = evaluateRisk({ ...base, equity: 96_000, startEquity: 100_000 })
    expect(blocks.map((b) => b.code)).toContain('daily-loss')
  })

  it('blocks on exposure, position count, the entry cap and a losing streak', () => {
    const blocks = evaluateRisk({
      ...base,
      exposurePct: 95,
      positions: 6,
      tradesToday: 30,
      losingStreak: 4,
    })
    expect(blocks.map((b) => b.code)).toEqual([
      'exposure',
      'positions',
      'trade-cap',
      'streak',
    ])
  })

  it('applies graduation only to hands-off execution', () => {
    const strategy = { id: 'momentum' as const, name: 'Momentum' }
    expect(evaluateRisk({ ...base, auto: true, strategy })).toEqual([
      expect.objectContaining({ code: 'graduation' }),
    ])
    expect(evaluateRisk({ ...base, auto: false, strategy })).toEqual([])
  })
})

describe('graduation', () => {
  const limits = { ...DEFAULT_RISK_LIMITS, graduationTrades: 20 }

  it('needs the full sample before a model may trade unattended', () => {
    const block = graduationBlock('Momentum', { trades: 4, wins: 3, pnl: 12 }, limits)
    expect(block?.code).toBe('graduation')
    expect(block?.reason).toContain('4 of 20')
  })

  it('rejects a model that has the sample but no edge', () => {
    const block = graduationBlock('Momentum', { trades: 25, wins: 8, pnl: -40 }, limits)
    expect(block?.reason).toContain('down')
  })

  it('lets a model with a positive record through', () => {
    expect(graduationBlock('Momentum', { trades: 25, wins: 14, pnl: 90 }, limits)).toBeNull()
  })

  it('can be switched off entirely', () => {
    const off = { ...limits, requireGraduation: false }
    expect(graduationBlock('Momentum', undefined, off)).toBeNull()
  })
})

describe('clampLimits', () => {
  it('clamps junk input and keeps the defaults otherwise', () => {
    const limits = clampLimits({ maxDailyLossPct: 900, maxPositions: 0 })
    expect(limits.maxDailyLossPct).toBe(100)
    expect(limits.maxPositions).toBe(1)
    expect(limits.maxExposurePct).toBe(DEFAULT_RISK_LIMITS.maxExposurePct)
    expect(clampLimits(undefined)).toEqual(DEFAULT_RISK_LIMITS)
  })
})
