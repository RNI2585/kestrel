import { useMemo } from 'react'
import type { Fill } from '../trade'
import { timeTicks, positionOf, type EquityPoint } from '../timeline'
import { money, signedMoney } from '../format'

const W = 1000
const H = 300
const TOP = 18
const BOTTOM = 30

/**
 * The session's equity against the clock, with every fill marked where it was
 * booked. The time axis follows the desk's ladder: 15 seconds to a minute in
 * 15-second steps, every 15 minutes to the hour, then every 4 hours.
 */
export default function PerformanceChart({
  points,
  fills,
  startTs,
  deposited,
  symbol,
}: {
  points: EquityPoint[]
  fills: Fill[]
  startTs: number
  deposited: number
  symbol?: string
}) {
  const nowTs = points.length > 0 ? points[points.length - 1].t : startTs
  const ticks = useMemo(() => timeTicks(Math.max(nowTs - startTs, 60_000)), [nowTs, startTs])

  if (points.length < 2) {
    return (
      <p className="empty perf__empty">
        The equity curve starts drawing with the first market tick — leave the desk open and it
        fills in from 15 seconds.
      </p>
    )
  }

  const values = points.map((p) => p.v)
  const min = Math.min(deposited, ...values)
  const max = Math.max(deposited, ...values)
  const span = max - min || Math.abs(max) * 0.001 || 1
  const x = (ts: number) => positionOf(ts, startTs, ticks) * W
  const y = (value: number) => TOP + (1 - (value - min) / span) * (H - TOP - BOTTOM)

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(2)},${y(p.v).toFixed(2)}`)
    .join(' ')
  const area = `${line} L${x(nowTs).toFixed(2)},${H - BOTTOM} L${x(points[0].t).toFixed(2)},${
    H - BOTTOM
  } Z`

  const last = points[points.length - 1].v
  const change = last - deposited

  // Peak-to-trough drawdown is the number that says how bad it got, not how
  // good it ended.
  let peak = values[0]
  let drawdown = 0
  for (const value of values) {
    if (value > peak) peak = value
    if (peak > 0) drawdown = Math.max(drawdown, ((peak - value) / peak) * 100)
  }

  const exportCsv = () => {
    const rows = ['section,ts,iso,value,detail']
    for (const p of points) {
      rows.push(`equity,${p.t},${new Date(p.t).toISOString()},${p.v.toFixed(2)},`)
    }
    for (const fill of fills) {
      if (fill.ts < startTs) continue
      const detail = `${fill.side} ${fill.symbol} ${fill.qty.toFixed(6)} @ ${fill.price}`
      rows.push(
        `fill,${fill.ts},${new Date(fill.ts).toISOString()},${(fill.pnl ?? 0).toFixed(2)},"${detail}"`,
      )
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `kestrel-${symbol ?? 'session'}-${new Date(startTs)
      .toISOString()
      .slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const marked = fills
    .filter((f) => f.ts >= startTs)
    .map((fill) => {
      const nearest = points.reduce(
        (best, p) => (Math.abs(p.t - fill.ts) < Math.abs(best.t - fill.ts) ? p : best),
        points[0],
      )
      return { fill, x: x(fill.ts), y: y(nearest.v) }
    })

  return (
    <div className="perf">
      <div className="perf__readout">
        <span>
          Open <strong>{money(points[0].v)}</strong>
        </span>
        <span>
          Now <strong className={change >= 0 ? 'up' : 'down'}>{money(last)}</strong>
        </span>
        <span className={change >= 0 ? 'up' : 'down'}>
          {signedMoney(change)} on the session
        </span>
        <span className="perf__dd">max drawdown {drawdown.toFixed(2)}%</span>
        <button className="mini-btn perf__export" onClick={exportCsv}>
          Export CSV
        </button>
        <span className="perf__key">
          <i className="perf__dot perf__dot--buy" aria-hidden="true" /> entry
          <i className="perf__dot perf__dot--win" aria-hidden="true" /> winning exit
          <i className="perf__dot perf__dot--loss" aria-hidden="true" /> losing exit
        </span>
      </div>

      <div className="chart perf__chart">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Equity through the session with each fill marked"
          className="chart__svg"
        >
          <defs>
            <linearGradient id="perf-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4da3ff" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#4da3ff" stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map((tick) => {
            const tx = positionOf(startTs + tick.ms, startTs, ticks) * W
            return (
              <g key={tick.ms}>
                <line
                  x1={tx}
                  x2={tx}
                  y1={TOP}
                  y2={H - BOTTOM}
                  stroke="#2c2f34"
                  strokeWidth="1"
                  strokeDasharray="2 6"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={tx}
                  y={H - 10}
                  fill="#7c828e"
                  fontSize="10"
                  textAnchor="middle"
                  preserveAspectRatio="none"
                >
                  {tick.label}
                </text>
              </g>
            )
          })}

          <line
            x1={0}
            x2={W}
            y1={y(deposited)}
            y2={y(deposited)}
            stroke="#3a3d43"
            strokeWidth="1"
            strokeDasharray="6 6"
            vectorEffect="non-scaling-stroke"
          />

          <path d={area} fill="url(#perf-fill)" />
          <path
            d={line}
            fill="none"
            stroke="#4da3ff"
            strokeWidth="1.7"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {marked.map(({ fill, x: fx, y: fy }) => {
            const win = (fill.pnl ?? 0) >= 0
            const colour = fill.side === 'buy' ? '#4da3ff' : win ? '#00c46a' : '#ff4d5e'
            return (
              <g key={fill.id}>
                <line
                  x1={fx}
                  x2={fx}
                  y1={fy}
                  y2={H - BOTTOM}
                  stroke={colour}
                  strokeOpacity="0.35"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <circle cx={fx} cy={fy} r="3.4" fill={colour} />
              </g>
            )
          })}

          <circle cx={x(nowTs)} cy={y(last)} r="4" fill="#e8eaee" />
        </svg>
        <span className="chart__axis chart__axis--top">{money(max)}</span>
        <span className="chart__axis chart__axis--bottom">{money(min)}</span>
      </div>

      <p className="perf__note">
        Time runs on a stepped axis so the opening minute and the hours after it both stay legible:
        15s to 1m in 15s steps, 15m to the hourly mark in 15m steps, then every 4 hours.
      </p>
    </div>
  )
}
