import { useEffect, useState } from 'react'
import { FEE, type Holding, type OrderType, type Side } from '../trade'
import type { Instrument } from '../market'
import { defineBroker, paperConnection, venueSymbol, type BrokerConnection } from '../brokers'
import { money, price } from '../format'
import { quoteStale } from '../session'

interface Props {
  instrument: Instrument
  cash: number
  holding?: Holding
  connections: BrokerConnection[]
  activeBrokerId: string
  maxQuoteAgeSec: number
  /** The routed venue is the one saved for this instrument's asset class. */
  remembered: boolean
  onRoute: (id: string) => void
  onSubmit: (
    side: Side,
    qty: number,
    type: OrderType,
    limit: number,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
}

export default function TradeTicket({
  instrument,
  cash,
  holding,
  connections,
  activeBrokerId,
  maxQuoteAgeSec,
  remembered,
  onRoute,
  onSubmit,
}: Props) {
  const [side, setSide] = useState<Side>('buy')
  const [type, setType] = useState<OrderType>('market')
  const [qtyText, setQtyText] = useState('')
  const [limitText, setLimitText] = useState(() => instrument.price.toFixed(instrument.dp))
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    setError('')
  }, [side, type])

  const activeConn =
    connections.find((c) => c.id === activeBrokerId) ?? connections[0] ?? paperConnection()
  const activeDef = defineBroker(activeConn.kind)
  const activePair = activeConn.kind === 'paper' ? instrument.symbol : venueSymbol(activeConn.kind, instrument.symbol)
  const blocked = Boolean(activeConn.kind !== 'paper' && !activePair)
  const quoteCurrent =
    instrument.live && !quoteStale(instrument, Date.now(), maxQuoteAgeSec * 1000)
  const quoteBlocked =
    type === 'market' && activeConn.kind !== 'paper' && !quoteCurrent

  const qty = Number(qtyText)
  const validQty = Number.isFinite(qty) && qty > 0 ? qty : 0
  const limit = Number(limitText)
  const validLimit = Number.isFinite(limit) && limit > 0 ? limit : 0
  const fillPrice = type === 'limit' && validLimit ? validLimit : instrument.price
  const notional = validQty * fillPrice
  const fee = notional * FEE
  const buyingPower = Math.max(0, cash / (fillPrice * (1 + FEE)))
  const available = side === 'buy' ? buyingPower : (holding?.qty ?? 0)

  const setFraction = (fraction: number) => {
    const amount = available * fraction
    setQtyText(amount > 0 ? amount.toFixed(amount >= 1 ? 4 : 6).replace(/0+$/, '').replace(/\.$/, '') : '')
    setError('')
  }

  const submit = async () => {
    if (blocked) {
      setError(`${activeConn.label} does not list ${instrument.symbol}. Pick another venue.`)
      return
    }
    if (!validQty) {
      setError('Enter a quantity above zero.')
      return
    }
    if (type === 'limit' && !validLimit) {
      setError('Enter a limit price above zero.')
      return
    }
    setPending(true)
    const result = await onSubmit(side, validQty, type, validLimit)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setQtyText('')
    setError('')
  }

  const qtyLabel = validQty ? validQty.toLocaleString('en-US', { maximumFractionDigits: 4 }) : ''
  const actionLabel = pending
    ? 'Sending…'
    : type === 'limit'
      ? `${side === 'buy' ? 'Buy' : 'Sell'} ${qtyLabel} ${instrument.symbol} at limit`
      : `${side === 'buy' ? 'Buy' : 'Sell'} ${qtyLabel} ${instrument.symbol}`

  return (
    <section className="card">
      <header className="card__head">
        <h3>Order ticket</h3>
        <span className="panel__meta">{instrument.symbol}</span>
      </header>

      <div className="side-toggle" role="group" aria-label="Order side">
        <button
          className={side === 'buy' ? 'side-toggle__btn side-toggle__btn--buy is-active' : 'side-toggle__btn'}
          aria-pressed={side === 'buy'}
          onClick={() => setSide('buy')}
        >
          Buy
        </button>
        <button
          className={side === 'sell' ? 'side-toggle__btn side-toggle__btn--sell is-active' : 'side-toggle__btn'}
          aria-pressed={side === 'sell'}
          onClick={() => setSide('sell')}
        >
          Sell
        </button>
      </div>

      <div className="type-toggle" role="group" aria-label="Order type">
        <button
          className={type === 'market' ? 'type-toggle__btn is-active' : 'type-toggle__btn'}
          aria-pressed={type === 'market'}
          onClick={() => setType('market')}
        >
          Market
        </button>
        <button
          className={type === 'limit' ? 'type-toggle__btn is-active' : 'type-toggle__btn'}
          aria-pressed={type === 'limit'}
          onClick={() => {
            setType('limit')
            setLimitText(instrument.price.toFixed(instrument.dp))
          }}
        >
          Limit
        </button>
      </div>

      <div className="venue" role="group" aria-label="Route orders to">
        <div className="venue__head">
          <span>Route to</span>
          <span>{activeConn.kind === 'paper' ? 'simulated fills' : activeDef.name}</span>
        </div>
        <div className="venue__row">
          {connections.map((conn) => {
            const pair = conn.kind === 'paper' ? instrument.symbol : venueSymbol(conn.kind, instrument.symbol)
            const isActive = conn.id === activeConn.id
            return (
              <button
                key={conn.id}
                className={`venue__btn${isActive ? ' is-active' : ''}`}
                aria-pressed={isActive}
                disabled={!pair}
                title={
                  pair
                    ? `${instrument.symbol} orders go to ${conn.label} as ${pair}`
                    : `${conn.label} does not list ${instrument.symbol}`
                }
                onClick={() => {
                  onRoute(conn.id)
                  setError('')
                }}
              >
                {conn.label}
                <span className="venue__pair">{pair ?? 'not listed'}</span>
              </button>
            )
          })}
        </div>
        {remembered && (
          <p className="venue__note">
            Saved for {instrument.cls} — switching instruments of this class picks {activeConn.label}{' '}
            automatically.
          </p>
        )}
      </div>

      <label className="field">
        <span>Quantity</span>
        <div className="qty-field">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={qtyText}
            onChange={(e) => {
              setQtyText(e.target.value)
              setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            aria-label={`Quantity of ${instrument.symbol}`}
          />
          <span className="qty-field__unit">{instrument.symbol}</span>
        </div>
      </label>

      {type === 'limit' && (
        <label className="field">
          <span>Limit price</span>
          <div className="qty-field">
            <input
              type="text"
              inputMode="decimal"
              value={limitText}
              onChange={(e) => {
                setLimitText(e.target.value)
                setError('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
              aria-label={`Limit price for ${instrument.symbol}`}
            />
            <span className="qty-field__unit">USD</span>
          </div>
        </label>
      )}

      <div className="presets">
        {[
          { label: '10%', fraction: 0.1 },
          { label: '25%', fraction: 0.25 },
          { label: '50%', fraction: 0.5 },
          { label: 'Max', fraction: 1 },
        ].map((preset) => (
          <button key={preset.label} onClick={() => setFraction(preset.fraction)}>
            {preset.label}
          </button>
        ))}
      </div>

      <dl className="kv kv--tight ticket__summary">
        <div>
          <dt>{side === 'buy' ? 'Buying power' : 'Available'}</dt>
          <dd>
            {side === 'buy'
              ? money(available)
              : `${available.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} units`}
          </dd>
        </div>
        <div>
          <dt>{type === 'limit' ? 'Limit notional' : 'Notional'}</dt>
          <dd>{money(notional)}</dd>
        </div>
        <div>
          <dt>Commission</dt>
          <dd>{money(fee)}</dd>
        </div>
        <div>
          <dt>{type === 'limit' ? 'Est. cost at limit' : side === 'buy' ? 'Total cost' : 'Net proceeds'}</dt>
          <dd>{money(side === 'buy' ? notional + fee : Math.max(0, notional - fee))}</dd>
        </div>
      </dl>

      <p className="ticket__hint">
        {type === 'limit'
          ? `Rests until ${instrument.symbol} trades ${side === 'buy' ? 'at or below' : 'at or above'} ${
              validLimit ? price(validLimit, instrument.dp) : '—'
            } · 2 bps commission`
          : `Fill at ${price(instrument.price, instrument.dp)} · 2 basis points commission · ${
              quoteCurrent
                ? `Live · ${instrument.source ?? 'provider'}`
                : instrument.live
                  ? `Stale · ${instrument.source ?? 'provider'}`
                  : 'Simulated quote'
            }`}
      </p>

      <p className="ticket__route">
        {type === 'limit'
          ? 'Limit orders rest in the terminal ledger until they fill; they are not sent to the venue.'
          : activeConn.kind === 'paper'
            ? 'Market fills are simulated locally by the paper ledger.'
            : quoteCurrent
              ? `Market orders are sent to ${activeConn.label}${
                  activePair && activePair !== instrument.symbol ? ` as ${activePair}` : ''
                }.`
              : 'External orders are disabled until this instrument has a fresh live quote.'}
      </p>

      {blocked && (
        <p className="ticket__route ticket__route--warn">
          {activeConn.label} does not list {instrument.symbol}. It trades{' '}
          {activeDef.coverage.replace(/\.$/, '')}. Pick the paper ledger or another venue above.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      <button
        className="submit"
        onClick={() => void submit()}
        disabled={pending || blocked || quoteBlocked}
      >
        {actionLabel}
      </button>
    </section>
  )
}
