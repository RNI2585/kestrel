import { describe, expect, it } from 'vitest'
import { FEE, START_CASH, applyOrder, limitReached, startingPortfolio } from '../trade'
import { exitHit, exitsFrom } from '../exits'
import type { WorkingOrder } from '../trade'

const order = (over: Partial<WorkingOrder> = {}): WorkingOrder => ({
  id: 'o1',
  ts: 0,
  symbol: 'BTC',
  side: 'buy',
  qty: 1,
  limit: 100,
  status: 'working',
  broker: 'paper',
  note: '',
  ...over,
})

describe('applyOrder', () => {
  it('charges the fee on a buy and keeps the average cost at the fill', () => {
    const result = applyOrder(startingPortfolio(), 'BTC', 100, 'buy', 10)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.portfolio.holdings.BTC).toEqual({ qty: 10, avgCost: 100 })
    expect(result.portfolio.cash).toBeCloseTo(START_CASH - 1000 - 1000 * FEE, 8)
    expect(result.portfolio.realized).toBe(0)
  })

  it('realises profit net of the exit fee on a sell', () => {
    const bought = applyOrder(startingPortfolio(), 'BTC', 100, 'buy', 10)
    if (!bought.ok) throw new Error('buy should fill')
    const sold = applyOrder(bought.portfolio, 'BTC', 110, 'sell', 10)
    expect(sold.ok).toBe(true)
    if (!sold.ok) return
    expect(sold.pnl).toBeCloseTo(100 - 1100 * FEE, 8)
    expect(sold.portfolio.holdings.BTC).toBeUndefined()
    expect(sold.portfolio.cash).toBeCloseTo(
      START_CASH - 1000 - 1000 * FEE + 1100 - 1100 * FEE,
      8,
    )
  })

  it('weights the average cost when adding to a position', () => {
    const first = applyOrder(startingPortfolio(), 'BTC', 100, 'buy', 1)
    if (!first.ok) throw new Error('buy should fill')
    const second = applyOrder(first.portfolio, 'BTC', 200, 'buy', 1)
    if (!second.ok) throw new Error('second buy should fill')
    expect(second.portfolio.holdings.BTC.avgCost).toBeCloseTo(150, 8)
  })

  it('refuses a buy the cash cannot cover', () => {
    const result = applyOrder(startingPortfolio(), 'BTC', 100, 'buy', 2000)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/cash/i)
  })

  it('refuses a sell larger than the position', () => {
    const bought = applyOrder(startingPortfolio(), 'BTC', 100, 'buy', 1)
    if (!bought.ok) throw new Error('buy should fill')
    const result = applyOrder(bought.portfolio, 'BTC', 100, 'sell', 2)
    expect(result.ok).toBe(false)
  })

  it('refuses non-positive quantities and unusable prices', () => {
    expect(applyOrder(startingPortfolio(), 'BTC', 100, 'buy', 0).ok).toBe(false)
    expect(applyOrder(startingPortfolio(), 'BTC', 0, 'buy', 1).ok).toBe(false)
  })
})

describe('limitReached', () => {
  it('fills a buy at or below its limit and a sell at or above it', () => {
    expect(limitReached(order({ side: 'buy', limit: 100 }), 99)).toBe(true)
    expect(limitReached(order({ side: 'buy', limit: 100 }), 100)).toBe(true)
    expect(limitReached(order({ side: 'buy', limit: 100 }), 101)).toBe(false)
    expect(limitReached(order({ side: 'sell', limit: 100 }), 101)).toBe(true)
    expect(limitReached(order({ side: 'sell', limit: 100 }), 99)).toBe(false)
  })
})

describe('attached exits', () => {
  const risk = { riskPct: 2, stopLossPct: 2.5, takeProfitPct: 6 }

  it('rounds the stop below and the target above the entry', () => {
    expect(exitsFrom(100, risk, 2)).toEqual({ stopLoss: 97.5, takeProfit: 106 })
  })

  it('reports whichever level the tape traded through', () => {
    const exit = exitsFrom(100, risk, 2)
    expect(exitHit(exit, 97.4)).toBe('stop')
    expect(exitHit(exit, 97.5)).toBe('stop')
    expect(exitHit(exit, 106)).toBe('target')
    expect(exitHit(exit, 101)).toBeNull()
    expect(exitHit(undefined, 50)).toBeNull()
  })
})
