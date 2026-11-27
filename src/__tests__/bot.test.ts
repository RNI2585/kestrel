import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BOT,
  indicatorReadings,
  marketCondition,
  matchStrategyToMarket,
  runBotStep,
  signalFor,
  sizeForStopRisk,
} from '../bot'
import type { Instrument } from '../market'
import { startingPortfolio } from '../trade'

function risingInstrument(): Instrument {
  const history = Array.from({ length: 100 }, (_, i) => 100 * 1.002 ** i)
  const price = history[history.length - 1]
  return {
    symbol: 'TEST',
    name: 'Test instrument',
    cls: 'Stocks',
    dp: 2,
    price,
    prevClose: history[history.length - 2],
    history,
    vol: 0.002,
    base: 100,
    live: false,
    source: 'Test',
    liveAt: 0,
    historyVerified: false,
  }
}

describe('market-aware bot safeguards', () => {
  it('classifies a steady rising history and selects an aligned strategy', () => {
    const instrument = risingInstrument()
    const condition = marketCondition(instrument.history)
    const match = matchStrategyToMarket(instrument, DEFAULT_BOT)

    expect(condition.regime).toBe('Uptrend')
    expect(match.dir).toBe(1)
    expect(match.strategy).toBeTruthy()
  })

  it('flags a volatility spike after a flat baseline', () => {
    const instrument = risingInstrument()
    const history = [
      ...Array(80).fill(100),
      ...Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 102 : 100)),
    ]

    expect(marketCondition(history).regime).toBe('High volatility')
    expect(matchStrategyToMarket({ ...instrument, history }, DEFAULT_BOT).strategy).toBeNull()

    const result = runBotStep(
      [{ ...instrument, history }],
      startingPortfolio(),
      { ...DEFAULT_BOT, strategyMode: 'market-fit', classes: ['Stocks'] },
      {},
      100,
      true,
    )
    expect(result.intents).toEqual([])
  })

  it('sizes positions to the smaller of stop risk, allocation room and cash', () => {
    expect(sizeForStopRisk(10_000, 1, 2, 10_000, 10_000)).toBe(5_000)
    expect(sizeForStopRisk(10_000, 1, 2, 10_000, 10_000, 1)).toBeCloseTo(100 / 0.03)
    expect(sizeForStopRisk(10_000, 1, 2, 250, 200)).toBe(200)
    expect(sizeForStopRisk(10_000, 1, 2, 250, 200, -1)).toBe(0)
  })

  it('finds a close-pivot support bounce and exposes its levels', () => {
    const history = [10.5, 11, 12, 11, 10, 11, 12, 11, 10.2, 10, 9.9, 9.92, 9.93, 9.94]
    const signal = signalFor('support', history)
    const readings = indicatorReadings('support', history)

    expect(signal.dir).toBe(1)
    expect(signal.note).toMatch(/support/)
    expect(readings.find((item) => item.label === 'Support')?.value).toBe('9.9000')
    expect(readings.find((item) => item.label === 'Resistance')?.value).not.toBe('—')
  })

  it('detects ICT-style close structure breaks and labels sweep logic as a proxy', () => {
    const bullishHistory = [
      100, 102, 105, 103, 101, 99, 101, 104, 102, 100, 98, 100, 103, 101, 99, 101, 104, 102, 100,
      101, 105,
    ]
    const bearishSweepHistory = [
      100, 102, 105, 103, 101, 99, 101, 104, 102, 100, 98, 100, 103, 101, 99, 101, 104, 102, 100,
      101, 105, 104,
    ]

    expect(signalFor('ict', bullishHistory).dir).toBe(1)
    expect(signalFor('ict', bullishHistory).note).toMatch(/structure break/)
    expect(signalFor('ict', bearishSweepHistory).dir).toBe(-1)
    expect(indicatorReadings('ict', bearishSweepHistory).find((item) => item.label === 'Sweep method')?.value)
      .toBe('Close-only proxy')
  })

  it('records the per-market strategy on a bot intent', () => {
    const instrument = risingInstrument()
    const result = runBotStep(
      [instrument],
      startingPortfolio(),
      { ...DEFAULT_BOT, strategyMode: 'market-fit', classes: ['Stocks'] },
      {},
      100,
      true,
    )

    expect(result.intents).toHaveLength(1)
    expect(result.intents[0].side).toBe('buy')
    expect(result.intents[0].strategy).toBeTruthy()
    expect(result.intents[0].indicators?.some((item) => item.label === 'History source')).toBe(true)
  })
})
