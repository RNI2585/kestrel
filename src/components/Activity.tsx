import { clockTime, price, units } from '../format'
import type { Fill } from '../trade'

export default function Activity({ fills, onSelect }: { fills: Fill[]; onSelect: (symbol: string) => void }) {
  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Activity</h2>
        <span className="panel__meta">{fills.length ? `${fills.length} fills` : 'No fills yet'}</span>
      </header>

      {fills.length === 0 ? (
        <p className="empty">Fills from your orders and the bot show up here.</p>
      ) : (
        <ul className="activity">
          {fills.slice(0, 40).map((fill) => (
            <li key={fill.id}>
              <button className="activity__row" onClick={() => onSelect(fill.symbol)}>
                <div className="activity__top">
                  <span className="activity__time">{clockTime(fill.ts)}</span>
                  <span className={`tag tag--${fill.side}`}>{fill.side}</span>
                  <span className="activity__sym">{fill.symbol}</span>
                  <span className="activity__qty">
                    {units(fill.qty)} @ {price(fill.price, fill.price < 10 ? 4 : 2)}
                  </span>
                  <span className={`activity__src activity__src--${fill.source}`}>
                    {fill.source === 'bot' ? 'bot' : 'me'}
                  </span>
                </div>
                <div className="activity__reason">
                  {fill.reason}
                  {typeof fill.pnl === 'number' && (
                    <span className={fill.pnl >= 0 ? 'up' : 'down'}>
                      {' '}
                      · {fill.pnl >= 0 ? '+' : '−'}
                      {Math.abs(fill.pnl).toFixed(2)} realised
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
