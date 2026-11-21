import { money } from '../format'
import type { Portfolio } from '../trade'

interface Props {
  portfolio: Portfolio
  equity: number
  unrealized: number
  /** Reset, backup and restore live on the settings screen, not here. */
  onOpenSettings: () => void
}

export default function AccountPanel({ portfolio, equity, unrealized, onOpenSettings }: Props) {
  const pnl = equity - portfolio.deposited
  const pnlPct = (pnl / portfolio.deposited) * 100

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Account</h2>
        <div className="panel__tools">
          <button className="link-btn" onClick={onOpenSettings}>
            Manage
          </button>
        </div>
      </header>

      <div className="equity">
        <span className="equity__label">Equity</span>
        <strong className="equity__value">{money(equity)}</strong>
        <span className={`equity__delta ${pnl >= 0 ? 'up' : 'down'}`}>
          {pnl >= 0 ? '+' : '−'}
          {money(Math.abs(pnl))} · {pnlPct >= 0 ? '+' : '−'}
          {Math.abs(pnlPct).toFixed(2)}% since open
        </span>
      </div>

      <dl className="kv">
        <div>
          <dt>Cash</dt>
          <dd>{money(portfolio.cash)}</dd>
        </div>
        <div>
          <dt>Positions</dt>
          <dd>{money(equity - portfolio.cash)}</dd>
        </div>
        <div>
          <dt>Unrealised</dt>
          <dd className={unrealized >= 0 ? 'up' : 'down'}>
            {unrealized >= 0 ? '+' : '−'}
            {money(Math.abs(unrealized))}
          </dd>
        </div>
        <div>
          <dt>Realised</dt>
          <dd className={portfolio.realized >= 0 ? 'up' : 'down'}>
            {portfolio.realized >= 0 ? '+' : '−'}
            {money(Math.abs(portfolio.realized))}
          </dd>
        </div>
      </dl>
    </section>
  )
}
