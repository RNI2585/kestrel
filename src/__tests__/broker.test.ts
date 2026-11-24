import { describe, expect, it } from 'vitest'
import { parseBrokerOrderAck } from '../brokers'

describe('broker order acknowledgements', () => {
  it('does not call an accepted order a fill', () => {
    expect(
      parseBrokerOrderAck({ status: 'NEW', orderId: 'venue-123' }, 2),
    ).toEqual({ status: 'accepted', orderId: 'venue-123' })
  })

  it('computes a confirmed average price and recognizes partial fills', () => {
    expect(
      parseBrokerOrderAck(
        {
          status: 'PARTIALLY_FILLED',
          orderId: 123,
          executedQty: '0.5',
          cummulativeQuoteQty: '125',
        },
        1,
      ),
    ).toEqual({
      status: 'partial',
      orderId: '123',
      filledQty: 0.5,
      averagePrice: 250,
    })
  })

  it('recognizes complete fills only when execution quantity and price are present', () => {
    expect(
      parseBrokerOrderAck(
        { status: 'FILLED', executedQty: '2', avgPrice: '101.25' },
        2,
      ),
    ).toEqual({
      status: 'filled',
      orderId: undefined,
      filledQty: 2,
      averagePrice: 101.25,
    })
    expect(parseBrokerOrderAck({ status: 'FILLED' }, 2)).toEqual({
      status: 'accepted',
      orderId: undefined,
    })
  })
})
