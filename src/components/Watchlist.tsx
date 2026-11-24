import { ASSET_CLASSES, changePct, type AssetClass, type Instrument } from '../market'
import { price, signedPct } from '../format'
import Sparkline from './Sparkline'

interface Props {
  instruments: Instrument[]
  selected: string
  filter: AssetClass | 'All'
  onFilter: (value: AssetClass | 'All') => void
  onSelect: (symbol: string) => void
}

export default function Watchlist({ instruments, selected, filter, onFilter, onSelect }: Props) {
  const visible = filter === 'All' ? instruments : instruments.filter((i) => i.cls === filter)
  const groups =
    filter === 'All'
      ? ASSET_CLASSES.map((cls) => ({ cls, items: visible.filter((i) => i.cls === cls) })).filter(
          (g) => g.items.length > 0,
        )
      : [{ cls: filter, items: visible }]

  return (
    <div className="watch">
      <header className="watch__head">
        <h2>Watchlist</h2>
        <span className="panel__meta">
          {visible.filter((i) => i.live).length} live · {visible.length} instruments
        </span>
      </header>

      <div className="pills" role="group" aria-label="Filter by asset class">
        {(['All', ...ASSET_CLASSES] as const).map((cls) => (
          <button
            key={cls}
            className={filter === cls ? 'pill is-active' : 'pill'}
            aria-pressed={filter === cls}
            onClick={() => onFilter(cls)}
          >
            {cls}
          </button>
        ))}
      </div>

      {groups.map((group) => (
        <div key={group.cls} className="watch__group">
          {filter === 'All' && <div className="watch__label">{group.cls}</div>}
          {group.items.map((ins) => {
            const chg = changePct(ins)
            return (
              <button
                key={ins.symbol}
                className={selected === ins.symbol ? 'row is-active' : 'row'}
                onClick={() => onSelect(ins.symbol)}
                aria-current={selected === ins.symbol}
              >
                <span className="row__id">
                  <span className="row__sym">{ins.symbol}</span>
                  <span className="row__name">{ins.name}</span>
                </span>
                <Sparkline data={ins.history.slice(-40)} color={chg >= 0 ? '#00c46a' : '#ff4d5e'} />
                <span className="row__nums">
                  <span className="row__price">{price(ins.price, ins.dp)}</span>
                  <span className={chg >= 0 ? 'row__chg up' : 'row__chg down'}>
                    {chg >= 0 ? '▲' : '▼'} {signedPct(chg)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
