import { useState } from 'react'
import {
  runBacktest,
  walkForward,
  type BacktestResult,
  type WalkForwardResult,
} from '../backtest'
import { STRATEGIES, type BotConfig } from '../bot'
import type { Instrument } from '../market'
import { money, signedPct } from '../format'

interface Props {
  instrument: Instrument
  bot: BotConfig
}

export default function BacktestPanel({ instrument, bot }: Props) {
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [walk, setWalk] = useState<WalkForwardResult | null>(null)
  const [running, setRunning] = useState<'backtest' | 'walk' | null>(null)
  const strategy = STRATEGIES.find((s) => s.id === bot.strategy)

  const run = () => {
    const seed = Math.floor(Math.random() * 2 ** 30)
    setRunning('backtest')
    // let the button show its state before the replay blocks the frame
    window.setTimeout(() => {
      setResult(
        runBacktest({
          symbol: instrument.symbol,
          assetClass: instrument.cls,
          vol: instrument.vol,
          startPrice: instrument.base,
          cfg: bot,
          seed,
        }),
      )
      setRunning(null)
    }, 40)
  }

  /** Fits exits on one set of tapes and scores the winner on unseen ones. */
  const runWalkForward = () => {
    setRunning('walk')
    window.setTimeout(() => {
      setWalk(
        walkForward({
          symbol: instrument.symbol,
          assetClass: instrument.cls,
          vol: instrument.vol,
          startPrice: instrument.base,
          baseCfg: bot,
          stopPcts: [1.5, 2.5, 4],
          takeProfitPcts: [4, 6, 8],
          riskPcts: [0.5, 1, 1.5],
          trainSeeds: [11, 12, 13],
          testSeeds: [91, 92, 93],
          ticks: 400,
          spreadBps: 5,
          slippageBps: 5,
        }),
      )
      setRunning(null)
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
            {strategy?.name} over a synthetic tape using your current strategy settings. Fills
            include the ledger commission plus an estimated 5 bps full spread and 5 bps slippage
            each way.
          </p>
        </div>
        <button className="submit backtest__btn" onClick={run} disabled={running !== null}>
          {running === 'backtest' ? 'Running…' : result ? 'Run again' : 'Run backtest'}
        </button>
        <button
          className="mini-btn backtest__btn"
          onClick={runWalkForward}
          disabled={running !== null}
        >
          {running === 'walk' ? 'Fitting…' : 'Walk forward'}
        </button>
      </div>

      {walk && (
        <div className="walk">
          <div className="walk__head">
            <strong>
              Fitted stop {walk.fitted.stopPct}% · target {walk.fitted.takeProfitPct}% · risk{' '}
              {walk.fitted.riskPct}%
            </strong>
            <span className={`walk__verdict ${walk.survives ? 'is-good' : 'is-bad'}`}>
              {walk.survives ? 'Holds out of sample' : 'Failed out of sample'}
            </span>
          </div>
          <dl className="backtest__stats">
            <div>
              <dt>In sample</dt>
              <dd className={walk.inSample.returnPct >= 0 ? 'up' : 'down'}>
                {signedPct(walk.inSample.returnPct)}
              </dd>
            </div>
            <div>
              <dt>Unseen tapes</dt>
              <dd className={walk.outOfSample.returnPct >= 0 ? 'up' : 'down'}>
                {signedPct(walk.outOfSample.returnPct)}
              </dd>
            </div>
            <div>
              <dt>Decay</dt>
              <dd className={walk.decayPct >= 0 ? 'up' : 'down'}>{signedPct(walk.decayPct)}</dd>
            </div>
            <div>
              <dt>Unseen drawdown</dt>
              <dd className="down">−{walk.outOfSample.maxDrawdownPct.toFixed(2)}%</dd>
            </div>
          </dl>
          <p className="ticket__hint">
            Exits are chosen on three synthetic tapes, then scored on three the fit never saw.
            Modelled trading costs are included; this is not historical-market validation.
          </p>
        </div>
      )}

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
              <dt>Avg R</dt>
              <dd className={(result.avgR ?? 0) >= 0 ? 'up' : 'down'}>
                {result.avgR === null ? '—' : `${result.avgR >= 0 ? '+' : ''}${result.avgR.toFixed(2)}R`}
              </dd>
            </div>
            <div>
              <dt>Profit factor</dt>
              <dd>
                {result.profitFactor === null ? '—' : result.profitFactor.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt>Sharpe / tick</dt>
              <dd>{result.sharpe === null ? '—' : result.sharpe.toFixed(3)}</dd>
            </div>
            <div>
              <dt>End equity</dt>
              <dd>{money(result.endEquity)}</dd>
            </div>
          </dl>

          <BacktestCurve result={result} positive={positive} />

          <p className="ticket__hint">
            Ended {money(result.startEquity)} → {money(result.endEquity)}. Synthetic paths are
            educational only; they cannot establish a real-market edge.
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
  const color = positive ? '#00c46a' : '#ff4d5e'

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
