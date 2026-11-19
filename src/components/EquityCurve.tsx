import { money } from '../format'

interface Props {
  points: number[]
  deposited: number
  equity: number
}

export default function EquityCurve({ points, deposited, equity }: Props) {
  const data = points.length > 1 ? points : [equity, equity]
  const width = 320
  const height = 64
  const pad = 4
  const min = Math.min(...data, deposited)
  const max = Math.max(...data, deposited)
  const span = max - min || max * 0.001 || 1
  const x = (i: number) => (i / Math.max(data.length - 1, 1)) * width
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2)
  const line = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Equity curve</h2>
        <span className="panel__meta">{points.length > 0 ? `${points.length} samples` : 'Starting'}</span>
      </header>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Equity over this session"
        className="curve"
      >
        <defs>
          <linearGradient id="curve-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c9a45b" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#c9a45b" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          x1={0}
          x2={width}
          y1={y(deposited)}
          y2={y(deposited)}
          stroke="#3d464b"
          strokeDasharray="4 6"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <path d={area} fill="url(#curve-fill)" />
        <path
          d={line}
          fill="none"
          stroke="#c9a45b"
          strokeWidth="1.4"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="curve__meta">
        <span>low {money(Math.min(...data))}</span>
        <span>high {money(Math.max(...data))}</span>
      </div>
      <p className="curve__hint">Dashed line is your opening deposit of {money(deposited)}.</p>
    </section>
  )
}
