export function money(n: number, dp = 2): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${n < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(2)}M`
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })
}

export function signedMoney(n: number, dp = 2): string {
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${money(Math.abs(n), dp)}`
}

export function price(n: number, dp = 2): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })
}

export function signedPct(n: number, dp = 2): string {
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n).toFixed(dp)}%`
}

export function units(q: number): string {
  if (q >= 1000) return q.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (q >= 1) return q.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return q.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-GB', { hour12: false })
}
