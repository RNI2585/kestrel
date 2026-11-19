export type Side = 'buy' | 'sell'
export type OrderType = 'market' | 'limit'

export interface Holding {
  qty: number
  avgCost: number
}

export interface Portfolio {
  cash: number
  holdings: Record<string, Holding>
  realized: number
  deposited: number
}

export interface Fill {
  id: string
  ts: number
  symbol: string
  side: Side
  qty: number
  price: number
  source: 'bot' | 'manual'
  reason: string
  pnl?: number
}

/** A resting order held by the terminal until the market trades through it. */
export interface WorkingOrder {
  id: string
  ts: number
  symbol: string
  side: Side
  qty: number
  limit: number
  status: 'working' | 'filled' | 'cancelled'
  broker: string
  note: string
}

export type OrderResult =
  | { ok: true; portfolio: Portfolio; pnl?: number }
  | { ok: false; error: string }

/** 2 basis points, charged on both sides like a retail broker. */
export const FEE = 0.0002
export const START_CASH = 100_000

export function startingPortfolio(): Portfolio {
  return { cash: START_CASH, holdings: {}, realized: 0, deposited: START_CASH }
}

export function applyOrder(
  portfolio: Portfolio,
  symbol: string,
  marketPrice: number,
  side: Side,
  qty: number,
): OrderResult {
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: 'Enter a quantity above zero.' }
  }
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
    return { ok: false, error: 'No price available for this instrument.' }
  }
  const notional = qty * marketPrice
  const fee = notional * FEE
  const holdings = { ...portfolio.holdings }

  if (side === 'buy') {
    if (notional + fee > portfolio.cash + 1e-9) {
      return { ok: false, error: 'Not enough cash for this order.' }
    }
    const held = holdings[symbol] ?? { qty: 0, avgCost: 0 }
    const nextQty = held.qty + qty
    holdings[symbol] = {
      qty: nextQty,
      avgCost: (held.qty * held.avgCost + notional) / nextQty,
    }
    return {
      ok: true,
      portfolio: { ...portfolio, cash: portfolio.cash - notional - fee, holdings },
    }
  }

  const held = holdings[symbol]
  if (!held || held.qty + 1e-9 < qty) {
    return { ok: false, error: 'You do not hold that many units.' }
  }
  const pnl = (marketPrice - held.avgCost) * qty - fee
  const nextQty = held.qty - qty
  if (nextQty <= 1e-9) {
    delete holdings[symbol]
  } else {
    holdings[symbol] = { qty: nextQty, avgCost: held.avgCost }
  }
  return {
    ok: true,
    pnl,
    portfolio: {
      ...portfolio,
      cash: portfolio.cash + notional - fee,
      holdings,
      realized: portfolio.realized + pnl,
    },
  }
}

/** A buy limit fills at or below its price, a sell limit at or above it. */
export function limitReached(order: WorkingOrder, marketPrice: number): boolean {
  return order.side === 'buy' ? marketPrice <= order.limit : marketPrice >= order.limit
}
