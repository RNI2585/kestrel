import { useEffect, useState } from 'react'
import { SCRIPT_SAMPLES, describeStep, parseScript, type ScriptStep } from '../scripts'
import { planFromChart, type ChartPlan } from '../chartPlan'
import {
  averageBacktests,
  runBacktest,
  sweepCombo,
  type BacktestAverages,
  type SweepRow,
} from '../backtest'
import { DEFAULT_BOT } from '../bot'
import { signedPct } from '../format'
import type { Instrument } from '../market'

interface Props {
  instruments: Instrument[]
  selected: string
  onSelect: (symbol: string) => void
  equity: number
  cash: number
  holdingQty: number
  onRun: (steps: ScriptStep[]) => Promise<string[]>
  onShowLevels: (plan: ChartPlan) => void
}

function ScriptResult({
  steps,
  code,
  problems,
  onRun,
  onShowLevels,
  children,
}: {
  steps: ScriptStep[]
  code: string
  problems: string[]
  onRun: (steps: ScriptStep[]) => Promise<string[]>
  onShowLevels?: () => void
  children?: React.ReactNode
}) {
  const [log, setLog] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setLog([])
    setCopied(false)
  }, [code])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  const run = async () => {
    if (steps.length === 0) return
    setRunning(true)
    setLog(await onRun(steps))
    setRunning(false)
  }

  return (
    <div className="scripts__out">
      {children}

      {problems.length > 0 && (
        <div className="scripts__problems">
          <span className="scripts__label">Needs attention</span>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {steps.length > 0 && (
        <>
          <span className="scripts__label">Steps</span>
          <ol className="scripts__steps">
            {steps.map((step, index) => (
              <li key={`${step.kind}-${index}`}>{describeStep(step)}</li>
            ))}
          </ol>

          <div className="scripts__codehead">
            <span className="scripts__label">Generated script</span>
            <button className="link-btn" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="scripts__code">{code}</pre>

          <div className="scripts__actions">
            <button className="submit scripts__btn" onClick={() => void run()} disabled={running}>
              {running ? 'Running…' : 'Run script'}
            </button>
            {onShowLevels && (
              <button className="mini-btn" onClick={onShowLevels}>
                Show levels on chart
              </button>
            )}
            <span className="scripts__meta">
              {steps.length} step{steps.length === 1 ? '' : 's'} ready
            </span>
          </div>

          <p className="scripts__note">
            Runs against the paper account in this browser. The same code works from the console
            through <code>window.meridian</code>; nothing here reaches a venue unless a broker is
            routed.
          </p>
        </>
      )}

      {log.length > 0 && (
        <div className="scripts__log">
          <span className="scripts__label">Run log</span>
          <ul>
            {log.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const BACKTEST_RUNS = 24

/** Replays the plan's own strategy, risk, stop and target over many synthetic tapes. */
function PlanBacktest({ plan, instrument }: { plan: ChartPlan; instrument: Instrument }) {
  const [result, setResult] = useState<BacktestAverages | null>(null)
  const [running, setRunning] = useState(false)

  const run = () => {
    setRunning(true)
    const cfg = {
      ...DEFAULT_BOT,
      strategy: plan.strategy,
      riskPct: plan.riskPct,
      stopLossPct: plan.stopLossPct,
      takeProfitPct: plan.takeProfitPct,
    }
    window.setTimeout(() => {
      const runs = Array.from({ length: BACKTEST_RUNS }, () =>
        runBacktest({
          symbol: instrument.symbol,
          vol: instrument.vol,
          startPrice: instrument.base,
          seed: Math.floor(Math.random() * 2 ** 30),
          cfg,
        }),
      )
      setResult(averageBacktests(runs))
      setRunning(false)
    }, 40)
  }

  const perRoundTrip = result?.perRoundTrip ?? null

  return (
    <div className="chartplan__backtest">
      <div className="scripts__codehead">
        <span className="scripts__label">Backtest this plan</span>
        <button className="mini-btn" onClick={run} disabled={running}>
          {running ? 'Running…' : result ? 'Run again' : `Run ${BACKTEST_RUNS} tapes`}
        </button>
      </div>
      <p className="scripts__note">
        Replays {plan.strategyName} with this plan’s {plan.riskPct}% risk, {plan.stopLossPct}% stop and{' '}
        {plan.takeProfitPct}% target over {BACKTEST_RUNS} synthetic tapes built from {instrument.symbol}’s
        volatility, then averages them. The range shows how much the outcome moves between paths — a
        wide spread means the edge is fragile.
      </p>
      {result && (
        <>
          <dl className="backtest__stats">
            <div>
              <dt>Average return</dt>
              <dd className={result.returnPct >= 0 ? 'up' : 'down'}>{signedPct(result.returnPct)}</dd>
            </div>
            <div>
              <dt>Buy &amp; hold</dt>
              <dd className={result.buyHoldPct >= 0 ? 'up' : 'down'}>{signedPct(result.buyHoldPct)}</dd>
            </div>
            <div>
              <dt>Trades / tape</dt>
              <dd>{result.trades.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Win rate</dt>
              <dd>{result.winRate === null ? '—' : `${result.winRate.toFixed(0)}%`}</dd>
            </div>
            <div>
              <dt>Expectancy / round trip</dt>
              <dd className={perRoundTrip === null || perRoundTrip >= 0 ? 'up' : 'down'}>
                {perRoundTrip === null
                  ? '—'
                  : `${perRoundTrip >= 0 ? '+' : ''}${perRoundTrip.toFixed(3)}%`}
              </dd>
            </div>
            <div>
              <dt>Avg max drawdown</dt>
              <dd className="down">−{result.maxDrawdownPct.toFixed(2)}%</dd>
            </div>
          </dl>
          <p className="scripts__note">
            {result.runs} tapes · range {signedPct(result.worstReturnPct)} to{' '}
            {signedPct(result.bestReturnPct)} · profitable on {result.profitableRuns} of {result.runs}.
          </p>
        </>
      )}
    </div>
  )
}

const SWEEP_STOPS = [0.8, 1.5, 2.5, 4]
const SWEEP_TARGETS = [1.5, 3, 4.5, 6]
const SWEEP_RISKS = [1, 2]
const SWEEP_SEEDS = 4
const SWEEP_TOTAL = SWEEP_STOPS.length * SWEEP_TARGETS.length * SWEEP_RISKS.length

/**
 * Runs the plan's strategy across a grid of stops, targets and risk settings,
 * a few tapes per cell, and ranks them by expectancy per round trip. One combo
 * per frame keeps the page responsive while it works.
 */
function PlanSweep({ plan, instrument }: { plan: ChartPlan; instrument: Instrument }) {
  const [rows, setRows] = useState<SweepRow[] | null>(null)
  const [running, setRunning] = useState(false)

  // The whole grid is ~a few hundred milliseconds of replay, so it runs in one
  // pass behind a paint rather than across timers that hidden tabs clamp.
  const run = () => {
    setRunning(true)
    setRows(null)
    window.setTimeout(() => {
      const collected: SweepRow[] = []
      for (const stopPct of SWEEP_STOPS) {
        for (const takeProfitPct of SWEEP_TARGETS) {
          for (const riskPct of SWEEP_RISKS) {
            collected.push(
              sweepCombo({
                symbol: instrument.symbol,
                vol: instrument.vol,
                startPrice: instrument.base,
                baseCfg: { ...DEFAULT_BOT, strategy: plan.strategy, params: {} },
                seeds: Array.from({ length: SWEEP_SEEDS }, () =>
                  Math.floor(Math.random() * 2 ** 30),
                ),
                stopPct,
                takeProfitPct,
                riskPct,
              }),
            )
          }
        }
      }
      collected.sort(
        (a, b) => (b.perRoundTrip ?? -Infinity) - (a.perRoundTrip ?? -Infinity),
      )
      setRows(collected)
      setRunning(false)
    }, 40)
  }

  const positive = rows ? rows.filter((row) => (row.perRoundTrip ?? 0) > 0).length : 0

  return (
    <div className="chartplan__sweep">
      <div className="scripts__codehead">
        <span className="scripts__label">Risk &amp; exit sweep</span>
        <button className="mini-btn" onClick={run} disabled={running}>
          {running ? 'Sweeping…' : rows ? 'Sweep again' : `Sweep ${SWEEP_TOTAL} combos`}
        </button>
      </div>
      <p className="scripts__note">
        Holds {plan.strategyName} fixed and tries {SWEEP_STOPS.length} stops ×{' '}
        {SWEEP_TARGETS.length} targets × {SWEEP_RISKS.length} risk levels, {SWEEP_SEEDS} tapes each,
        ranked by expectancy per round trip.
      </p>

      {rows && (
        <>
          <p className="scripts__note">
            {positive > 0
              ? `${positive} of ${rows.length} combos earned a positive expectancy.`
              : `No combo earned a positive expectancy — this setup does not clear costs on random tapes.`}
          </p>
          <div className="chartplan__sweeptable">
            <table>
              <thead>
                <tr>
                  <th>Stop</th>
                  <th>Target</th>
                  <th>Risk</th>
                  <th>Avg return</th>
                  <th>Expectancy</th>
                  <th>Win</th>
                  <th>Trades</th>
                  <th>Green runs</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 6).map((row) => (
                  <tr key={`${row.stopPct}-${row.takeProfitPct}-${row.riskPct}`}>
                    <td>{row.stopPct}%</td>
                    <td>{row.takeProfitPct}%</td>
                    <td>{row.riskPct}%</td>
                    <td className={row.returnPct >= 0 ? 'up' : 'down'}>{signedPct(row.returnPct)}</td>
                    <td className={(row.perRoundTrip ?? 0) >= 0 ? 'up' : 'down'}>
                      {row.perRoundTrip === null
                        ? '—'
                        : `${row.perRoundTrip >= 0 ? '+' : ''}${row.perRoundTrip.toFixed(3)}%`}
                    </td>
                    <td>{row.winRate === null ? '—' : `${row.winRate.toFixed(0)}%`}</td>
                    <td>{row.trades.toFixed(1)}</td>
                    <td>
                      {row.profitableRuns}/{row.runs}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="scripts__note">
            Top {Math.min(6, rows.length)} of {rows.length} combos. These are synthetic tapes, not
            market history, so treat the ranking as a robustness check rather than a proven edge.
          </p>
        </>
      )}
    </div>
  )
}

export default function ScriptsPanel({
  instruments,
  selected,
  onSelect,
  equity,
  cash,
  holdingQty,
  onRun,
  onShowLevels,
}: Props) {
  const [mode, setMode] = useState<'chart' | 'describe'>('chart')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [plan, setPlan] = useState<ChartPlan | null>(null)

  const parsed = parseScript(submitted, instruments.map((ins) => ins.symbol))

  const analyse = () => {
    const instrument = instruments.find((ins) => ins.symbol === selected) ?? instruments[0]
    if (instrument) setPlan(planFromChart(instrument, { equity, cash, holdingQty }))
  }

  return (
    <section className="scripts">
      <div className="scripts__modes" role="tablist" aria-label="Script source">
        <button
          role="tab"
          aria-selected={mode === 'chart'}
          className={mode === 'chart' ? 'mode-tab is-active' : 'mode-tab'}
          onClick={() => setMode('chart')}
        >
          Plan from chart
        </button>
        <button
          role="tab"
          aria-selected={mode === 'describe'}
          className={mode === 'describe' ? 'mode-tab is-active' : 'mode-tab'}
          onClick={() => setMode('describe')}
        >
          Describe it
        </button>
      </div>

      {mode === 'chart' ? (
        <>
          <div className="scripts__form">
            <div className="chartplan__bar">
              <label className="field chartplan__pick">
                <span>Chart to read</span>
                <select
                  className="text-input"
                  value={selected}
                  onChange={(e) => {
                    onSelect(e.target.value)
                    setPlan(null)
                  }}
                >
                  {instruments.map((ins) => (
                    <option key={ins.symbol} value={ins.symbol}>
                      {ins.symbol} — {ins.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="submit scripts__btn" onClick={analyse}>
                Analyse chart &amp; write script
              </button>
            </div>
            <p className="scripts__note">
              Reads the visible price history — trend averages, RSI, range position and bar
              volatility — then sizes an entry, stop and target against {`$${Math.round(equity).toLocaleString('en-US')}`}{' '}
              of equity.
            </p>
          </div>

          {plan && (
            <ScriptResult
              steps={plan.steps}
              code={plan.code}
              problems={[]}
              onRun={onRun}
              onShowLevels={plan.levels.length > 0 ? () => onShowLevels(plan) : undefined}
            >
              <div className="chartplan__head">
                <div>
                  <span className="scripts__label">
                    {plan.read.symbol} · {plan.read.bars} bars read
                  </span>
                  <h2 className="chartplan__title">{plan.headline}</h2>
                </div>
                <span className={`chartplan__bias chartplan__bias--${plan.read.bias}`}>
                  {plan.read.bias}
                </span>
              </div>

              <p className="chartplan__summary">{plan.summary}</p>

              <dl className="chartplan__read">
                <div>
                  <dt>Trend spread</dt>
                  <dd className={plan.read.trendPct >= 0 ? 'up' : 'down'}>
                    {plan.read.trendPct >= 0 ? '+' : ''}
                    {plan.read.trendPct.toFixed(2)}%
                  </dd>
                </div>
                <div>
                  <dt>RSI(14)</dt>
                  <dd>{plan.read.rsi.toFixed(1)}</dd>
                </div>
                <div>
                  <dt>Range position</dt>
                  <dd>{plan.read.rangePct.toFixed(0)}%</dd>
                </div>
                <div>
                  <dt>Bar move</dt>
                  <dd>{plan.read.atrPct.toFixed(2)}%</dd>
                </div>
                <div>
                  <dt>Support</dt>
                  <dd>{plan.read.support.toFixed(plan.read.dp)}</dd>
                </div>
                <div>
                  <dt>Resistance</dt>
                  <dd>{plan.read.resistance.toFixed(plan.read.dp)}</dd>
                </div>
              </dl>

              {plan.levels.length > 0 && (
                <div className="chartplan__levels">
                  {plan.levels.map((level) => (
                    <span key={level.tone} className={`chartplan__level tone-${level.tone}`}>
                      {level.label} {level.price.toFixed(plan.read.dp)}
                    </span>
                  ))}
                  <span className="chartplan__level">
                    {plan.qty} units · {plan.riskPct}% risk
                  </span>
                </div>
              )}

              <ul className="chartplan__notes">
                {plan.read.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>

              {(() => {
                const instrument =
                  instruments.find((ins) => ins.symbol === plan.read.symbol) ?? instruments[0]
                if (!instrument) return null
                return (
                  <>
                    <PlanBacktest plan={plan} instrument={instrument} />
                    <PlanSweep plan={plan} instrument={instrument} />
                  </>
                )
              })()}
            </ScriptResult>
          )}
        </>
      ) : (
        <>
          <div className="scripts__form">
            <label className="field">
              <span>Describe what should happen</span>
              <textarea
                className="text-input scripts__input"
                rows={6}
                value={description}
                spellCheck={false}
                placeholder="Close my gold position, buy 0.4 BTC at market, switch to trend following and start the bot."
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) setSubmitted(description)
                }}
              />
            </label>

            <div className="scripts__actions">
              <button
                className="submit scripts__btn"
                onClick={() => setSubmitted(description)}
                disabled={!description.trim()}
              >
                Generate script
              </button>
              <span className="scripts__meta">Plain English in, steps out</span>
            </div>

            <div className="scripts__samples">
              {SCRIPT_SAMPLES.map((sample) => (
                <button
                  key={sample.label}
                  className="pill"
                  onClick={() => {
                    setDescription(sample.text)
                    setSubmitted(sample.text)
                  }}
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>

          {submitted && (
            <ScriptResult
              steps={parsed.steps}
              code={parsed.code}
              problems={parsed.problems}
              onRun={onRun}
            />
          )}
        </>
      )}
    </section>
  )
}
