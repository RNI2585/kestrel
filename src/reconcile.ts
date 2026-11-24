import { FEE, type Fill } from './trade'

/**
 * Fees and reconciliation.
 *
 * The paper ledger charges a fixed commission, so every fill has a modelled
 * cost whether or not a venue was involved. A venue reports its own fees, its
 * own prices and sometimes its own idea of when something filled. This module
 * lines the two up and says where they disagree instead of quietly trusting
 * the local book.
 */

export interface VenueFill {
  /** The venue's order id, or the local fill id when a bridge echoes it. */
  id?: string
  ts: number
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  price: number
  fee?: number
}

export type ReconcileStatus =
  | 'matched'
  | 'drift'
  | 'fee-mismatch'
  /** On this desk but not in the venue statement. */
  | 'missing-at-venue'
  /** In the venue statement but not on this desk. */
  | 'missing-locally'

export interface ReconcileRow {
  status: ReconcileStatus
  symbol: string
  side: 'buy' | 'sell'
  local?: Fill
  venue?: VenueFill
  note: string
}

export interface ReconcileOptions {
  /** How far apart two fills may be stamped and still pair, in milliseconds. */
  windowMs: number
  /** Price difference tolerated before a pair is called drift, in basis points. */
  priceToleranceBps: number
  /** Quantity difference tolerated before a pair is called drift. */
  qtyTolerance: number
  /** Fee difference tolerated before a pair is called a fee mismatch. */
  feeTolerance: number
}

export const RECONCILE_DEFAULTS: ReconcileOptions = {
  windowMs: 120_000,
  priceToleranceBps: 25,
  qtyTolerance: 1e-6,
  feeTolerance: 0.01,
}

/** The commission the paper ledger charges on one side of a trade. */
export function modelledFee(fill: { qty: number; price: number }): number {
  return Math.abs(fill.qty) * Math.abs(fill.price) * FEE
}

export interface CostSummary {
  fills: number
  /** Traded value, both sides. */
  notional: number
  /** Commission charged or modelled, both sides. */
  fees: number
  /** Commission as a share of traded value, in basis points. */
  feeBps: number
  /** Realised result after commission. */
  netPnl: number
  /** Realised result before commission. */
  grossPnl: number
}

/**
 * What trading cost. The ledger's `pnl` is already net of commission, so the
 * gross figure is rebuilt from it rather than guessed at.
 */
export function costSummary(fills: Fill[]): CostSummary {
  let notional = 0
  let fees = 0
  let netPnl = 0
  for (const fill of fills) {
    const value = Math.abs(fill.qty) * Math.abs(fill.price)
    notional += value
    fees += modelledFee(fill)
    netPnl += fill.pnl ?? 0
  }
  return {
    fills: fills.length,
    notional,
    fees,
    feeBps: notional > 0 ? (fees / notional) * 10_000 : 0,
    netPnl,
    grossPnl: netPnl + fees,
  }
}

function priceDriftBps(local: Fill, venue: VenueFill): number {
  if (!(local.price > 0) || !(venue.price > 0)) return Number.POSITIVE_INFINITY
  return Math.abs(venue.price / local.price - 1) * 10_000
}

/**
 * Pairs local fills with a venue statement. A venue id wins outright; failing
 * that, the nearest same-symbol, same-side fill inside the time window pairs
 * up. Anything left over on either side is reported, never silently dropped.
 */
export function reconcile(
  local: Fill[],
  venue: VenueFill[],
  options: Partial<ReconcileOptions> = {},
): ReconcileRow[] {
  const opts: ReconcileOptions = { ...RECONCILE_DEFAULTS, ...options }
  const rows: ReconcileRow[] = []
  const used = new Set<number>()
  const sortedLocal = [...local].sort((a, b) => a.ts - b.ts)

  for (const fill of sortedLocal) {
    let index = venue.findIndex((v, i) => !used.has(i) && Boolean(v.id) && v.id === fill.id)
    if (index < 0) {
      let best = -1
      let bestGap = Number.POSITIVE_INFINITY
      venue.forEach((candidate, i) => {
        if (used.has(i)) return
        if (candidate.symbol !== fill.symbol || candidate.side !== fill.side) return
        if (Math.abs(candidate.qty - fill.qty) > opts.qtyTolerance) return
        const gap = Math.abs(candidate.ts - fill.ts)
        if (gap > opts.windowMs || gap >= bestGap) return
        best = i
        bestGap = gap
      })
      index = best
    }

    if (index < 0) {
      rows.push({
        status: 'missing-at-venue',
        symbol: fill.symbol,
        side: fill.side,
        local: fill,
        note: 'Booked here, not in the statement',
      })
      continue
    }

    used.add(index)
    const matched = venue[index]
    const drift = priceDriftBps(fill, matched)
    if (drift > opts.priceToleranceBps) {
      rows.push({
        status: 'drift',
        symbol: fill.symbol,
        side: fill.side,
        local: fill,
        venue: matched,
        note: `Venue filled ${drift.toFixed(0)}bp away from the book`,
      })
      continue
    }
    if (typeof matched.fee === 'number') {
      const modelled = modelledFee(fill)
      if (Math.abs(matched.fee - modelled) > opts.feeTolerance) {
        rows.push({
          status: 'fee-mismatch',
          symbol: fill.symbol,
          side: fill.side,
          local: fill,
          venue: matched,
          note: `Venue charged ${matched.fee.toFixed(4)}, the book modelled ${modelled.toFixed(4)}`,
        })
        continue
      }
    }
    rows.push({
      status: 'matched',
      symbol: fill.symbol,
      side: fill.side,
      local: fill,
      venue: matched,
      note: 'Agreed',
    })
  }

  venue.forEach((candidate, i) => {
    if (used.has(i)) return
    rows.push({
      status: 'missing-locally',
      symbol: candidate.symbol,
      side: candidate.side,
      venue: candidate,
      note: 'In the statement, never booked here',
    })
  })

  return rows
}

export interface StatementResult {
  values: VenueFill[]
  skipped: number
}

/**
 * Reads a pasted venue statement: a bare array, or an object with a `fills`,
 * `orders` or `trades` array. Unknown rows are skipped rather than guessed at.
 */
export function parseVenueStatement(text: string): StatementResult | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { error: 'That is not JSON. Paste the array of fills from your venue export.' }
  }

  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? ((raw as Record<string, unknown>).fills ??
        (raw as Record<string, unknown>).orders ??
        (raw as Record<string, unknown>).trades)
      : null
  if (!Array.isArray(list)) {
    return { error: 'No fills array found. Expected an array, or an object with a fills array.' }
  }

  const values: VenueFill[] = []
  let skipped = 0
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') {
      skipped += 1
      continue
    }
    const row = entry as Record<string, unknown>
    const symbol = typeof row.symbol === 'string' ? row.symbol : null
    const side = row.side === 'buy' || row.side === 'sell' ? row.side : null
    const qty = Number(row.qty ?? row.quantity ?? row.size)
    const price = Number(row.price ?? row.fill_price ?? row.avgPrice)
    const tsRaw = row.ts ?? row.time ?? row.timestamp ?? row.filled_at
    const ts =
      typeof tsRaw === 'number'
        ? tsRaw
        : typeof tsRaw === 'string'
          ? Date.parse(tsRaw)
          : Number.NaN
    if (!symbol || !side || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      skipped += 1
      continue
    }
    const idRaw = row.id ?? row.order_id ?? row.orderId
    const feeRaw = Number(row.fee ?? row.commission)
    values.push({
      id: typeof idRaw === 'string' ? idRaw : undefined,
      ts: Number.isFinite(ts) ? ts : Date.now(),
      symbol,
      side,
      qty,
      price,
      fee: Number.isFinite(feeRaw) ? feeRaw : undefined,
    })
  }

  if (values.length === 0) {
    return { error: `No usable fills in that statement (${skipped} rows skipped).` }
  }
  return { values, skipped }
}
