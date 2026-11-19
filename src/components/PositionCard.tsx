import { money, price } from '../format'
import type { Holding } from '../trade'
import type { Instrument } from '../market'

interface Props {
  instrument: Instrument
  holding?: Holding
  onClose: () => void
}

export default function PositionCard({ instrument, holding, onClose }: Props) {
  const qty = holding?.qty ?? 0
  const value = qty * instrument.price
  const cost = qty * (holding?.avgCost ?? 0)
  const pnl = value - cost
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0

  return (
    <section className="card">
      <header className="card__head">
        <h3>Your position</h3>
        <span className="panel__meta">{instrument.symbol}</span>
      </header>

      {qty <= 0 ? (
        <p className="empty">
          No position in {instrument.symbol}. The bot may open one when its signal lines up.
        </p>
      ) : (
        <>
          <dl className="kv kv--tight">
            <div>
              <dt>Units</dt>
              <dd>{qty.toLocaleString('en-US', { maximumFractionDigits: 4 })}</dd>
            </div>
            <div>
              <dt>Average cost</dt>
              <dd>{price(holding?.avgCost ?? 0, instrument.dp)}</dd>
            </div>
            <div>
              <dt>Market value</dt>
              <dd>{money(value)}</dd>
            </div>
            <div>
              <dt>Open P&amp;L</dt>
              <dd className={pnl >= 0 ? 'up' : 'down'}>
                {pnl >= 0 ? '+' : '−'}
                {money(Math.abs(pnl))} · {pnl >= 0 ? '+' : '−'}
                {Math.abs(pnlPct).toFixed(2)}%
              </dd>
            </div>
          </dl>
          <button className="ghost-btn" onClick={onClose}>
            Close position at market
          </button>
        </>
      )}
    </section>
  )
}
