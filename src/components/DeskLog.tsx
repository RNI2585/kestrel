import { clockTime } from '../format'
import type { AuditEvent, AuditKind } from '../audit'

const LABEL: Record<AuditKind, string> = {
  trade: 'Fill',
  block: 'Limit',
  streak: 'Streak',
  graduation: 'Gate',
  session: 'Closed',
  stale: 'Stale',
  feed: 'Feed',
  order: 'Order',
  halt: 'Halt',
  resume: 'Resume',
}

/**
 * The desk log: every reason the bot passed on a trade, newest first. Without
 * it a quiet session and a broken one look the same.
 */
export default function DeskLog({
  events,
  dayChangePct,
}: {
  events: AuditEvent[]
  dayChangePct: number
}) {
  const recent = events.slice(0, 14)
  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Desk log</h2>
        <span className="panel__meta">
          <span className={dayChangePct >= 0 ? 'up' : 'down'}>
            {dayChangePct >= 0 ? '+' : '−'}
            {Math.abs(dayChangePct).toFixed(2)}% today
          </span>
          {` · ${events.length} event${events.length === 1 ? '' : 's'}`}
        </span>
      </header>

      {recent.length === 0 ? (
        <p className="empty">
          Nothing to report yet. Every skipped signal, closed market and feed problem lands here.
        </p>
      ) : (
        <ul className="desklog">
          {recent.map((event) => (
            <li key={event.id} className={`desklog__row is-${event.kind}`}>
              <span className="desklog__time">{clockTime(event.ts)}</span>
              <span className="desklog__kind">{LABEL[event.kind]}</span>
              <span className="desklog__subject">{event.subject ?? '—'}</span>
              <span className="desklog__detail">{event.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
