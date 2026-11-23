import type { PlanLevel } from '../chartPlan'

const TONE: Record<PlanLevel['tone'], string> = {
  entry: '#4da3ff',
  stop: '#ff4d5e',
  target: '#00c46a',
}

export default function PriceChart({
  data,
  color,
  label,
  levels,
}: {
  data: number[]
  color: string
  label: string
  levels?: PlanLevel[]
}) {
  const width = 1000
  const height = 320
  const pad = 10
  const prices = levels && levels.length > 0 ? [...data, ...levels.map((l) => l.price)] : data
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const span = max - min || max * 0.002 || 1
  const x = (i: number) => (i / Math.max(data.length - 1, 1)) * width
  const y = (p: number) => pad + (1 - (p - min) / span) * (height - pad * 2)
  const line = data.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p).toFixed(2)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`
  const gradientId = `fill-${color.replace('#', '')}`
  const first = data[0]

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} price chart`}
        className="chart__svg"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={width}
            y1={height * f}
            y2={height * f}
            stroke="#2f3136"
            strokeWidth="1"
            strokeDasharray="2 8"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line
          x1={0}
          x2={width}
          y1={y(first)}
          y2={y(first)}
          stroke="#3a3d43"
          strokeWidth="1"
          strokeDasharray="6 6"
          vectorEffect="non-scaling-stroke"
        />
        {levels?.map((level) => (
          <line
            key={`${level.tone}-${level.price}`}
            x1={0}
            x2={width}
            y1={y(level.price)}
            y2={y(level.price)}
            stroke={TONE[level.tone]}
            strokeWidth="1"
            strokeDasharray="5 5"
            strokeOpacity="0.75"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {levels?.map((level) => (
        <span
          key={`${level.tone}-${level.price}`}
          className={`chart__level tone-${level.tone}`}
          style={{ top: `${(y(level.price) / height) * 100}%` }}
        >
          {level.label} {level.price}
        </span>
      ))}
      <span className="chart__axis chart__axis--top">{max.toFixed(2)}</span>
      <span className="chart__axis chart__axis--bottom">{min.toFixed(2)}</span>
      <span className="chart__axis chart__axis--start">{label} ago</span>
      <span className="chart__axis chart__axis--end">now</span>
    </div>
  )
}
