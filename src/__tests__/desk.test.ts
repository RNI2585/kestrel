import { describe, expect, it } from 'vitest'
import { marketState, quoteStale } from '../session'
import { AUDIT_DEDUPE_MS, AUDIT_LIMIT, noteOnce, pushAudit } from '../audit'
import { timeTicks, positionOf } from '../timeline'
import { strategyRecords } from '../match'
import { runBacktest, walkForward } from '../backtest'
import { DEFAULT_BOT } from '../bot'
import type { Fill } from '../trade'
import type { Instrument } from '../market'

const utc = (iso: string) => new Date(iso)

describe('market sessions', () => {
  it('runs crypto around the clock', () => {
    expect(marketState('Crypto', utc('2026-11-28T03:00:00Z'))).toBe('open')
  })

  it('shuts US equities outside 13:30–20:00 UTC on weekdays', () => {
    expect(marketState('Stocks', utc('2026-11-24T13:29:00Z'))).toBe('closed')
    expect(marketState('Stocks', utc('2026-11-24T13:30:00Z'))).toBe('open')
    expect(marketState('Stocks', utc('2026-11-24T19:59:00Z'))).toBe('open')
    expect(marketState('Stocks', utc('2026-11-24T20:00:00Z'))).toBe('closed')
    expect(marketState('Stocks', utc('2026-11-28T15:00:00Z'))).toBe('closed')
  })

  it('trades FX and metals between the Sunday open and the Friday close', () => {
    expect(marketState('Fx', utc('2026-11-29T21:00:00Z'))).toBe('closed')
    expect(marketState('Fx', utc('2026-11-29T22:00:00Z'))).toBe('open')
    expect(marketState('Metals', utc('2026-11-27T20:59:00Z'))).toBe('open')
    expect(marketState('Metals', utc('2026-11-27T21:00:00Z'))).toBe('closed')
  })
})

describe('quote freshness', () => {
  it('never calls a simulated instrument stale', () => {
    expect(quoteStale({ live: false } as Instrument, 10_000_000, 1000)).toBe(false)
  })

  it('treats an untimestamped or old live quote as stale', () => {
    expect(quoteStale({ live: true } as Instrument, 1000, 180_000)).toBe(true)
    expect(quoteStale({ live: true, liveAt: 0 } as Instrument, 1000, 180_000)).toBe(true)
    expect(quoteStale({ live: true, liveAt: 990_000 } as Instrument, 1_000_000, 180_000)).toBe(
      false,
    )
    expect(quoteStale({ live: true, liveAt: 800_000 } as Instrument, 1_000_000, 180_000)).toBe(
      true,
    )
  })
})

describe('the desk log', () => {
  it('keeps the newest event first and trims to its limit', () => {
    let log = pushAudit([], { kind: 'feed', detail: 'first' })
    log = pushAudit(log, { kind: 'feed', detail: 'second' })
    expect(log[0].detail).toBe('second')

    let full = [] as typeof log
    for (let i = 0; i < AUDIT_LIMIT + 12; i += 1) {
      full = pushAudit(full, { kind: 'session', detail: `event ${i}` })
    }
    expect(full).toHaveLength(AUDIT_LIMIT)
  })

  it('collapses a condition that merely persists, then logs it again later', () => {
    const start = 1_000_000
    const log = pushAudit([], { kind: 'session', detail: 'shut', ts: start })
    expect(noteOnce(log, { kind: 'session', detail: 'shut', ts: start + 1000 })).toBe(log)
    expect(
      noteOnce(log, { kind: 'session', detail: 'shut', ts: start + AUDIT_DEDUPE_MS + 1 }),
    ).toHaveLength(2)
  })
})

describe('the session clock', () => {
  it('builds the 15s → 4h ladder', () => {
    const labels = timeTicks(4 * 3600_000).map((t) => t.label)
    expect(labels.slice(0, 9)).toEqual(['15s', '30s', '45s', '1m', '15m', '30m', '45m', '1h', '4h'])
  })

  it('places a moment inside the stretch it belongs to', () => {
    const ticks = timeTicks(3600_000)
    expect(positionOf(0, 0, ticks)).toBe(0)
    const midway = positionOf(30_000, 0, ticks)
    expect(midway).toBeGreaterThan(0)
    expect(midway).toBeLessThan(positionOf(45_000, 0, ticks))
  })
})

describe('strategy records', () => {
  const fill = (over: Partial<Fill>): Fill => ({
    id: Math.random().toString(36).slice(2),
    ts: 0,
    symbol: 'BTC',
    side: 'buy',
    qty: 1,
    price: 100,
    source: 'bot',
    reason: 'test',
    ...over,
  })

  it('credits a round trip to the strategy that opened it', () => {
    const records = strategyRecords([
      fill({ ts: 1, side: 'buy', price: 100, strategy: 'momentum' }),
      fill({ ts: 2, side: 'sell', price: 110 }),
    ])
    expect(records.momentum).toEqual({ trades: 1, wins: 1, pnl: 10 })
  })

  it('leaves an open position uncounted', () => {
    const records = strategyRecords([fill({ ts: 1, side: 'buy', strategy: 'rsi' })])
    expect(records.rsi).toBeUndefined()
  })
})

describe('backtests', () => {
  const opts = {
    symbol: 'BTC',
    vol: 0.004,
    startPrice: 60_000,
    cfg: { ...DEFAULT_BOT, strategy: 'momentum' as const },
    seed: 7,
    ticks: 400,
  }

  it('replays the same seed to the same result', () => {
    const a = runBacktest(opts)
    const b = runBacktest(opts)
    expect(b.endEquity).toBe(a.endEquity)
    expect(b.trades).toBe(a.trades)
    expect(b.maxDrawdownPct).toBe(a.maxDrawdownPct)
  })

  it('produces a different tape for a different seed', () => {
    const a = runBacktest(opts)
    const b = runBacktest({ ...opts, seed: 99 })
    expect(b.endEquity).not.toBe(a.endEquity)
  })
})

describe('walk-forward validation', () => {
  const args = {
    symbol: 'BTC',
    vol: 0.004,
    startPrice: 60_000,
    baseCfg: { ...DEFAULT_BOT, strategy: 'momentum' as const },
    stopPcts: [1.5, 2.5],
    takeProfitPcts: [4, 8],
    riskPcts: [2],
    trainSeeds: [11, 12],
    testSeeds: [91, 92],
    ticks: 300,
  }

  it('fits a combination from the grid and scores it twice', () => {
    const result = walkForward(args)
    expect(args.stopPcts).toContain(result.fitted.stopPct)
    expect(args.takeProfitPcts).toContain(result.fitted.takeProfitPct)
    expect(result.inSample.runs).toBe(args.trainSeeds.length)
    expect(result.outOfSample.runs).toBe(args.testSeeds.length)
    expect(result.decayPct).toBeCloseTo(
      result.outOfSample.returnPct - result.inSample.returnPct,
      8,
    )
    expect(result.survives).toBe(result.outOfSample.returnPct > 0)
  })

  it('is deterministic for fixed seeds', () => {
    const a = walkForward(args)
    const b = walkForward(args)
    expect(b).toEqual(a)
  })
})
