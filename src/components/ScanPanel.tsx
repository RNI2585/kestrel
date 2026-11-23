import { useMemo, useState } from 'react'
import { STRATEGIES, type BotConfig } from '../bot'
import { ASSET_CLASSES, CLASS_COLOR, type AssetClass, type Instrument } from '../market'
import { price as fmtPrice, signedPct } from '../format'
import { scanMarkets } from '../scan'

interface Props {
  instruments: Instrument[]
  bot: BotConfig
  /** Changes on every market tick so the scan refreshes with the tape. */
  tick: number
  onOpen: (symbol: string) => void
}

const ARROWS: Record<-1 | 0 | 1, string> = { 1: '▲', 0: '·', [-1]: '▼' }

export default function ScanPanel({ instruments, bot, tick, onOpen }: Props) {
  const [filter, setFilter] = useState<AssetClass | 'All'>('All')

  const rows = useMemo(
    () => scanMarkets(instruments, bot, filter),
    // tick keeps the ranking in step with the live prices
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instruments, bot, filter, tick],
  )

  const bullish = rows.filter((r) => r.bias === 'Bullish').length
  const bearish = rows.filter((r) => r.bias === 'Bearish').length
  const armed = STRATEGIES.find((s) => s.id === bot.strategy)?.name ?? bot.strategy

  return (
    <div className="view">
      <div className="view__head">
        <div>
          <h1 className="view__title">Market scan</h1>
          <p className="view__sub">
            Every market ranked by how many strategies agree — the bot trades {armed}.
          </p>
        </div>
        <span className="view__meta">
          {bullish} bullish · {bearish} bearish
        </span>
      </div>

      <div className="scan__filters" role="group" aria-label="Filter markets by asset class">
        {(['All', ...ASSET_CLASSES] as const).map((cls) => (
          <button
            key={cls}
            className={filter === cls ? 'scan__filter is-active' : 'scan__filter'}
            aria-pressed={filter === cls}
            onClick={() => setFilter(cls)}
          >
            {cls}
          </button>
        ))}
      </div>

      <div className="scan">
        <div className="scan__head" aria-hidden="true">
          <span>Market</span>
          <span>Price</span>
          <span>Consensus</span>
          <span>Score</span>
          <span className="scan__votes-head">Strategy votes</span>
        </div>

        {rows.map((row) => {
          const { instrument } = row
          return (
            <button
              key={instrument.symbol}
              className="scan__row"
              onClick={() => onOpen(instrument.symbol)}
              title={`Open ${instrument.symbol} on the trade screen`}
            >
              <span className="scan__id">
                <span className="dot" style={{ background: CLASS_COLOR[instrument.cls] }} />
                <span className="scan__sym">{instrument.symbol}</span>
                <span className="scan__name">{instrument.name}</span>
              </span>

              <span className="scan__price">
                {fmtPrice(instrument.price, instrument.dp)}
                <em className={row.change >= 0 ? 'up' : 'down'}>{signedPct(row.change)}</em>
              </span>

              <span className="scan__bias-wrap">
                <span className={`scan__bias scan__bias--${row.bias.toLowerCase()}`}>
                  {row.bias}
                </span>
                <span className="scan__regime">{row.regime}</span>
              </span>

              <span className="scan__score-wrap">
                <span className="scan__score-num">{row.score}</span>
                <span className="scan__bar">
                  <i
                    style={{
                      width: `${row.score}%`,
                      background:
                        row.score > 55
                          ? 'var(--up)'
                          : row.score < 45
                            ? 'var(--down)'
                            : 'var(--faint)',
                    }}
                  />
                </span>
                <span className="scan__votes-sub">
                  {row.bulls}↑ {row.bears}↓ · {row.atrPct.toFixed(2)}% noise
                </span>
              </span>

              <span className="scan__votes">
                {row.votes.map((vote) => (
                  <span
                    key={vote.strategy}
                    className={`scan__vote scan__vote--${vote.dir === 1 ? 'up' : vote.dir === -1 ? 'down' : 'flat'}`}
                    title={`${vote.name}: ${vote.note}`}
                  >
                    {ARROWS[vote.dir]}
                  </span>
                ))}
              </span>
            </button>
          )
        })}
      </div>

      <p className="scan__legend">
        Score is the share of the strategies in scope pointing the same way, from 0 (all bearish)
        to 100 (all bullish). The pip model only covers FX and crypto. Hover or long-press a vote
        for the strategy's reason. Tap a row to open it on the trade screen with its chart and
        ticket. Arm a model and tune it in the Strategies tab.
      </p>
    </div>
  )
}
