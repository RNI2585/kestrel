import { useState } from 'react'
import { DEFAULT_RISK, STRATEGIES, type BotConfig } from '../bot'
import { ASSET_CLASSES, type AssetClass } from '../market'
import { money } from '../format'

interface Props {
  bot: BotConfig
  onChange: (patch: Partial<BotConfig>) => void
  stats: { trades: number; winRate: number | null; realized: number }
  instruments: number
  /** The routed venue's name, or null while the paper ledger is routed. */
  brokerLabel: string | null
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (v: number) => void
}

/** The range control shared by this panel and the Strategies tab. */
export function Slider({ label, value, min, max, step, display, onChange }: SliderProps) {
  return (
    <label className="slider">
      <span className="slider__row">
        <span>{label}</span>
        <span className="slider__value">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export default function BotPanel({ bot, onChange, stats, instruments, brokerLabel }: Props) {
  const [showAll, setShowAll] = useState(false)
  const strategy = STRATEGIES.find((s) => s.id === bot.strategy)

  const toggleClass = (cls: AssetClass) => {
    const next = bot.classes.includes(cls)
      ? bot.classes.filter((c) => c !== cls)
      : [...bot.classes, cls]
    onChange({ classes: next })
  }

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Trading bot</h2>
        <span className={`status ${bot.running ? 'status--on' : ''}`}>
          <i aria-hidden="true" />
          {bot.running ? 'Scanning' : 'Paused'}
        </span>
      </header>

      <button
        className={`bot__toggle ${bot.running ? 'bot__toggle--on' : ''}`}
        onClick={() => onChange({ running: !bot.running })}
      >
        {bot.running ? 'Stop the bot' : 'Start the bot'}
      </button>
      <p className="hint">
        {bot.running
          ? `Watching ${instruments} instruments across ${bot.classes.length} asset ${
              bot.classes.length === 1 ? 'class' : 'classes'
            }${bot.routeToBroker && brokerLabel ? `, sending orders to ${brokerLabel}.` : '.'}`
          : 'The bot trades the same cash balance you do. Stop it any time.'}
      </p>
      <p className="hint">
        {bot.strategyMode === 'market-fit'
          ? 'Each instrument may use a different model and its own saved settings.'
          : `${strategy?.name} is armed. Its tuning, stop and take profit live in the Strategies tab.`}
      </p>

      <label className="field">
        <span>Strategy selection</span>
        <select
          value={bot.strategyMode}
          onChange={(e) =>
            onChange({ strategyMode: e.target.value === 'market-fit' ? 'market-fit' : 'fixed' })
          }
        >
          <option value="fixed">Use the armed strategy</option>
          <option value="market-fit">Match a strategy to each market</option>
        </select>
      </label>
      <p className="hint">
        {bot.strategyMode === 'market-fit'
          ? `Per-market matching is heuristic and paper-only with today’s simulated chart history. Position size is capped by the risk budget (default ${DEFAULT_RISK[bot.strategy].riskPct}%) and uses the wider of the configured stop and three recent average moves; the actual stop remains unchanged. Broker-routed bot entries stay blocked until verified historical bars are available.`
          : 'Market matching can be enabled to choose among strategies separately for each instrument.'}
      </p>

      <Slider
        label="Max invested"
        value={bot.maxAllocPct}
        min={20}
        max={100}
        step={5}
        display={`${bot.maxAllocPct}% of equity`}
        onChange={(maxAllocPct) => onChange({ maxAllocPct })}
      />

      <label className="field">
        <span>Bot order routing</span>
        <select
          value={bot.routeToBroker && brokerLabel ? 'broker' : 'paper'}
          disabled={!brokerLabel}
          onChange={(e) => onChange({ routeToBroker: e.target.value === 'broker' })}
        >
          <option value="paper">Fill in the paper ledger</option>
          {brokerLabel && <option value="broker">Send to {brokerLabel}</option>}
        </select>
      </label>
      <p className="hint">
        {brokerLabel
          ? `With ${brokerLabel} routed, bot entries require both a fresh quote and verified historical bars. Current charts use simulated history, so automated broker entries are paused; manual orders remain available with a fresh quote.`
          : 'Link a broker in Broker connections and route it there to send the bot’s orders to a real venue.'}
      </p>

      <div className="bot__classes">
        {ASSET_CLASSES.map((cls) => (
          <label key={cls} className="check">
            <input
              type="checkbox"
              checked={bot.classes.includes(cls)}
              onChange={() => toggleClass(cls)}
            />
            <span>{cls}</span>
          </label>
        ))}
      </div>

      <dl className="bot__stats">
        <div>
          <dt>Trades</dt>
          <dd>{stats.trades}</dd>
        </div>
        <div>
          <dt>Win rate</dt>
          <dd>{stats.winRate === null ? '—' : `${stats.winRate.toFixed(0)}%`}</dd>
        </div>
        <div>
          <dt>Realised</dt>
          <dd className={stats.realized >= 0 ? 'up' : 'down'}>
            {stats.realized >= 0 ? '+' : '−'}
            {money(Math.abs(stats.realized))}
          </dd>
        </div>
      </dl>

      {showAll && (
        <p className="hint">
          Stops and targets are checked on every scan, before the strategy signal. Each trade is
          stamped with the stop and take profit of the setting that opened it — when the bot fires
          on auto, or when you approve a proposal — and keeps those levels until it closes, so
          changing the armed strategy never moves an open trade. A symbol rests for eight scans
          after it trades so the bot cannot churn one position, or three scans under scalping so it
          can work a burst.
        </p>
      )}
      <button className="link-btn link-btn--block" onClick={() => setShowAll((v) => !v)}>
        {showAll ? 'Hide how it trades' : 'How it trades'}
      </button>
    </section>
  )
}
