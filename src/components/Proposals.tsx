import { clockTime, price as fmtPrice, units } from '../format'
import type { Proposal } from '../settings'

interface Props {
  proposals: Proposal[]
  onApprove: (id: string) => void
  onSkip: (id: string) => void
}

const STATUS_LABEL: Record<Proposal['status'], string> = {
  pending: 'Waiting',
  approved: 'Approved',
  skipped: 'Skipped',
  expired: 'Stale',
}

/**
 * The bot's inbox. With approval on, nothing is booked until the trader accepts
 * a proposal, and a setup whose price has moved too far is retired as stale.
 */
export default function Proposals({ proposals, onApprove, onSkip }: Props) {
  const pending = proposals.filter((p) => p.status === 'pending')
  const decided = proposals.filter((p) => p.status !== 'pending').slice(0, 6)

  return (
    <section className="panel proposals">
      <header className="panel__head">
        <h2>Trade proposals</h2>
        <span className={`status ${pending.length > 0 ? 'status--on' : ''}`}>
          <i aria-hidden="true" />
          {pending.length > 0 ? `${pending.length} waiting` : 'Nothing waiting'}
        </span>
      </header>

      {pending.length === 0 ? (
        <p className="hint">
          {decided.length > 0
            ? 'No proposals waiting. The bot adds one here each time a signal fires.'
            : 'Start the bot and it will propose trades here for you to approve or skip.'}
        </p>
      ) : (
        <ul className="proposals__list">
          {pending.map((proposal) => (
            <li key={proposal.id} className="proposal">
              <div className="proposal__top">
                <span className="proposal__sym">{proposal.symbol}</span>
                <span className={`proposal__side proposal__side--${proposal.side}`}>
                  {proposal.side === 'buy' ? 'Buy' : 'Sell'}
                </span>
                <span className="proposal__size">
                  {units(proposal.qty)} @ {fmtPrice(proposal.price, 2)}
                </span>
                <span className="proposal__age">{clockTime(proposal.ts)}</span>
              </div>
              <p className="proposal__reason">{proposal.reason}</p>
              <div className="proposal__actions">
                <button
                  className={`mini-btn mini-btn--go`}
                  onClick={() => onApprove(proposal.id)}
                >
                  Approve
                </button>
                <button className="mini-btn" onClick={() => onSkip(proposal.id)}>
                  Skip
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {decided.length > 0 && (
        <ul className="proposals__decided">
          {decided.map((proposal) => (
            <li key={proposal.id}>
              <span className={`proposal__tag proposal__tag--${proposal.status}`}>
                {STATUS_LABEL[proposal.status]}
              </span>
              <span className="proposal__decided-sym">
                {proposal.side === 'buy' ? 'Buy' : 'Sell'} {proposal.symbol}
              </span>
              <span className="proposal__decided-note">{proposal.note ?? proposal.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
