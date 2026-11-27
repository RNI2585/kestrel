/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_BOT } from '../bot'
import type { Instrument } from '../market'
import { startingPortfolio } from '../trade'
import StrategiesTab from '../components/StrategiesTab'

afterEach(cleanup)

const instrument: Instrument = {
  symbol: 'TEST',
  name: 'Test instrument',
  cls: 'Stocks',
  dp: 2,
  price: 9.94,
  prevClose: 9.9,
  history: [10.5, 11, 12, 11, 10, 11, 12, 11, 10.2, 10, 9.9, 9.92, 9.93, 9.94],
  vol: 0.01,
  base: 10,
  live: false,
  source: 'Test',
  liveAt: 0,
  historyVerified: false,
}

function renderStrategies(strategy: 'momentum' | 'support' | 'ict' = 'momentum') {
  const bot = { ...DEFAULT_BOT, strategy }
  return render(
    <StrategiesTab
      bot={bot}
      instruments={[instrument]}
      instrument={instrument}
      exits={{}}
      portfolio={startingPortfolio()}
      tick={1}
      onChange={() => {}}
    />,
  )
}

describe('support and ICT strategy indicators', () => {
  it('lists both strategies in the strategy book', () => {
    renderStrategies()

    expect(screen.getByRole('heading', { name: 'Support / resistance' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'ICT structure (close proxy)' })).toBeTruthy()
  }, 30_000)

  it('shows close-pivot support and resistance readings when armed', () => {
    renderStrategies('support')

    expect(screen.getByText('Support', { exact: true })).toBeTruthy()
    expect(screen.getByText('Resistance', { exact: true })).toBeTruthy()
    expect(screen.getByText('Confirmed close pivots')).toBeTruthy()
  }, 30_000)

  it('labels ICT sweep readings as close-only proxies', () => {
    renderStrategies('ict')

    expect(screen.getByText('Sweep method')).toBeTruthy()
    expect(screen.getByText('Close-only proxy')).toBeTruthy()
    expect(screen.getByText(/fair value gaps, wick sweeps and order blocks need OHLC candles/i)).toBeTruthy()
  }, 30_000)
})
