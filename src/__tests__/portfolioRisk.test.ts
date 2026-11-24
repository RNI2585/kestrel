import { describe, expect, it } from 'vitest'
import { currencyExposure, portfolioRisk, type RiskRow } from '../portfolioRisk'

const row = (symbol: string, cls: RiskRow['cls'], value: number): RiskRow => ({
  symbol,
  cls,
  value,
})

describe('portfolio risk', () => {
  it('has nothing to say about an empty book', () => {
    const risk = portfolioRisk([], 100_000)
    expect(risk.gross).toBe(0)
    expect(risk.largest).toBeNull()
    expect(risk.hhi).toBe(0)
    expect(risk.worst).toBeNull()
  })

  it('measures exposure against equity and finds the largest position', () => {
    const risk = portfolioRisk(
      [row('BTC', 'Crypto', 30_000), row('AAPL', 'Stocks', 10_000)],
      100_000,
    )
    expect(risk.grossPct).toBeCloseTo(40, 8)
    expect(risk.largest?.symbol).toBe('BTC')
    expect(risk.largest?.pct).toBeCloseTo(30, 8)
    expect(risk.top3Pct).toBeCloseTo(40, 8)
  })

  it('puts correlated names in one cluster', () => {
    const risk = portfolioRisk(
      [row('BTC', 'Crypto', 20_000), row('ETH', 'Crypto', 10_000), row('XAU', 'Metals', 5_000)],
      100_000,
    )
    const majors = risk.clusters.find((c) => c.id === 'crypto-majors')
    expect(majors?.value).toBe(30_000)
    expect(majors?.pct).toBeCloseTo(30, 8)
    expect(majors?.shockLoss).toBeCloseTo(1_500, 8)
    expect(risk.worst?.id).toBe('crypto-majors')
  })

  it('calls a single-position book concentrated', () => {
    const risk = portfolioRisk([row('TSLA', 'Stocks', 50_000)], 100_000)
    expect(risk.hhi).toBeCloseTo(1, 8)
    expect(risk.top3Pct).toBeCloseTo(50, 8)
    expect(risk.clusters[0].shockLoss).toBeCloseTo(2_500, 8)
  })
})

describe('currency exposure', () => {
  it('treats a long EUR/USD as long euro and short dollars', () => {
    const mix = currencyExposure([{ symbol: 'EURUSD', qty: 1_000, price: 1.08 }])
    const eur = mix.find((m) => m.code === 'EUR')
    const usd = mix.find((m) => m.code === 'USD')
    expect(eur?.value).toBeCloseTo(1_080, 8)
    expect(usd?.value).toBeCloseTo(-1_080, 8)
    expect(eur?.pct).toBeCloseTo(50, 8)
  })

  it('sizes a USD/JPY position in dollars and shorts the yen', () => {
    const mix = currencyExposure([{ symbol: 'USDJPY', qty: 2_000, price: 151 }])
    const jpy = mix.find((m) => m.code === 'JPY')
    const usd = mix.find((m) => m.code === 'USD')
    expect(usd?.value).toBeCloseTo(2_000, 8)
    expect(jpy?.value).toBeCloseTo(-2_000, 8)
  })

  it('books everything else as dollar exposure', () => {
    const mix = currencyExposure([{ symbol: 'AAPL', qty: 10, price: 200 }])
    expect(mix).toHaveLength(1)
    expect(mix[0].code).toBe('USD')
    expect(mix[0].value).toBeCloseTo(2_000, 8)
  })
})
