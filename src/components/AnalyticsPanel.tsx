import { useMemo } from 'react'
import { byStrategy, bySymbol, roundTrips, sharpe, tradeStats, type Stats } from '../analytics'
import { money, signedMoney } from '../format'
import { humanSpan } from '../scheduler'
import type { EquityPoint } from '../timeline'
import type { Fill } from '../trade'

function pct(value: number | null, digits = 1): string {
  return value === null ? '—' : `${value.toFixed(digits)}%`
}

function signed(value: number, format: (n: number) => string): string {
  return `${value >= 0 ? '+' : '−'}${format(Math.abs(value))}`
}

/** A small table of one group's stats, used for symbols and for models. */
function GroupTable({
  title,
  rows,
}: {
  title: string
  rows: { key: string; stats: Stats }[]
}) {
  if (rows.length === 0) return null
  return (
    <div className="analytics__group">
      <h3 className="analytics__subtitle">{title}</h3>
      <table className="analytics__table">
        <thead>
          <tr>
            <th scope="col">Book</th>
            <th scope="col">Trades</th>
            <th scope="col">Win</th>
            <th scope="col">Expectancy</th>
            <th scope="col">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const net = row.stats.expectancy * row.stats.trades
            return (
              <tr key={row.key}>
                <th scope="row">{row.key}</th>
                <td>{row.stats.trades}</td>
                <td>{pct(row.stats.winRate, 0)}</td>
                <td className={row.stats.expectancy >= 0 ? 'up' : 'down'}>
                  {signed(row.stats.expectancy, (n) => money(n))}
                </td>
                <td className={net >= 0 ? 'up' : 'down'}>{signed(net, (n) => money(n))}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * What the closed trades actually did: win rate, expectancy, profit factor and
 * the runs that made up the day, plus a per-symbol and per-model breakdown.
 * Round trips are matched first-in-first-out so a partial exit is counted once.
 */
export default function AnalyticsPanel({
  fills,
  points,
}: {
  fills: Fill[]
  points: EquityPoint[]
}) {
  const trips = useMemo(() => roundTrips(fills), [fills])
  const stats = useMemo(() => tradeStats(trips), [trips])
  const symbols = useMemo(() => bySymbol(trips), [trips])
  const models = useMemo(() => byStrategy(trips), [trips])
  const ratio = useMemo(() => sharpe(points), [points])
  const net = stats.expectancy * stats.trades

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Trade analytics</h2>
        <span className="panel__meta">
          {stats.trades} round trip{stats.trades === 1 ? '' : 's'} · {stats.wins} win
          {stats.wins === 1 ? '' : 's'} · {stats.losses} loss{stats.losses === 1 ? '' : 'es'}
        </span>
      </header>

      {stats.trades === 0 ? (
        <p className="empty">
          Analytics start with the first closed trade. A buy that has not been sold is a position,
          not a result.
        </p>
      ) : (
        <>
          <dl className="analytics__headline">
            <div>
              <dt>Win rate</dt>
              <dd>{pct(stats.winRate, 0)}</dd>
            </div>
            <div>
              <dt>Expectancy</dt>
              <dd className={stats.expectancy >= 0 ? 'up' : 'down'}>
                {signed(stats.expectancy, (n) => money(n))}
              </dd>
            </div>
            <div>
              <dt>Profit factor</dt>
              <dd className={(stats.profitFactor ?? 0) >= 1 ? 'up' : 'down'}>
                {stats.profitFactor === null ? '—' : stats.profitFactor.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt>Net of fees</dt>
              <dd className={net >= 0 ? 'up' : 'down'}>{signed(net, (n) => money(n))}</dd>
            </div>
            <div>
              <dt>Session Sharpe</dt>
              <dd className={(ratio ?? 0) >= 0 ? 'up' : 'down'}>
                {ratio === null ? '—' : ratio.toFixed(2)}
              </dd>
            </div>
          </dl>

          <ul className="analytics__notes">
            <li>
              Best {signedMoney(stats.best)} · worst {signedMoney(stats.worst)} · average win{' '}
              {money(stats.avgWin)} against average loss {money(stats.avgLoss)}
            </li>
            <li>
              Longest run: {stats.maxWinStreak} win{stats.maxWinStreak === 1 ? '' : 's'} in a row,{' '}
              {stats.maxLossStreak} loss{stats.maxLossStreak === 1 ? '' : 'es'} in a row
            </li>
            <li>
              Commission paid {money(stats.fees)} over {stats.trades} round trips · average hold{' '}
              {humanSpan(stats.avgHoldMs)}
            </li>
          </ul>

          <div className="analytics__groups">
            <GroupTable title="By instrument" rows={symbols} />
            <GroupTable title="By model" rows={models} />
          </div>
        </>
      )}

      <p className="hint">
        Session Sharpe is the average return over its standard deviation on this equity curve,
        scaled by the sample count. It is not annualised, so compare sessions with it, not years.
      </p>
    </section>
  )
}
