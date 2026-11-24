import { useMemo, useState } from 'react'
import { money } from '../format'
import {
  costSummary,
  parseVenueStatement,
  reconcile,
  type ReconcileRow,
  type ReconcileStatus,
} from '../reconcile'
import type { Fill } from '../trade'

const LABEL: Record<ReconcileStatus, string> = {
  matched: 'Agreed',
  drift: 'Price drift',
  'fee-mismatch': 'Fee gap',
  'missing-at-venue': 'Not at venue',
  'missing-locally': 'Not on desk',
}

/**
 * Costs and reconciliation. The ledger charges a modelled commission on every
 * fill; a venue charges its own, at its own prices. Paste the venue's fills and
 * this lines them up, so a book that quietly disagrees with the broker is
 * visible instead of assumed.
 */
export default function Reconciliation({ fills }: { fills: Fill[] }) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<ReconcileRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const costs = useMemo(() => costSummary(fills), [fills])

  const check = () => {
    const parsed = parseVenueStatement(text)
    if ('error' in parsed) {
      setError(parsed.error)
      setRows(null)
      return
    }
    setError(null)
    setRows(reconcile(fills, parsed.values))
  }

  const mismatches = rows?.filter((row) => row.status !== 'matched').length ?? 0

  return (
    <section className="card">
      <header className="card__head">
        <h3>Costs &amp; reconciliation</h3>
        <span className="badge">{costs.feeBps.toFixed(1)} bps commission</span>
      </header>

      <dl className="kv kv--tight">
        <div>
          <dt>Commission paid</dt>
          <dd>{money(costs.fees)}</dd>
        </div>
        <div>
          <dt>Traded value</dt>
          <dd>{money(costs.notional)}</dd>
        </div>
        <div>
          <dt>Gross result</dt>
          <dd className={costs.grossPnl >= 0 ? 'up' : 'down'}>{money(costs.grossPnl)}</dd>
        </div>
        <div>
          <dt>Net result</dt>
          <dd className={costs.netPnl >= 0 ? 'up' : 'down'}>{money(costs.netPnl)}</dd>
        </div>
      </dl>
      <p className="hint">
        The ledger charges 2 basis points a side, so every fill here has a modelled cost. A venue
        statement carries its own prices and fees; paste it below to see where the book and the
        broker disagree.
      </p>

      <label className="field">
        <span>Venue statement</span>
        <textarea
          className="recon__input"
          rows={5}
          spellCheck={false}
          value={text}
          placeholder={'[{"id":"…","ts":1712345678901,"symbol":"BTC","side":"buy","qty":0.1,"price":64000,"fee":1.28}]'}
          onChange={(event) => {
            setText(event.target.value)
            setRows(null)
            setError(null)
          }}
        />
      </label>

      <div className="recon__actions">
        <button className="mini-btn" disabled={text.trim().length === 0} onClick={check}>
          Reconcile
        </button>
      </div>

      {error && <p className="recon__error">{error}</p>}

      {rows && (
        <>
          <p className="recon__summary">
            {rows.length} line{rows.length === 1 ? '' : 's'} ·{' '}
            <span className={mismatches > 0 ? 'down' : 'up'}>
              {mismatches === 0 ? 'everything agrees' : `${mismatches} disagreement${mismatches === 1 ? '' : 's'}`}
            </span>
          </p>
          <ul className="recon">
            {rows.slice(0, 40).map((row, index) => (
              <li key={`${row.status}-${row.symbol}-${index}`} className={`recon__row is-${row.status}`}>
                <span className="recon__status">{LABEL[row.status]}</span>
                <span className="recon__symbol">
                  {row.symbol} {row.side}
                </span>
                <span className="recon__note">{row.note}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
