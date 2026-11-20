import { useEffect, useRef, useState } from 'react'
import {
  BROKER_DEFS,
  verifyBroker,
  type BrokerConnection,
  type BrokerDef,
  type BrokerGroup,
  type BrokerKind,
} from '../brokers'

interface Props {
  connections: BrokerConnection[]
  activeId: string
  onSave: (conn: BrokerConnection) => void
  onRemove: (id: string) => void
  onRoute: (id: string) => void
}

interface Draft {
  endpoint: string
  key: string
  secret: string
  accountPath: string
  orderPath: string
}

const BLANK: Draft = { endpoint: '', key: '', secret: '', accountPath: '', orderPath: '' }
const GROUPS: BrokerGroup[] = ['Local', 'Stocks', 'Crypto & derivatives', 'Custom']

export default function Brokers({ connections, activeId, onSave, onRemove, onRoute }: Props) {
  const [openKind, setOpenKind] = useState<BrokerKind | null>(null)
  const [form, setForm] = useState<Draft>(BLANK)
  const [busy, setBusy] = useState<BrokerKind | null>(null)
  const [showSecrets, setShowSecrets] = useState(false)
  const formRef = useRef<HTMLDivElement | null>(null)

  // A venue can sit far down the list, so bring its form into view when it opens.
  useEffect(() => {
    if (openKind) formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [openKind])

  const startEdit = (def: BrokerDef) => {
    const existing = connections.find((c) => c.kind === def.kind && c.kind !== 'paper')
    setShowSecrets(false)
    setOpenKind(def.kind)
    setForm(
      existing
        ? {
            endpoint: existing.endpoint,
            key: existing.key,
            secret: existing.secret,
            accountPath: existing.accountPath ?? '',
            orderPath: existing.orderPath ?? '',
          }
        : {
            endpoint: def.defaultEndpoint,
            key: '',
            secret: '',
            accountPath: '',
            orderPath: '',
          },
    )
  }

  const connect = async (def: BrokerDef) => {
    const existing = connections.find((c) => c.kind === def.kind && c.kind !== 'paper')
    const draft: BrokerConnection = {
      id: existing?.id ?? `${def.kind}-${Math.random().toString(36).slice(2, 8)}`,
      kind: def.kind,
      label: def.name,
      endpoint: form.endpoint,
      key: form.key,
      secret: form.secret,
      accountPath: form.accountPath.trim() || undefined,
      orderPath: form.orderPath.trim() || undefined,
      status: 'error',
      message: 'Checking the endpoint…',
    }
    setBusy(def.kind)
    const result = await verifyBroker(draft)
    setBusy(null)
    onSave({ ...draft, ...result, checkedAt: Date.now() })
    if (result.status === 'linked') setOpenKind(null)
  }

  return (
    <section className="card">
      <header className="card__head">
        <h3>Broker connections</h3>
        <span className={`status ${activeId !== 'paper' ? 'status--on' : ''}`}>
          <i aria-hidden="true" />
          {connectLabel(connections, activeId)}
        </span>
      </header>

      <ul className="brokers">
        {GROUPS.map((group) => {
          const defs = BROKER_DEFS.filter((d) => d.group === group)
          if (defs.length === 0) return null
          return (
            <li key={group} className="broker__group">
              <span>{group}</span>
              {defs.map((def) => {
                const conn = connections.find((c) => c.kind === def.kind)
                const isPaper = def.kind === 'paper'
                const isActive = conn ? conn.id === activeId : false
                const editing = openKind === def.kind
                const missing = editing ? missingFields(def, form) : []
                return (
                  <div key={def.kind} className="broker">
                    <div className="broker__top">
                      <span className="broker__name">{def.name}</span>
                      {isPaper ? (
                        <span className="badge badge--on">Local</span>
                      ) : conn ? (
                        <span
                          className={`badge ${conn.status === 'linked' ? 'badge--on' : 'badge--err'}`}
                        >
                          {conn.status === 'linked' ? 'Linked' : 'Error'}
                        </span>
                      ) : (
                        <span className="badge">Not linked</span>
                      )}
                    </div>
                    <p className="broker__blurb">{def.blurb}</p>
                    <p className="broker__pairs">{def.coverage}</p>

                    {conn && conn.message && (
                      <p
                        className={`broker__msg ${conn.status === 'error' ? 'broker__msg--err' : ''}`}
                      >
                        {conn.message}
                      </p>
                    )}

                    {!isPaper && editing && (
                      <div className="broker__form" ref={formRef}>
                        <label className="field">
                          <span>Endpoint</span>
                          <input
                            className="text-input"
                            value={form.endpoint}
                            placeholder={def.defaultEndpoint || 'https://your-bridge.example.com'}
                            onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                          />
                        </label>
                        {def.keyLabel && (
                          <label className="field">
                            <span>{def.keyLabel}</span>
                            <div className="broker__secret">
                              <input
                                className="text-input"
                                type={showSecrets ? 'text' : 'password'}
                                value={form.key}
                                placeholder={def.keyLabel}
                                autoComplete="off"
                                spellCheck={false}
                                onChange={(e) => setForm({ ...form, key: e.target.value })}
                              />
                              <button
                                type="button"
                                className="broker__reveal"
                                onClick={() => setShowSecrets((v) => !v)}
                              >
                                {showSecrets ? 'Hide' : 'Show'}
                              </button>
                            </div>
                          </label>
                        )}
                        {def.secretLabel && (
                          <label className="field">
                            <span>{def.secretLabel}</span>
                            <div className="broker__secret">
                              <input
                                className="text-input"
                                type={showSecrets ? 'text' : 'password'}
                                value={form.secret}
                                placeholder={def.secretLabel}
                                autoComplete="off"
                                spellCheck={false}
                                onChange={(e) => setForm({ ...form, secret: e.target.value })}
                              />
                              <button
                                type="button"
                                className="broker__reveal"
                                onClick={() => setShowSecrets((v) => !v)}
                              >
                                {showSecrets ? 'Hide' : 'Show'}
                              </button>
                            </div>
                          </label>
                        )}
                        {def.secretHint && <p className="broker__note">{def.secretHint}</p>}

                        <details className="broker__advanced">
                          <summary>Endpoint paths</summary>
                          <label className="field">
                            <span>Account path</span>
                            <input
                              className="text-input"
                              value={form.accountPath}
                              placeholder={def.accountPath || '/account'}
                              onChange={(e) => setForm({ ...form, accountPath: e.target.value })}
                            />
                          </label>
                          <label className="field">
                            <span>Order path</span>
                            <input
                              className="text-input"
                              value={form.orderPath}
                              placeholder={def.orderPath || '/orders'}
                              onChange={(e) => setForm({ ...form, orderPath: e.target.value })}
                            />
                          </label>
                          <p className="broker__note">
                            Leave both blank to use {def.accountPath || '—'} and{' '}
                            {def.orderPath || '—'}. Signing is built in this browser; a path you
                            override is signed exactly as typed.
                          </p>
                        </details>

                        <div className="broker__actions">
                          <button
                            className="broker__btn broker__btn--primary"
                            disabled={busy === def.kind || missing.length > 0}
                            title={
                              missing.length > 0
                                ? `Add ${missing.join(', ')} first`
                                : `Verify the account with ${def.name}`
                            }
                            onClick={() => connect(def)}
                          >
                            {busy === def.kind ? 'Checking…' : 'Connect'}
                          </button>
                          <button
                            className="broker__btn broker__btn--quiet"
                            onClick={() => setOpenKind(null)}
                          >
                            Cancel
                          </button>
                        </div>
                        {missing.length > 0 && (
                          <p className="broker__note broker__note--warn">
                            Fill in {missing.join(', ')} to enable Connect.
                          </p>
                        )}
                        <p className="broker__note">
                          GET {form.accountPath.trim() || def.accountPath || '—'} to verify, POST{' '}
                          {form.orderPath.trim() || def.orderPath || '—'} to place an order.
                          {def.docsUrl && (
                            <>
                              {' '}
                              <a
                                className="broker__docs"
                                href={def.docsUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                API docs
                              </a>
                            </>
                          )}
                        </p>
                      </div>
                    )}

                    {!editing && (
                      <div className="broker__actions">
                        {isPaper || conn?.status === 'linked' ? (
                          <button
                            className={`broker__btn ${isActive ? 'broker__btn--on' : 'broker__btn--primary'}`}
                            onClick={() => conn && onRoute(conn.id)}
                          >
                            {isActive ? 'Routing here' : 'Route orders here'}
                          </button>
                        ) : (
                          <button
                            className="broker__btn broker__btn--primary"
                            onClick={() => startEdit(def)}
                          >
                            Connect account
                          </button>
                        )}
                        {!isPaper && conn && (
                          <button className="broker__btn" onClick={() => startEdit(def)}>
                            {conn.status === 'linked' ? 'Edit keys' : 'Fix keys'}
                          </button>
                        )}
                        {!isPaper && conn && (
                          <button
                            className="broker__btn broker__btn--quiet broker__btn--danger"
                            onClick={() => onRemove(conn.id)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </li>
          )
        })}
      </ul>

      <p className="broker__note">
        Keys live in this browser’s storage and are only sent to the endpoint you configure. Use
        trade-only keys with withdrawals disabled, and prefer a proxy in front of any exchange —
        brokers block direct browser calls with CORS. The paper ledger stays the default route;
        manual market orders go to the routed venue before they hit your ledger.
      </p>
    </section>
  )
}

/** Which fields the venue's signing needs before Connect can be tried. */
function missingFields(def: BrokerDef, form: Draft): string[] {
  const missing: string[] = []
  if (!form.endpoint.trim()) missing.push('an endpoint')
  if (def.keyLabel && !form.key.trim()) missing.push(def.keyLabel)
  if (def.secretLabel && !form.secret.trim()) missing.push(def.secretLabel)
  return missing
}

function connectLabel(connections: BrokerConnection[], activeId: string): string {
  const active = connections.find((c) => c.id === activeId)
  if (!active || active.kind === 'paper') return 'Paper ledger'
  return active.label
}
