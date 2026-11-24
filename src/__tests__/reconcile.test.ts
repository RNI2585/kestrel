import { describe, expect, it } from 'vitest'
import {
  costSummary,
  modelledFee,
  parseVenueStatement,
  reconcile,
  type VenueFill,
} from '../reconcile'
import { FEE, type Fill } from '../trade'

const local = (over: Partial<Fill> = {}): Fill => ({
  id: 'a1',
  ts: 1_000_000,
  symbol: 'BTC',
  side: 'buy',
  qty: 1,
  price: 60_000,
  source: 'manual',
  reason: 'test',
  ...over,
})

const venue = (over: Partial<VenueFill> = {}): VenueFill => ({
  ts: 1_000_000,
  symbol: 'BTC',
  side: 'buy',
  qty: 1,
  price: 60_000,
  ...over,
})

describe('fees', () => {
  it('models the ledger commission from size and price', () => {
    expect(modelledFee({ qty: 2, price: 100 })).toBeCloseTo(200 * FEE, 12)
  })

  it('sums cost on both sides and rebuilds the gross result', () => {
    const summary = costSummary([
      local({ id: 'b1', ts: 1, side: 'buy', qty: 2, price: 100 }),
      local({ id: 'b2', ts: 2, side: 'sell', qty: 2, price: 110, pnl: 19.92 }),
    ])
    expect(summary.fills).toBe(2)
    expect(summary.notional).toBeCloseTo(420, 8)
    expect(summary.fees).toBeCloseTo(420 * FEE, 8)
    expect(summary.netPnl).toBeCloseTo(19.92, 8)
    expect(summary.grossPnl).toBeCloseTo(19.92 + 420 * FEE, 8)
    expect(summary.feeBps).toBeCloseTo(FEE * 10_000, 8)
  })
})

describe('reconciliation', () => {
  it('agrees when the venue reports the same fill', () => {
    const rows = reconcile([local()], [venue()])
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('matched')
  })

  it('pairs by venue id even when the clock is far apart', () => {
    const rows = reconcile([local({ id: 'ord-9' })], [venue({ id: 'ord-9', ts: 5_000_000 })])
    expect(rows[0].status).toBe('matched')
  })

  it('flags a fill the venue priced away from the book', () => {
    const rows = reconcile([local()], [venue({ price: 60_600 })])
    expect(rows[0].status).toBe('drift')
    expect(rows[0].note).toContain('bp')
  })

  it('flags a venue commission that does not match the model', () => {
    const rows = reconcile([local()], [venue({ fee: 9.5 })])
    expect(rows[0].status).toBe('fee-mismatch')
  })

  it('reports both directions of a missing fill', () => {
    const rows = reconcile(
      [local({ id: 'x1' }), local({ id: 'x2', ts: 1_000_100, qty: 2 })],
      [venue({ id: 'x1' })],
    )
    const statuses = rows.map((row) => row.status).sort()
    expect(statuses).toEqual(['matched', 'missing-at-venue'])

    const reversed = reconcile([local({ id: 'x1' })], [
      venue({ id: 'x1' }),
      venue({ id: 'x2', qty: 3, ts: 1_100_000 }),
    ])
    expect(reversed.map((row) => row.status)).toContain('missing-locally')
  })

  it('does not pair a buy with a sell of the same size', () => {
    const rows = reconcile([local({ side: 'buy' })], [venue({ side: 'sell' })])
    expect(rows[0].status).toBe('missing-at-venue')
    expect(rows[1].status).toBe('missing-locally')
  })
})

describe('venue statements', () => {
  it('reads a bare array with ISO timestamps', () => {
    const parsed = parseVenueStatement(
      JSON.stringify([
        {
          id: 'v1',
          timestamp: '2026-11-24T12:00:00Z',
          symbol: 'ETH',
          side: 'sell',
          quantity: '2.5',
          price: '2500',
          commission: 1.25,
        },
      ]),
    )
    expect('error' in parsed).toBe(false)
    const values = (parsed as { values: VenueFill[] }).values
    expect(values[0].symbol).toBe('ETH')
    expect(values[0].qty).toBe(2.5)
    expect(values[0].ts).toBe(Date.parse('2026-11-24T12:00:00Z'))
    expect(values[0].fee).toBe(1.25)
  })

  it('finds a fills array inside an export object', () => {
    const parsed = parseVenueStatement(
      JSON.stringify({ orders: [{ symbol: 'XAU', side: 'buy', qty: 1, price: 2400 }] }),
    )
    expect((parsed as { values: VenueFill[] }).values).toHaveLength(1)
  })

  it('skips rows it cannot read instead of guessing', () => {
    const parsed = parseVenueStatement(
      JSON.stringify([
        { symbol: 'BTC', side: 'buy', qty: 1, price: 60000 },
        { symbol: 'BTC', side: 'sideways', qty: 1, price: 60000 },
        'nonsense',
      ]),
    )
    const result = parsed as { values: VenueFill[]; skipped: number }
    expect(result.values).toHaveLength(1)
    expect(result.skipped).toBe(2)
  })

  it('says why a statement cannot be read', () => {
    expect(parseVenueStatement('not json')).toEqual({
      error: 'That is not JSON. Paste the array of fills from your venue export.',
    })
    expect('error' in parseVenueStatement(JSON.stringify({ nothing: true }))).toBe(true)
    expect('error' in parseVenueStatement('[]')).toBe(true)
  })
})
