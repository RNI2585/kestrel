import { describe, expect, it } from 'vitest'
import { byStrategy, bySymbol, roundTrips, sharpe, tradeStats } from '../analytics'
import { FEE, type Fill } from '../trade'
import type { EquityPoint } from '../timeline'

let counter = 0
const fill = (over: Partial<Fill>): Fill => ({
  id: `f${(counter += 1)}`,
  ts: counter,
  symbol: 'BTC',
  side: 'buy',
  qty: 1,
  price: 100,
  source: 'manual',
  reason: 'test',
  ...over,
})

describe('round trips', () => {
  it('matches a buy and a sell into one closed trade', () => {
    const trips = roundTrips([
      fill({ ts: 1, side: 'buy', qty: 10, price: 100 }),
      fill({ ts: 2, side: 'sell', qty: 10, price: 110 }),
    ])
    expect(trips).toHaveLength(1)
    expect(trips[0].qty).toBe(10)
    expect(trips[0].pnl).toBeCloseTo(100, 8)
    expect(trips[0].fees).toBeCloseTo((100 + 110) * 10 * FEE, 8)
  })

  it('consumes the oldest lot first, so a partial exit splits into two trips', () => {
    const trips = roundTrips([
      fill({ ts: 1, side: 'buy', qty: 10, price: 100 }),
      fill({ ts: 2, side: 'buy', qty: 10, price: 120 }),
      fill({ ts: 3, side: 'sell', qty: 15, price: 130 }),
    ])
    expect(trips).toHaveLength(2)
    expect(trips[0].qty).toBe(10)
    expect(trips[0].pnl).toBeCloseTo(300, 8)
    expect(trips[1].qty).toBe(5)
    expect(trips[1].pnl).toBeCloseTo(50, 8)
  })

  it('counts an open position as nothing', () => {
    expect(roundTrips([fill({ side: 'buy', qty: 5 })])).toHaveLength(0)
  })

  it('keeps the strategy that opened the lot when the exit has none', () => {
    const trips = roundTrips([
      fill({ ts: 1, side: 'buy', strategy: 'rsi' }),
      fill({ ts: 2, side: 'sell', price: 101 }),
    ])
    expect(trips[0].strategy).toBe('rsi')
  })
})

describe('trade stats', () => {
  const trips = roundTrips([
    fill({ ts: 1, side: 'buy', qty: 10, price: 100 }),
    fill({ ts: 2, side: 'sell', qty: 10, price: 110 }),
    fill({ ts: 3, side: 'buy', qty: 5, price: 200 }),
    fill({ ts: 4, side: 'sell', qty: 5, price: 190 }),
  ])
  const stats = tradeStats(trips)

  it('counts wins, losses and the rate between them', () => {
    expect(stats.trades).toBe(2)
    expect(stats.wins).toBe(1)
    expect(stats.losses).toBe(1)
    expect(stats.winRate).toBe(50)
  })

  it('reports profit factor and expectancy net of fees', () => {
    expect(stats.profitFactor).toBeCloseTo((100 - 0.42) / (50 + 0.39), 6)
    expect(stats.expectancy).toBeCloseTo((100 - 0.42 - 50 - 0.39) / 2, 8)
    expect(stats.fees).toBeGreaterThan(0)
  })

  it('tracks the longest runs', () => {
    expect(stats.maxWinStreak).toBe(1)
    expect(stats.maxLossStreak).toBe(1)
  })

  it('says nothing rather than zero before the first trade', () => {
    const empty = tradeStats([])
    expect(empty.winRate).toBeNull()
    expect(empty.profitFactor).toBeNull()
    expect(empty.trades).toBe(0)
  })
})

describe('grouping', () => {
  const trips = roundTrips([
    fill({ ts: 1, side: 'buy', symbol: 'BTC', strategy: 'momentum' }),
    fill({ ts: 2, side: 'sell', symbol: 'BTC', price: 105 }),
    fill({ ts: 3, side: 'buy', symbol: 'ETH', qty: 2 }),
    fill({ ts: 4, side: 'sell', symbol: 'ETH', qty: 2, price: 99 }),
    fill({ ts: 5, side: 'buy', symbol: 'XAU' }),
    fill({ ts: 6, side: 'sell', symbol: 'XAU', price: 101 }),
  ])

  it('breaks the book down by symbol, busiest first', () => {
    const rows = bySymbol(trips)
    expect(rows[0].key).toBe('BTC')
    expect(rows.map((r) => r.key).sort()).toEqual(['BTC', 'ETH', 'XAU'])
  })

  it('attributes unattributed trades to manual', () => {
    const rows = byStrategy(trips)
    expect(rows.map((r) => r.key)).toContain('manual')
    expect(rows.map((r) => r.key)).toContain('momentum')
  })
})

describe('session sharpe', () => {
  const curve = (values: number[]): EquityPoint[] =>
    values.map((v, i) => ({ t: i * 1000, v }))

  it('is null for a flat or too-short curve', () => {
    expect(sharpe([])).toBeNull()
    expect(sharpe(curve([100, 100, 100, 100, 100]))).toBeNull()
  })

  it('is positive for a curve that keeps rising', () => {
    const ratio = sharpe(curve([100, 101, 102.5, 104, 106]))
    expect(ratio).not.toBeNull()
    expect(ratio as number).toBeGreaterThan(0)
  })
})
