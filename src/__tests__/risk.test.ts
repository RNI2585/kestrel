import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RISK_LIMITS,
  checkBotEntry,
  clampLimits,
  consecutiveLosses,
  dayKey,
  entriesToday,
  evaluateRisk,
  graduationBlock,
  newDayAnchor,
  rollDay,
} from '../risk'
import type { Instrument } from '../market'
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

const entryInstrument: Instrument = {
  symbol: 'BTC',
  name: 'Bitcoin',
  cls: 'Crypto',
  dp: 2,
  price: 100,
  prevClose: 99,
  history: [99, 100],
  vol: 0.01,
  base: 100,
  live: false,
  historyVerified: false,
}

const entryInput = {
  instrument: entryInstrument,
  proposedNotional: 100,
  currentClassExposure: 100,
  currentExposure: 100,
  currentPositions: 1,
  tradesToday: 0,
  opensPosition: true,
  equity: 1_000,
  limits: DEFAULT_RISK_LIMITS,
  riskBlocks: [],
  now: Date.UTC(2026, 10, 27, 15),
  requiresVerifiedHistory: false,
  requiresLiveQuote: false,
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

  describe('bot entry revalidation', () => {
    it('passes entries inside account, session and quote limits', () => {
      expect(checkBotEntry(entryInput)).toBeNull()
    })

    it('keeps new entries blocked by the current account risk verdict', () => {
      const riskBlock = { code: 'daily-loss' as const, reason: 'Daily loss limit reached' }
      expect(checkBotEntry({ ...entryInput, riskBlocks: [riskBlock] })).toEqual({
        kind: 'block',
        reason: riskBlock.reason,
      })
    })

    it('applies asset-class caps to reserved and current exposure', () => {
      expect(
        checkBotEntry({
          ...entryInput,
          currentClassExposure: 250,
          reservedClassExposure: 100,
        }),
      ).toEqual({
        kind: 'block',
        reason: 'Crypto exposure would exceed the 40% asset-class cap',
      })
    })

    it('reserves account exposure, open-position slots and daily entries across a scan batch', () => {
      expect(
        checkBotEntry({
          ...entryInput,
          currentExposure: 650,
          reservedExposure: 100,
        })?.reason,
      ).toContain('account cap')
      expect(
        checkBotEntry({
          ...entryInput,
          currentPositions: DEFAULT_RISK_LIMITS.maxPositions,
        })?.reason,
      ).toContain('position slots are full')
      expect(
        checkBotEntry({
          ...entryInput,
          tradesToday: DEFAULT_RISK_LIMITS.maxTradesPerDay - 1,
          reservedTradesToday: 1,
        })?.reason,
      ).toContain('entries taken today')
    })

    it('requires verified bars and fresh live quotes when routing bot entries externally', () => {
      expect(checkBotEntry({ ...entryInput, requiresVerifiedHistory: true })?.kind).toBe('stale')

      const staleInstrument: Instrument = {
        ...entryInstrument,
        live: true,
        liveAt: entryInput.now - 181_000,
      }
      expect(
        checkBotEntry({
          ...entryInput,
          instrument: staleInstrument,
          requiresLiveQuote: true,
        })?.reason,
      ).toContain('older than 180s')
    })

    it('refuses buys while the instrument market is closed', () => {
      const stock: Instrument = { ...entryInstrument, symbol: 'AAPL', cls: 'Stocks' }
      const gate = checkBotEntry({
        ...entryInput,
        instrument: stock,
        now: Date.UTC(2026, 10, 27, 12),
      })
      expect(gate?.kind).toBe('session')
    })
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
