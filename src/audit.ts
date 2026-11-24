/**
 * The desk log: why the bot did or did not act. Fills are already recorded,
 * but the reasoning around them — a limit that tripped, a market that was
 * shut, a quote that had gone stale — used to be thrown away, which made a
 * quiet session indistinguishable from a broken one.
 */

export type AuditKind =
  | 'trade'
  | 'block'
  | 'streak'
  | 'graduation'
  | 'session'
  | 'stale'
  | 'feed'
  | 'order'
  | 'halt'
  | 'resume'

export interface AuditEvent {
  id: string
  ts: number
  kind: AuditKind
  /** Instrument or model the event is about, when there is one. */
  subject?: string
  detail: string
}

export const AUDIT_LIMIT = 400

let counter = 0

function nextId(): string {
  counter = (counter + 1) % 1_000_000
  return `aud-${Date.now().toString(36)}-${counter.toString(36)}`
}

/** Prepends an event and trims the log; the newest first is what the UI wants. */
export function pushAudit(
  prev: AuditEvent[],
  event: Omit<AuditEvent, 'id' | 'ts'> & { ts?: number },
): AuditEvent[] {
  const next: AuditEvent = {
    id: nextId(),
    ts: event.ts ?? Date.now(),
    kind: event.kind,
    subject: event.subject,
    detail: event.detail,
  }
  return [next, ...prev].slice(0, AUDIT_LIMIT)
}

/** Repeats of the same condition inside this window are collapsed into one. */
export const AUDIT_DEDUPE_MS = 120_000

/**
 * Adds `event` unless the same thing — same kind, subject and wording — was
 * already logged recently, so a limit that stays breached (or a market that
 * stays shut) does not fill the log on every scan.
 */
export function noteOnce(
  prev: AuditEvent[],
  event: Omit<AuditEvent, 'id' | 'ts'> & { ts?: number },
): AuditEvent[] {
  const ts = event.ts ?? Date.now()
  const duplicate = prev.some(
    (seen) =>
      seen.kind === event.kind &&
      seen.subject === event.subject &&
      seen.detail === event.detail &&
      ts - seen.ts < AUDIT_DEDUPE_MS,
  )
  if (duplicate) return prev
  return pushAudit(prev, { ...event, ts })
}

/** Events from one local day, newest first, for the session view. */
export function today(events: AuditEvent[], now: number = Date.now()): AuditEvent[] {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return events.filter((e) => e.ts >= start.getTime())
}
