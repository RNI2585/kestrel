import { useMemo, useState } from 'react'
import {
  DEFAULT_RISK,
  STRATEGIES,
  type BotConfig,
  type StrategyId,
} from '../bot'
import { ASSET_CLASSES, CLASS_COLOR, type AssetClass, type Instrument } from '../market'
import { price as fmtPrice, signedPct } from '../format'
import { scanMarkets } from '../scan'

interface Props {
  instruments: Instrument[]
  bot: BotConfig
  /** Changes on every market tick so the scan refreshes with the tape. */
  tick: number
  onOpen: (symbol: string) => void
  /** Hands a strategy to the bot, so the scan's top pick can be traded. */
  onStrategy: (id: StrategyId) => void
}

const ARROWS: Record<-1 | 0 | 1, string> = { 1: '▲', 0: '·', [-1]: '▼' }

type Tally = { long: number; short: number; flat: number }

export default function ScanPanel({ instruments, bot, tick, onOpen, onStrategy }: Props) {
  const [filter, setFilter] = useState<AssetClass | 'All'>('All')

  const rows = useMemo(
    () => scanMarkets(instruments, bot, filter),
    // tick keeps the ranking in step with the live prices
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instruments, bot, filter, tick],
  )

  const tallies = useMemo(() => {
    const map = {} as Record<StrategyId, Tally>
    for (const s of STRATEGIES) map[s.id] = { long: 0, short: 0, flat: 0 }
    for (const row of rows) {
      for (const vote of row.votes) {
        const tally = map[vote.strategy]
        if (vote.dir > 0) tally.long += 1
        else if (vote.dir < 0) tally.short += 1
        else tally.flat += 1
      }
    }
    return map
  }, [rows])

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
        ticket.
      </p>

      <section className="book" aria-labelledby="strategy-book-title">
        <div className="book__head">
          <div>
            <h2 id="strategy-book-title">Strategy book</h2>
            <p>
              Every model scores the markets it covers above · arm one to hand it to the bot.
            </p>
          </div>
          <span className="book__armed">Running {armed}</span>
        </div>

        <div className="book__grid">
          {STRATEGIES.map((strategy, i) => {
            const tally = tallies[strategy.id]
            const risk = { ...DEFAULT_RISK[strategy.id], ...(bot.riskPrefs[strategy.id] ?? {}) }
            const isArmed = bot.strategy === strategy.id
            return (
              <article
                key={strategy.id}
                className={isArmed ? 'strategy is-armed' : 'strategy'}
              >
                <div className="strategy__top">
                  <span className="strategy__idx">{String(i + 1).padStart(2, '0')}</span>
                  <span className="strategy__tag">{isArmed ? 'Armed' : strategy.id}</span>
                </div>
                <h3 className="strategy__name">{strategy.name}</h3>
                <p className="strategy__blurb">{strategy.blurb}</p>
                <div className="strategy__tape" aria-label={`Signals on this filter: ${tally.long} long, ${tally.short} short, ${tally.flat} flat`}>
                  <span className="up">{tally.long}↑</span>
                  <span className="down">{tally.short}↓</span>
                  <span className="strategy__flat">{tally.flat}·</span>
                </div>
                <div className="strategy__foot">
                  <span className="strategy__risk">
                    {risk.riskPct}% risk · {risk.stopLossPct}% stop · {risk.takeProfitPct}% target
                  </span>
                  <button
                    className={isArmed ? 'mini-btn mini-btn--on' : 'mini-btn'}
                    onClick={() => onStrategy(strategy.id)}
                    disabled={isArmed}
                    aria-pressed={isArmed}
                  >
                    {isArmed ? 'Armed' : 'Arm'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
