/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Instrument } from '../market'
import { paperConnection, type BrokerConnection } from '../brokers'
import TradeTicket from '../components/TradeTicket'

afterEach(cleanup)

const instrument = (liveAt: number, live = true): Instrument => ({
  symbol: 'AAPL',
  name: 'Apple',
  cls: 'Stocks',
  dp: 2,
  price: 200,
  prevClose: 199,
  history: [199, 200],
  vol: 0.001,
  base: 200,
  live,
  source: 'Test feed',
  liveAt,
})

const bridge: BrokerConnection = {
  id: 'custom-1',
  kind: 'custom',
  label: 'My bridge',
  endpoint: 'https://bridge.example',
  key: '',
  secret: '',
  status: 'linked',
  message: '',
}

function renderTicket(ins: Instrument) {
  return render(
    <TradeTicket
      instrument={ins}
      cash={1000}
      connections={[paperConnection(), bridge]}
      activeBrokerId={bridge.id}
      maxQuoteAgeSec={180}
      remembered={false}
      recommendation={{
        strategy: null,
        dir: 0,
        reason: 'Warming up',
        regime: 'Warming up',
        verifiedHistory: false,
        indicators: [],
      }}
      onRoute={vi.fn()}
      onSubmit={vi.fn(async () => ({ ok: true as const }))}
    />,
  )
}

describe('broker order quote safeguards', () => {
  it('disables external market orders for stale live prices', () => {
    const { container } = renderTicket(instrument(Date.now() - 181_000))

    expect(screen.getByText(/Stale · Test feed/)).toBeTruthy()
    expect((container.querySelector('.submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables external market orders for simulated prices', () => {
    const { container } = renderTicket(instrument(0, false))

    expect(screen.getByText(/Simulated quote/)).toBeTruthy()
    expect((container.querySelector('.submit') as HTMLButtonElement).disabled).toBe(true)
  })
})
