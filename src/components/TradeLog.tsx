import { STRATEGIES } from '../bot'
import { clockTime, price, signedMoney, signedPct, units } from '../format'
import type { Fill, IndicatorReading } from '../trade'

interface Props {
  /** Fills newest first, as the terminal keeps them. */
  fills: Fill[]
  priceOf: (symbol: string) => number | undefined
  onSelect: (symbol: string) => void
}

interface Lot {
  ts: number
  entry: number
  qty: number
  strategy?: string
  indicators: IndicatorReading[]
  note: string
}

/** One round trip: a fill that opened a position and the fill that closed it. */
interface Trade {
  key: string
  symbol: string
  entryTs: number
  exitTs?: number
  entry: number
  exit?: number
  qty: number
  pnl: number
  strategy?: string
  indicators: IndicatorReading[]
  entryNote: string
  exitNote?: string
  open: boolean
}

/**
 * Rebuilds the session's trades from its fills. Buys become lots, sells close
 * the oldest lot first, and whatever is left at the end is still open and
 * marked to the current price.
 */
function buildTrades(fills: Fill[], priceOf: (symbol: string) => number | undefined): Trade[] {
  const lots = new Map<string, Lot[]>()
  const trades: Trade[] = []
  const chrono = [...fills].sort((a, b) => a.ts - b.ts)

  for (const fill of chrono) {
    if (fill.side === 'buy') {
      const queue = lots.get(fill.symbol) ?? []
      queue.push({
        ts: fill.ts,
        entry: fill.price,
        qty: fill.qty,
        strategy: fill.strategy,
        indicators: fill.indicators ?? [],
        note: fill.reason,
      })
      lots.set(fill.symbol, queue)
      continue
    }

    const queue = lots.get(fill.symbol) ?? []
    const matched = Math.min(
      fill.qty,
      queue.reduce((sum, lot) => sum + lot.qty, 0),
    )
    let remaining = fill.qty

    while (remaining > 1e-9 && queue.length > 0) {
      const lot = queue[0]
      const take = Math.min(lot.qty, remaining)
      trades.push({
        key: `${lot.ts}-${fill.id}-${trades.length}`,
        symbol: fill.symbol,
        entryTs: lot.ts,
        exitTs: fill.ts,
        entry: lot.entry,
        exit: fill.price,
        qty: take,
        pnl:
          typeof fill.pnl === 'number'
            ? fill.pnl * (matched > 0 ? take / matched : 1)
            : (fill.price - lot.entry) * take,
        strategy: fill.strategy ?? lot.strategy,
        indicators: lot.indicators.length > 0 ? lot.indicators : (fill.indicators ?? []),
        entryNote: lot.note,
        exitNote: fill.reason,
        open: false,
      })
      lot.qty -= take
      remaining -= take
      if (lot.qty <= 1e-9) queue.shift()
    }

    lots.set(fill.symbol, queue)

    // The opening fill can have aged out of the retained history; the close is
    // still a real fill, so show it rather than dropping the trade.
    if (remaining > 1e-9) {
      trades.push({
        key: fill.id,
        symbol: fill.symbol,
        entryTs: fill.ts,
        exitTs: fill.ts,
        entry: fill.price,
        exit: fill.price,
        qty: remaining,
        pnl: typeof fill.pnl === 'number' ? fill.pnl : 0,
        strategy: fill.strategy,
        indicators: fill.indicators ?? [],
        entryNote: 'Opening fill is older than the retained history',
        exitNote: fill.reason,
        open: false,
      })
    }
  }

  for (const [symbol, queue] of lots) {
    for (const lot of queue) {
      const last = priceOf(symbol) ?? lot.entry
      trades.push({
        key: `open-${symbol}-${lot.ts}`,
        symbol,
        entryTs: lot.ts,
        entry: lot.entry,
        qty: lot.qty,
        pnl: (last - lot.entry) * lot.qty,
        strategy: lot.strategy,
        indicators: lot.indicators,
        entryNote: lot.note,
        open: true,
      })
    }
  }

  return trades.sort(
    (a, b) => Number(b.open) - Number(a.open) || b.entryTs - a.entryTs,
  )
}

function strategyName(id?: string): string | undefined {
  return STRATEGIES.find((s) => s.id === id)?.name
}

function dpFor(value: number): number {
  return value < 10 ? 4 : 2
}

export default function TradeLog({ fills, priceOf, onSelect }: Props) {
  const trades = buildTrades(fills, priceOf)
  const closed = trades.filter((t) => !t.open)
  const open = trades.filter((t) => t.open)
  const realized = closed.reduce((sum, t) => sum + t.pnl, 0)
  const wins = closed.filter((t) => t.pnl > 0)
  const losses = closed.filter((t) => t.pnl < 0)
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : null
  const average = (rows: Trade[]) =>
    rows.length > 0 ? rows.reduce((sum, t) => sum + t.pnl, 0) / rows.length : null
  const avgWin = average(wins)
  const avgLoss = average(losses)

  // Per-strategy record across every closed trade in the log, so the desk can
  // see which model is actually earning rather than judging by the last fill.
  const board = [
    ...STRATEGIES.map((s) => ({ key: s.id as string, name: s.name })),
    { key: 'manual', name: 'Manual ticket' },
  ]
    .map((entry) => {
      const rows = closed.filter((t) =>
        entry.key === 'manual'
          ? !t.strategy || !strategyName(t.strategy)
          : t.strategy === entry.key,
      )
      const rowWins = rows.filter((t) => t.pnl > 0).length
      return {
        ...entry,
        trades: rows.length,
        winRate: rows.length > 0 ? (rowWins / rows.length) * 100 : null,
        pnl: rows.reduce((sum, t) => sum + t.pnl, 0),
      }
    })
    .filter((row) => row.trades > 0)
    .sort((a, b) => b.pnl - a.pnl)

  return (
    <section className="panel tradelog">
      <header className="panel__head">
        <h2>Trade log</h2>
        <span className="panel__meta">
          {closed.length} closed · {open.length} open
        </span>
      </header>

      <div className="tradelog__stats">
        <div>
          <span>Realised</span>
          <strong className={realized >= 0 ? 'up' : 'down'}>{signedMoney(realized)}</strong>
        </div>
        <div>
          <span>Win rate</span>
          <strong>{winRate === null ? '—' : `${winRate.toFixed(0)}%`}</strong>
        </div>
        <div>
          <span>Avg win</span>
          <strong className={avgWin === null ? '' : 'up'}>
            {avgWin === null ? '—' : signedMoney(avgWin)}
          </strong>
        </div>
        <div>
          <span>Avg loss</span>
          <strong className={avgLoss === null ? '' : 'down'}>
            {avgLoss === null ? '—' : signedMoney(avgLoss)}
          </strong>
        </div>
      </div>

      {board.length > 0 && (
        <div className="tradelog__board">
          <div className="tradelog__board-head">
            <span>Strategy</span>
            <span>Trades</span>
            <span>Win rate</span>
            <span>Realised</span>
          </div>
          {board.map((row) => (
            <div className="tradelog__board-row" key={row.key}>
              <span className={`trade__badge ${row.key === 'manual' ? 'trade__badge--manual' : ''}`}>
                {row.name}
              </span>
              <span className="tradelog__board-num">{row.trades}</span>
              <span className="tradelog__board-num">
                {row.winRate === null ? '—' : `${row.winRate.toFixed(0)}%`}
              </span>
              <span className={`tradelog__board-num ${row.pnl >= 0 ? 'up' : 'down'}`}>
                {signedMoney(row.pnl)}
              </span>
            </div>
          ))}
        </div>
      )}

      {trades.length === 0 ? (
        <p className="empty tradelog__empty">
          Every trade you take and every trade the bot takes is logged here with the strategy and
          the indicators it read.
        </p>
      ) : (
        <ul className="tradelog__list">
          {trades.slice(0, 60).map((trade) => {
            const pct = (trade.pnl / Math.max(trade.entry * trade.qty, 1e-9)) * 100
            const name = strategyName(trade.strategy)
            return (
              <li key={trade.key}>
                <button className="trade__row" onClick={() => onSelect(trade.symbol)}>
                  <span className="trade__top">
                    <span className="trade__sym">{trade.symbol}</span>
                    <span className={`trade__state ${trade.open ? 'is-open' : ''}`}>
                      {trade.open ? 'open' : 'closed'}
                    </span>
                    <span className="trade__qty">{units(trade.qty)} units</span>
                    <span className={`trade__pnl ${trade.pnl >= 0 ? 'up' : 'down'}`}>
                      {signedMoney(trade.pnl)} · {signedPct(pct)}
                    </span>
                  </span>

                  <span className="trade__path">
                    {price(trade.entry, dpFor(trade.entry))}
                    {' → '}
                    {trade.open ? 'mark' : price(trade.exit ?? trade.entry, dpFor(trade.exit ?? trade.entry))}
                    <span className="trade__times">
                      {clockTime(trade.entryTs)}
                      {trade.exitTs ? ` → ${clockTime(trade.exitTs)}` : ''}
                    </span>
                  </span>

                  <span className="trade__strategy">
                    <span className={`trade__badge ${name ? '' : 'trade__badge--manual'}`}>
                      {name ?? 'Manual ticket'}
                    </span>
                    {trade.indicators.map((reading) => (
                      <span className="trade__chip" key={reading.label}>
                        {reading.label}
                        <b>{reading.value}</b>
                      </span>
                    ))}
                  </span>

                  <span className="trade__note">
                    {trade.entryNote}
                    {trade.exitNote ? ` · exit: ${trade.exitNote}` : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <p className="trade__foot">
        Indicators are the readings captured when the setup fired, so each trade keeps the strategy
        it was taken on even after the bot is re-armed. The log keeps the last 1,200 fills, so closed
        trades survive a reload.
      </p>
    </section>
  )
}
