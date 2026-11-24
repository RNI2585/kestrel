import { describe, expect, it } from 'vitest'
import { bridgeQuotes, coinbaseTicker } from '../quoteStream'
import { catchUp, humanSpan, MAX_CATCH_UP_SCANS, TICK_MS } from '../scheduler'

describe('the coinbase ticker', () => {
  it('reads a price and the 24h open from a ticker frame', () => {
    const ticker = coinbaseTicker(
      JSON.stringify({
        type: 'ticker',
        product_id: 'BTC-USD',
        price: '64250.55',
        open_24h: '63000.10',
      }),
    )
    expect(ticker).toEqual({ symbol: 'BTC', price: 64250.55, prevClose: 63000.1 })
  })

  it('ignores heartbeats, subscriptions and nonsense', () => {
    expect(coinbaseTicker(JSON.stringify({ type: 'heartbeat' }))).toBeNull()
    expect(coinbaseTicker(JSON.stringify({ type: 'subscriptions' }))).toBeNull()
    expect(coinbaseTicker('not json')).toBeNull()
    expect(
      coinbaseTicker(JSON.stringify({ type: 'ticker', product_id: 'BTC-USD', price: '0' })),
    ).toBeNull()
  })
})

describe('bridge payloads', () => {
  it('reads a list of quotes', () => {
    const quotes = bridgeQuotes(
      JSON.stringify([{ symbol: 'AAPL', price: 228.4, prevClose: 227, source: 'my bridge' }]),
    )
    expect(quotes.AAPL.price).toBe(228.4)
    expect(quotes.AAPL.prevClose).toBe(227)
    expect(quotes.AAPL.source).toBe('my bridge')
  })

  it('reads one quote per event', () => {
    const quotes = bridgeQuotes(JSON.stringify({ symbol: 'NG', last: 2.7 }))
    expect(quotes.NG.price).toBe(2.7)
  })

  it('drops what it cannot use', () => {
    expect(bridgeQuotes('not json')).toEqual({})
    expect(bridgeQuotes(JSON.stringify([{ symbol: 'AAPL', price: -1 }]))).toEqual({})
  })
})

describe('the desk clock', () => {
  it('counts the scans a pause cost', () => {
    const now = 10_000_000
    const plan = catchUp(now - 5_000, now)
    expect(plan.stalledMs).toBe(5_000 - TICK_MS)
    expect(plan.scans).toBe(4)
  })

  it('caps a long sleep so a wake-up cannot freeze the app', () => {
    const now = 10_000_000
    expect(catchUp(now - 3_600_000, now).scans).toBe(MAX_CATCH_UP_SCANS)
  })

  it('has nothing to replay when the clock was never started', () => {
    expect(catchUp(0, 10_000_000)).toEqual({ scans: 0, stalledMs: 0 })
    expect(catchUp(10_000_000, 10_000_000).scans).toBe(0)
  })

  it('says how long the desk was away', () => {
    expect(humanSpan(45_000)).toBe('45s')
    expect(humanSpan(380_000)).toBe('6m 20s')
    expect(humanSpan(600_000)).toBe('10m')
    expect(humanSpan(7_500_000)).toBe('2h 5m')
  })
})
