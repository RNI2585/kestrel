import { useMemo, useState } from 'react'
import {
  DEFAULT_RISK,
  STRATEGIES,
  STRATEGY_CLASSES,
  activeRisk,
  defaultParams,
  indicatorReadings,
  paramDefs,
  patchRisk,
  tunedParams,
  type BotConfig,
  type StrategyId,
} from '../bot'
import { pipSize, type Instrument } from '../market'
import { scanMarkets } from '../scan'
import type { ExitBook } from '../exits'
import type { Portfolio } from '../trade'
import { money, price as fmtPrice } from '../format'
import { Slider } from './BotPanel'

interface Props {
  bot: BotConfig
  instruments: Instrument[]
  /** The instrument on the desk, whose tape the indicators read. */
  instrument: Instrument
  exits: ExitBook
  portfolio: Portfolio
  /** Changes on every market tick so the readings refresh with the tape. */
  tick: number
  onChange: (patch: Partial<BotConfig>) => void
}

const ARROWS: Record<-1 | 0 | 1, string> = { 1: '▲', 0: '·', [-1]: '▼' }

export default function StrategiesTab({
  bot,
  instruments,
  instrument,
  exits,
  portfolio,
  tick,
  onChange,
}: Props) {
  const [showAll, setShowAll] = useState(false)
  const strategy = STRATEGIES.find((s) => s.id === bot.strategy) ?? STRATEGIES[0]
  const defs = paramDefs(bot.strategy)
  const overrides = bot.params[bot.strategy] ?? {}
  const values = { ...defaultParams(bot.strategy), ...overrides }
  const risk = activeRisk(bot)
  const riskDefaults = DEFAULT_RISK[bot.strategy]
  const riskTuned =
    risk.riskPct !== riskDefaults.riskPct ||
    risk.stopLossPct !== riskDefaults.stopLossPct ||
    risk.takeProfitPct !== riskDefaults.takeProfitPct

  const pip = pipSize(instrument.price, instrument.cls)
  const readings = useMemo(
    () => indicatorReadings(bot.strategy, instrument.history, tunedParams(bot), pip),
    // tick keeps the readings in step with the live prices
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bot, instrument, pip, tick],
  )
  const scan = useMemo(
    () => scanMarkets([instrument], bot, 'All')[0],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instrument, bot, tick],
  )

  const openTrades = Object.entries(portfolio.holdings)
    .map(([symbol, held]) => {
      const ins = instruments.find((i) => i.symbol === symbol)
      return { symbol, held, ins, exit: exits[symbol] }
    })
    .sort((a, b) => (b.ins?.price ?? 0) * b.held.qty - (a.ins?.price ?? 0) * a.held.qty)

  const setParam = (key: string, value: number) => {
    onChange({
      params: { ...bot.params, [bot.strategy]: { ...values, [key]: value } },
    })
  }

  const resetParams = () => {
    const next = { ...bot.params }
    delete next[bot.strategy]
    onChange({ params: next })
  }

  const resetRisk = () => {
    const next = { ...bot.riskPrefs }
    delete next[bot.strategy]
    onChange({ riskPrefs: next })
  }

  return (
    <div className="view">
      <div className="view__head">
        <div>
          <h1 className="view__title">Strategies & indicators</h1>
          <p className="view__sub">
            The whole model book, the armed model’s tuning, and what the tape reads on{' '}
            {instrument.symbol}.
          </p>
        </div>
        <span className="view__meta">
          {strategy.name} armed · {openTrades.length} open
        </span>
      </div>

      <div className="trades-grid">
        <div className="stack">
          <section className="panel">
            <header className="panel__head">
              <h2>{strategy.name}</h2>
              <span className="panel__meta">tuning & exits</span>
            </header>
            <p className="hint">{strategy.blurb}</p>
            {STRATEGY_CLASSES[bot.strategy] && (
              <p className="hint">
                Only trades {STRATEGY_CLASSES[bot.strategy]?.join(' and ')} — the bot skips every
                other asset class while it is armed.
              </p>
            )}

            {defs.map((def) => (
              <Slider
                key={def.key}
                label={def.label}
                value={values[def.key]}
                min={def.min}
                max={def.max}
                step={def.step}
                display={`${values[def.key]}${def.unit ?? ''}`}
                onChange={(v) => setParam(def.key, v)}
              />
            ))}
            {Object.keys(overrides).length > 0 && (
              <button className="link-btn link-btn--block" onClick={resetParams}>
                Reset {strategy.name.toLowerCase()} settings
              </button>
            )}

            <Slider
              label="Risk per trade"
              value={risk.riskPct}
              min={1}
              max={10}
              step={0.5}
              display={`${risk.riskPct}% of equity`}
              onChange={(riskPct) => onChange(patchRisk(bot, { riskPct }))}
            />
            <Slider
              label="Stop loss"
              value={risk.stopLossPct}
              min={1}
              max={10}
              step={0.5}
              display={`${risk.stopLossPct}%`}
              onChange={(stopLossPct) => onChange(patchRisk(bot, { stopLossPct }))}
            />
            <Slider
              label="Take profit"
              value={risk.takeProfitPct}
              min={2}
              max={25}
              step={1}
              display={`${risk.takeProfitPct}%`}
              onChange={(takeProfitPct) => onChange(patchRisk(bot, { takeProfitPct }))}
            />
            <p className="hint">
              The stop and take profit are stamped on a trade once, from the setting that opened it
              — a bot entry on auto, or a proposal you approve. It keeps those levels until it
              closes, so arming a different strategy never moves an open trade’s target.
            </p>
            {riskTuned && (
              <button className="link-btn link-btn--block" onClick={resetRisk}>
                Reset {strategy.name.toLowerCase()} exits to {riskDefaults.riskPct}% /{' '}
                {riskDefaults.stopLossPct}% / {riskDefaults.takeProfitPct}%
              </button>
            )}
          </section>

          <section className="panel">
            <header className="panel__head">
              <h2>Open exits</h2>
              <span className="panel__meta">{openTrades.length} positions</span>
            </header>
            {openTrades.length === 0 ? (
              <p className="hint">No open positions. A trade gets its target the moment it opens.</p>
            ) : (
              <div className="exits">
                {openTrades.map(({ symbol, held, ins, exit }) => {
                  const away = ins && exit ? ((exit.takeProfit / ins.price - 1) * 100) : null
                  return (
                    <div key={symbol} className="exit">
                      <div>
                        <div className="exit__sym">{symbol}</div>
                        <div className="exit__qty">
                          {held.qty.toFixed(2)} @ {fmtPrice(held.avgCost, ins?.dp ?? 2)} ·{' '}
                          {money((ins?.price ?? 0) * held.qty)}
                        </div>
                      </div>
                      <div className="exit__levels">
                        {exit ? (
                          <>
                            <div className="up">
                              TP {fmtPrice(exit.takeProfit, ins?.dp ?? 2)}
                              {away !== null && ` · ${away >= 0 ? '+' : ''}${away.toFixed(2)}%`}
                            </div>
                            <div className="down">SL {fmtPrice(exit.stopLoss, ins?.dp ?? 2)}</div>
                          </>
                        ) : (
                          <div className="exit__qty">signal exit only</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <header className="panel__head">
              <h2>
                {instrument.symbol} indicators
              </h2>
              <span className="panel__meta">
                {scan ? `${scan.regime} · ${scan.atrPct.toFixed(2)}% noise` : 'warming up'}
              </span>
            </header>
            {readings.length === 0 ? (
              <p className="hint">Warming up — not enough ticks yet for {strategy.name}.</p>
            ) : (
              <div className="indicators">
                {readings.map((item) => (
                  <span key={item.label} className="indicator">
                    <span className="indicator__label">{item.label}</span>
                    <span className="indicator__value">{item.value}</span>
                  </span>
                ))}
              </div>
            )}
            {scan && (
              <div className="votes">
                {scan.votes.map((vote) => (
                  <div key={vote.strategy} className="vote">
                    <div>
                      <span className="vote__name">{vote.name}</span>
                      <div className="vote__note">{vote.note}</div>
                    </div>
                    <span
                      className={`vote__dir ${
                        vote.dir === 1 ? 'up' : vote.dir === -1 ? 'down' : 'flat'
                      }`}
                    >
                      {ARROWS[vote.dir]}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="hint">
              Readings come from the armed model on the desk’s instrument; the votes are every
              model’s call on the same tape.
            </p>
          </section>

          <section className="book" aria-labelledby="strategy-book-title">
            <div className="book__head">
              <div>
                <h2 id="strategy-book-title">Strategy book</h2>
                <p>Arm a model to hand it to the bot. Each keeps its own tuning and exits.</p>
              </div>
              {showAll && <span className="book__armed">Running {strategy.name}</span>}
            </div>

            <div className="book__grid">
              {STRATEGIES.map((item, i) => {
                const itemRisk = { ...DEFAULT_RISK[item.id], ...(bot.riskPrefs[item.id] ?? {}) }
                const isArmed = bot.strategy === item.id
                const vote = scan?.votes.find((v) => v.strategy === item.id)
                return (
                  <article key={item.id} className={isArmed ? 'strategy is-armed' : 'strategy'}>
                    <div className="strategy__top">
                      <span className="strategy__idx">{String(i + 1).padStart(2, '0')}</span>
                      <span className="strategy__tag">{isArmed ? 'Armed' : item.id}</span>
                    </div>
                    <h3 className="strategy__name">{item.name}</h3>
                    <p className="strategy__blurb">{item.blurb}</p>
                    {vote && (
                      <div className="strategy__tape">
                        <span
                          className={
                            vote.dir === 1 ? 'up' : vote.dir === -1 ? 'down' : 'strategy__flat'
                          }
                        >
                          {ARROWS[vote.dir]} {vote.note}
                        </span>
                      </div>
                    )}
                    <div className="strategy__foot">
                      <span className="strategy__risk">
                        {itemRisk.riskPct}% risk · {itemRisk.stopLossPct}% stop ·{' '}
                        {itemRisk.takeProfitPct}% target
                      </span>
                      <button
                        className={isArmed ? 'mini-btn mini-btn--on' : 'mini-btn'}
                        onClick={() => onChange({ strategy: item.id as StrategyId })}
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

            <button className="link-btn link-btn--block" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Hide notes' : 'Show notes'}
            </button>
            {showAll && (
              <p className="scan__legend">
                The pip model only covers FX and crypto; the vote column leaves it out on markets it
                cannot trade. Arming a model changes what the live bot trades and which settings a
                new trade is stamped with — positions already open keep their own stops and
                targets.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
