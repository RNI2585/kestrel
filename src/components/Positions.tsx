import { money, signedPct, units } from '../format'
import type { Instrument } from '../market'
import type { Holding } from '../trade'

interface Props {
  rows: { instrument: Instrument; holding: Holding; value: number }[]
  onSelect: (symbol: string) => void
}

export default function Positions({ rows, onSelect }: Props) {
  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Positions</h2>
        <span className="panel__meta">{rows.length ? `${rows.length} open` : 'None open'}</span>
      </header>

      {rows.length === 0 ? (
        <p className="empty">Buy something from the order ticket, or let the bot open its first trade.</p>
      ) : (
        <ul className="positions">
          {rows.map(({ instrument, holding, value }) => {
            const pnlPct = ((instrument.price - holding.avgCost) / holding.avgCost) * 100
            return (
              <li key={instrument.symbol}>
                <button className="positions__row" onClick={() => onSelect(instrument.symbol)}>
                  <span className="positions__sym">
                    {instrument.symbol}
                    <span className="positions__units">{units(holding.qty)} units</span>
                  </span>
                  <span className="positions__value">{money(value)}</span>
                  <span className={`positions__pct ${pnlPct >= 0 ? 'up' : 'down'}`}>
                    {signedPct(pnlPct)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
