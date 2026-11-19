import { clockTime, price, units } from '../format'
import type { WorkingOrder } from '../trade'

interface Props {
  orders: WorkingOrder[]
  onCancel: (id: string) => void
  onSelect: (symbol: string) => void
}

export default function WorkingOrders({ orders, onCancel, onSelect }: Props) {
  const working = orders.filter((o) => o.status === 'working')
  const done = orders.filter((o) => o.status !== 'working').slice(0, 4)

  return (
    <section className="card">
      <header className="card__head">
        <h3>Working orders</h3>
        <span className="panel__meta">{working.length ? `${working.length} resting` : 'None resting'}</span>
      </header>

      {working.length === 0 && done.length === 0 ? (
        <p className="empty">
          Limit orders wait here until the market trades through your price. They survive a reload.
        </p>
      ) : (
        <ul className="orders">
          {working.map((order) => (
            <li key={order.id} className="orders__row">
              <button className="orders__id" onClick={() => onSelect(order.symbol)}>
                <span className={`tag tag--${order.side}`}>{order.side}</span>
                <span className="orders__sym">{order.symbol}</span>
                <span className="orders__detail">
                  {units(order.qty)} @ {price(order.limit, order.limit < 10 ? 4 : 2)}
                </span>
              </button>
              <span className="orders__route">{order.broker}</span>
              <button className="orders__cancel" onClick={() => onCancel(order.id)}>
                Cancel
              </button>
            </li>
          ))}
          {done.map((order) => (
            <li key={order.id} className="orders__row orders__row--done">
              <button className="orders__id" onClick={() => onSelect(order.symbol)}>
                <span className={`tag tag--${order.side}`}>{order.side}</span>
                <span className="orders__sym">{order.symbol}</span>
                <span className="orders__detail">{units(order.qty)}</span>
              </button>
              <span className="orders__route">{clockTime(order.ts)}</span>
              <span className={`orders__state ${order.status === 'filled' ? 'up' : ''}`}>{order.status}</span>
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && working.length > 0 && (
        <p className="ticket__hint">Filled and cancelled orders stay listed until you reset the account.</p>
      )}
    </section>
  )
}
