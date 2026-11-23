import { useState } from 'react'
import {
  DEFAULT_RISK,
  STRATEGIES,
  STRATEGY_CLASSES,
  activeRisk,
  defaultParams,
  paramDefs,
  patchRisk,
  type BotConfig,
  type StrategyId,
} from '../bot'
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

function Slider({ label, value, min, max, step, display, onChange }: SliderProps) {
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
  const defs = paramDefs(bot.strategy)
  const overrides = bot.params[bot.strategy] ?? {}
  const values = { ...defaultParams(bot.strategy), ...overrides }
  const risk = activeRisk(bot)
  const riskDefaults = DEFAULT_RISK[bot.strategy]
  const riskTuned =
    risk.riskPct !== riskDefaults.riskPct ||
    risk.stopLossPct !== riskDefaults.stopLossPct ||
    risk.takeProfitPct !== riskDefaults.takeProfitPct

  const toggleClass = (cls: AssetClass) => {
    const next = bot.classes.includes(cls)
      ? bot.classes.filter((c) => c !== cls)
      : [...bot.classes, cls]
    onChange({ classes: next })
  }

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

      <label className="field">
        <span>Strategy</span>
        <select value={bot.strategy} onChange={(e) => onChange({ strategy: e.target.value as StrategyId })}>
          {STRATEGIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">{strategy?.blurb}</p>
      {STRATEGY_CLASSES[bot.strategy] && (
        <p className="hint">
          This strategy only trades {STRATEGY_CLASSES[bot.strategy]?.join(' and ')} — the bot skips
          every other asset class while it is armed.
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
          Reset {strategy?.name.toLowerCase()} settings
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
      {riskTuned && (
        <button
          className="link-btn link-btn--block"
          onClick={() => {
            const next = { ...bot.riskPrefs }
            delete next[bot.strategy]
            onChange({ riskPrefs: next })
          }}
        >
          Reset {strategy?.name.toLowerCase()} risk to {riskDefaults.riskPct}% /{' '}
          {riskDefaults.stopLossPct}% / {riskDefaults.takeProfitPct}%
        </button>
      )}
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
          ? `With ${brokerLabel} routed, each bot order is sent to the venue and only booked in the terminal once the venue accepts it.`
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
          Stops and targets are checked on every scan, before the strategy signal. Each strategy keeps
          its own risk, stop and target — scalping starts tighter than trend following — and remembers
          any tweaks you make, so switching strategies swaps the exits too. A symbol rests for eight
          scans after it trades so the bot cannot churn one position, or three scans under scalping so
          it can work a burst. The strategy settings above feed both the live bot and the backtest.
        </p>
      )}
      <button className="link-btn link-btn--block" onClick={() => setShowAll((v) => !v)}>
        {showAll ? 'Hide how it trades' : 'How it trades'}
      </button>
    </section>
  )
}
