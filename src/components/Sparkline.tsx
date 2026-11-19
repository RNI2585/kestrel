export default function Sparkline({ data, color }: { data: number[]; color: string }) {
  const width = 64
  const height = 22
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const points = data
    .map((p, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * width
      const y = height - 1 - ((p - min) / span) * (height - 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="spark">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}
