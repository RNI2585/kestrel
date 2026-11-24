import { useMemo } from 'react'
import type { AssetClass } from '../market'
import { money } from '../format'
import { currencyExposure, portfolioRisk } from '../portfolioRisk'

export interface RiskPanelRow {
  symbol: string
  cls: AssetClass
  value: number
  qty: number
  price: number
}

/**
 * The book as a whole: how much is working, how concentrated it is, which
 * theme would hurt most on a shock, and what the currency mix is once FX pairs
 * are netted. The governor limits one trade; this is what all of them add up
 * to.
 */
export default function RiskPanel({
  rows,
  equity,
  quotes,
}: {
  rows: RiskPanelRow[]
  equity: number
  quotes: Record<string, number>
}) {
  const risk = useMemo(() => portfolioRisk(rows, equity), [rows, equity])
  const mix = useMemo(() => currencyExposure(rows, quotes), [rows, quotes])
  const biggestClusterShare = risk.clusters[0]?.pct ?? 0

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Portfolio risk</h2>
        <span className="panel__meta">
          {rows.length} position{rows.length === 1 ? '' : 's'} · gross{' '}
          {risk.grossPct.toFixed(0)}% of equity
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="empty">
          No open positions, so there is nothing to concentrate. Exposure appears here as soon as
          the desk holds something.
        </p>
      ) : (
        <>
          <dl className="analytics__headline">
            <div>
              <dt>Gross exposure</dt>
              <dd>{money(risk.gross)}</dd>
            </div>
            <div>
              <dt>Largest</dt>
              <dd>
                {risk.largest?.symbol} {risk.largest ? risk.largest.pct.toFixed(0) : '0'}%
              </dd>
            </div>
            <div>
              <dt>Top three</dt>
              <dd>{risk.top3Pct.toFixed(0)}%</dd>
            </div>
            <div>
              <dt>Concentration</dt>
              <dd className={risk.hhi > 0.25 ? 'down' : 'up'}>
                {risk.hhi > 0.25 ? 'High' : 'Balanced'} · {risk.hhi.toFixed(2)}
              </dd>
            </div>
          </dl>

          <ul className="clusters">
            {risk.clusters.map((cluster) => (
              <li key={cluster.id} className="cluster">
                <div className="cluster__head">
                  <span className="cluster__name">{cluster.name}</span>
                  <span className="cluster__value">
                    {money(cluster.value)} · {cluster.pct.toFixed(0)}% of equity
                  </span>
                </div>
                <div className="cluster__bar" aria-hidden="true">
                  <i style={{ width: `${Math.max(2, Math.min(100, cluster.pct))}%` }} />
                </div>
                <span className="cluster__shock">
                  a {risk.shockPct}% move costs {money(cluster.shockLoss)}
                </span>
              </li>
            ))}
          </ul>

          <p className="hint">
            {biggestClusterShare > 0
              ? `The book leans on ${risk.worst?.name ?? 'one group'} at ${biggestClusterShare.toFixed(
                  0,
                )}% of equity — a single shock there hits every position in it at once.`
              : 'No cluster carries the book yet.'}
          </p>

          <div className="riskpanel__currency">
            <span className="riskpanel__currency-head">Currency exposure, in USD</span>
            <ul className="mix">
              {mix.map((entry) => (
                <li key={entry.code}>
                  <span className="mix__code">{entry.code}</span>
                  <span className={`mix__value ${entry.value >= 0 ? 'up' : 'down'}`}>
                    {entry.value >= 0 ? '+' : '−'}
                    {money(Math.abs(entry.value))}
                  </span>
                  <span className="mix__pct">{entry.pct.toFixed(0)}%</span>
                </li>
              ))}
            </ul>
            <p className="hint">
              Everything else on this desk settles in dollars, so only FX pairs move this mix. A
              long EUR/USD is long euro and short dollars — not a hedge against anything else you
              hold.
            </p>
          </div>
        </>
      )}
    </section>
  )
}
