import { useState } from 'react'
import { runBacktest, type BacktestResult } from '../backtest'
import { STRATEGIES, type BotConfig } from '../bot'
import type { Instrument } from '../market'
import { money, signedPct } from '../format'

interface Props {
  instrument: Instrument
  bot: BotConfig
}

export default function BacktestPanel({ instrument, bot }: Props) {
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [running, setRunning] = useState(false)
  const strategy = STRATEGIES.find((s) => s.id === bot.strategy)

  const run = () => {
    const seed = Math.floor(Math.random() * 2 ** 30)
    setRunning(true)
    // let the button show its state before the replay blocks the frame
    window.setTimeout(() => {
      setResult(
        runBacktest({
          symbol: instrument.symbol,
          vol: instrument.vol,
          startPrice: instrument.base,
          cfg: bot,
          seed,
        }),
      )
      setRunning(false)
    }, 40)
  }

  const positive = (result?.returnPct ?? 0) >= 0

  return (
    <section className="card backtest">
      <header className="card__head">
        <h3>Strategy backtest</h3>
        <span className="panel__meta">
          {result ? `${result.symbol} · ${result.ticks} ticks` : `${instrument.symbol} · 600 ticks`}
        </span>
      </header>

      <div className="backtest__run">
        <div>
          <p className="backtest__blurb">
            {strategy?.name} over a synthetic tape built from {instrument.symbol}’s volatility, using your
            current strategy, risk, stop and target settings.
          </p>
        </div>
        <button className="submit backtest__btn" onClick={run} disabled={running}>
          {running ? 'Running…' : result ? 'Run again' : 'Run backtest'}
        </button>
      </div>

      {result && (
        <>
          <dl className="backtest__stats">
            <div>
              <dt>Bot return</dt>
              <dd className={result.returnPct >= 0 ? 'up' : 'down'}>{signedPct(result.returnPct)}</dd>
            </div>
            <div>
              <dt>Buy &amp; hold</dt>
              <dd className={result.buyHoldPct >= 0 ? 'up' : 'down'}>{signedPct(result.buyHoldPct)}</dd>
            </div>
            <div>
              <dt>Trades</dt>
              <dd>{result.trades}</dd>
            </div>
            <div>
              <dt>Win rate</dt>
              <dd>{result.winRate === null ? '—' : `${result.winRate.toFixed(0)}%`}</dd>
            </div>
            <div>
              <dt>Max drawdown</dt>
              <dd className="down">−{result.maxDrawdownPct.toFixed(2)}%</dd>
            </div>
            <div>
              <dt>End equity</dt>
              <dd>{money(result.endEquity)}</dd>
            </div>
          </dl>

          <BacktestCurve result={result} positive={positive} />

          <p className="ticket__hint">
            Ended {money(result.startEquity)} → {money(result.endEquity)}. Different synthetic path each run, so
            re-run to see how sensitive the edge is.
          </p>
        </>
      )}
    </section>
  )
}

function BacktestCurve({ result, positive }: { result: BacktestResult; positive: boolean }) {
  const width = 600
  const height = 110
  const pad = 6
  const min = Math.min(...result.curve)
  const max = Math.max(...result.curve)
  const span = max - min || max * 0.001 || 1
  const x = (i: number) => (i / Math.max(result.curve.length - 1, 1)) * width
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2)
  const line = result.curve
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`)
    .join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`
  const color = positive ? '#4fb58a' : '#e0685f'

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Backtest equity curve"
      className="backtest__curve"
    >
      <defs>
        <linearGradient id="bt-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.26" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#bt-fill)" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
