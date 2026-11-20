import { STRATEGIES, type StrategyId } from './bot'

export type ScriptStep =
  | { kind: 'order'; symbol: string; side: 'buy' | 'sell'; qty: number; limit?: number }
  | { kind: 'close'; symbol: string }
  | { kind: 'select'; symbol: string }
  | { kind: 'bot'; running: boolean }
  | { kind: 'strategy'; strategy: StrategyId }
  | { kind: 'risk'; riskPct?: number; stopLossPct?: number; takeProfitPct?: number }
  | { kind: 'route'; to: 'paper' | 'broker' }

export interface ParsedScript {
  steps: ScriptStep[]
  problems: string[]
  code: string
}

/** The small API an in-browser Meridian script can call. */
export interface MeridianApi {
  order: (symbol: string, side: 'buy' | 'sell', qty: number) => Promise<void>
  limit: (symbol: string, side: 'buy' | 'sell', qty: number, price: number) => Promise<void>
  close: (symbol: string) => Promise<void>
  select: (symbol: string) => void
  bot: (patch: { running?: boolean }) => void
  strategy: (id: StrategyId) => void
  risk: (patch: { riskPct?: number; stopLossPct?: number; takeProfitPct?: number }) => void
  route: (target: 'paper' | 'broker') => void
}

declare global {
  interface Window {
    meridian?: MeridianApi
  }
}

const ALIASES: Record<string, string> = {
  gold: 'XAU',
  silver: 'XAG',
  platinum: 'XPT',
  bitcoin: 'BTC',
  ether: 'ETH',
  ethereum: 'ETH',
  solana: 'SOL',
  oil: 'WTI',
  crude: 'WTI',
  gas: 'NG',
  euro: 'EURUSD',
  sterling: 'GBPUSD',
  pound: 'GBPUSD',
  yen: 'USDJPY',
  apple: 'AAPL',
  nvidia: 'NVDA',
  tesla: 'TSLA',
  microsoft: 'MSFT',
  jpmorgan: 'JPM',
}

const STRATEGY_WORDS: { pattern: RegExp; id: StrategyId }[] = [
  { pattern: /\bscalp(?:ing|er)?\b/, id: 'scalp' },
  { pattern: /\bmean[\s-]*revers(?:ion|ing|e)\b|\breversion\b/, id: 'meanrev' },
  { pattern: /\bmacd\b/, id: 'macd' },
  { pattern: /\brsi\b/, id: 'rsi' },
  { pattern: /\bbreak[\s-]*out\b/, id: 'breakout' },
  { pattern: /\bdip(?:[\s-]*buy(?:er|ing)?)?\b/, id: 'dip' },
  {
    pattern: /\bmomentum\b|\btrend(?:[\s-]*(?:following|follower))?\b/,
    id: 'momentum',
  },
]

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findSymbol(text: string, known: Map<string, string>): string | null {
  const cleaned = ` ${text.replace(/[.,!?()[\]{}'"]/g, ' ').replace(/\s+/g, ' ')} `
  for (const [word, symbol] of Object.entries(ALIASES)) {
    if (!known.has(symbol.toLowerCase())) continue
    if (new RegExp(`(^|[^a-z0-9])${escapeRe(word)}([^a-z0-9]|$)`).test(cleaned)) return symbol
  }
  for (const [lower, symbol] of known) {
    if (new RegExp(`(^|[^a-z0-9])${escapeRe(lower)}([^a-z0-9]|$)`).test(cleaned)) return symbol
  }
  return null
}

function findStrategy(text: string): StrategyId | null {
  for (const { pattern, id } of STRATEGY_WORDS) if (pattern.test(text)) return id
  return null
}

function pct(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const value = Number(match[1])
      if (Number.isFinite(value) && value > 0) return value
    }
  }
  return undefined
}

function round(value: number): number {
  return Number(value.toFixed(6))
}

export function stepCode(step: ScriptStep): string {
  switch (step.kind) {
    case 'order':
      return step.limit
        ? `await meridian.limit('${step.symbol}', '${step.side}', ${round(step.qty)}, ${step.limit})`
        : `await meridian.order('${step.symbol}', '${step.side}', ${round(step.qty)})`
    case 'close':
      return `await meridian.close('${step.symbol}')`
    case 'select':
      return `meridian.select('${step.symbol}')`
    case 'bot':
      return `meridian.bot({ running: ${step.running} })`
    case 'strategy':
      return `meridian.strategy('${step.strategy}')`
    case 'risk': {
      const parts: string[] = []
      if (step.riskPct !== undefined) parts.push(`riskPct: ${step.riskPct}`)
      if (step.stopLossPct !== undefined) parts.push(`stopLossPct: ${step.stopLossPct}`)
      if (step.takeProfitPct !== undefined) parts.push(`takeProfitPct: ${step.takeProfitPct}`)
      return `meridian.risk({ ${parts.join(', ')} })`
    }
    case 'route':
      return `meridian.route('${step.to}')`
  }
}

/** Human-readable label for one generated step. */
export function describeStep(step: ScriptStep): string {
  switch (step.kind) {
    case 'order': {
      const qty = round(step.qty)
      return step.limit
        ? `${step.side === 'buy' ? 'Buy' : 'Sell'} ${qty} ${step.symbol} at a limit of ${step.limit}`
        : `${step.side === 'buy' ? 'Buy' : 'Sell'} ${qty} ${step.symbol} at market`
    }
    case 'close':
      return `Close the ${step.symbol} position at market`
    case 'select':
      return `Focus ${step.symbol}`
    case 'bot':
      return step.running ? 'Start the bot' : 'Pause the bot'
    case 'strategy':
      return `Use ${STRATEGIES.find((s) => s.id === step.strategy)?.name ?? step.strategy}`
    case 'risk': {
      const parts: string[] = []
      if (step.riskPct !== undefined) parts.push(`${step.riskPct}% risk per trade`)
      if (step.stopLossPct !== undefined) parts.push(`${step.stopLossPct}% stop`)
      if (step.takeProfitPct !== undefined) parts.push(`${step.takeProfitPct}% target`)
      return `Set ${parts.join(', ')}`
    }
    case 'route':
      return step.to === 'paper' ? 'Route orders to the paper ledger' : 'Route orders to the linked broker'
  }
}

/**
 * Turns a plain-English description into ordered Meridian steps plus the
 * equivalent script. One clause is read at a time, so "buy 2 gold and start
 * the bot" becomes two steps; anything not understood is reported, never
 * executed.
 */
export function parseScript(description: string, symbols: string[]): ParsedScript {
  const known = new Map<string, string>()
  for (const symbol of symbols) known.set(symbol.toLowerCase(), symbol)

  const steps: ScriptStep[] = []
  const problems: string[] = []

  const clauses = description
    .split(/[\n;]+|\band then\b|\bthen\b|\band\b|,|\.(?:\s|$)/i)
    .map((clause) => clause.trim())
    .filter(Boolean)

  let lastSide: 'buy' | 'sell' | null = null

  for (const clause of clauses) {
    const text = clause.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!/[a-z]/.test(text)) continue

    const symbol = findSymbol(text, known)
    const before = steps.length

    // strategy
    const strategy = findStrategy(text)
    if (strategy) steps.push({ kind: 'strategy', strategy })

    // risk, stop and target percentages travel together
    const riskPct = pct(text, [
      /risk(?: per trade)?\s*(?:at|to|=|of)?\s*(\d+(?:\.\d+)?)\s*%/,
      /(\d+(?:\.\d+)?)\s*%\s*(?:of equity\s*)?risk\b/,
    ])
    const stopLossPct = pct(text, [
      /stop(?:[\s-]*loss)?\s*(?:at|to|=|of)?\s*(\d+(?:\.\d+)?)\s*%/,
      /(\d+(?:\.\d+)?)\s*%\s*stop(?:[\s-]*loss)?\b/,
    ])
    const takeProfitPct = pct(text, [
      /(?:take[\s-]*profit|target|profit)\s*(?:at|to|=|of)?\s*(\d+(?:\.\d+)?)\s*%/,
      /(\d+(?:\.\d+)?)\s*%\s*(?:target|take[\s-]*profit)\b/,
    ])
    if (riskPct !== undefined || stopLossPct !== undefined || takeProfitPct !== undefined) {
      steps.push({ kind: 'risk', riskPct, stopLossPct, takeProfitPct })
    }

    // order routing
    const route = text.match(
      /\b(?:route|send|direct)\b[^]*?\b(paper(?:\s+ledger)?|ledger|broker|venue|exchange)\b/,
    )
    if (route) {
      const target = route[1]
      steps.push({ kind: 'route', to: /paper|ledger/.test(target) ? 'paper' : 'broker' })
    }

    // bot control
    if (/\bbot\b/.test(text)) {
      if (/\b(?:stop|pause|halt|disable|turn off|switch off)\b/.test(text)) {
        steps.push({ kind: 'bot', running: false })
      } else if (/\b(?:start|run|enable|resume|activate|begin|turn on|switch on|let)\b/.test(text)) {
        steps.push({ kind: 'bot', running: true })
      }
    }

    // close an existing position
    const wantsClose = /\b(?:close|flatten|exit|liquidate|dump)\b/.test(text)
    const hasQty = /\d/.test(text.split(/\b(?:at|@)\b/)[0])

    if (wantsClose && symbol && !hasQty) {
      steps.push({ kind: 'close', symbol })
    } else {
      let side: 'buy' | 'sell' | null = /\bsell\b|\bshort\b|\breduce\b/.test(text)
        ? 'sell'
        : /\bbuy\b|\blong\b|\badd\b|\bpick up\b/.test(text)
          ? 'buy'
          : null
      // "buy 2 gold and 3 silver": the second clause inherits the side
      if (!side && lastSide && /^\s*(?:an?\s+|another\s+)?\d/.test(text)) side = lastSide
      if (side) lastSide = side

      if (side && symbol) {
        const parts = text.split(/\b(?:at|@|limit(?: of)?)\b/)
        const head = parts[0]
        const tail = parts.slice(1).join(' ')
        const qtyMatch = head.match(/(\d+(?:\.\d+)?)/)
        const limitMatch = tail.match(/(\d+(?:\.\d+)?)/)
        if (qtyMatch) {
          const step: ScriptStep = {
            kind: 'order',
            symbol,
            side,
            qty: Number(qtyMatch[1]),
            limit: limitMatch ? Number(limitMatch[1]) : undefined,
          }
          if (step.qty > 0) steps.push(step)
        } else {
          problems.push(`“${clause}” needs a quantity, e.g. “${side} 2 ${symbol}”.`)
        }
      } else if (side && !symbol) {
        problems.push(`“${clause}” — I could not find a listed symbol in it.`)
      }
    }

    // focus a symbol without trading it
    if (
      symbol &&
      steps.length === before &&
      /\b(?:show|focus|select|open|switch|look at|watch)\b/.test(text)
    ) {
      steps.push({ kind: 'select', symbol })
    }

    if (steps.length === before) {
      problems.push(`I did not understand “${clause}”.`)
    }
  }

  if (clauses.length === 0) problems.push('Describe what the script should do first.')

  // "2% risk with a 3% stop" arrives as adjacent risk steps; keep one.
  const merged: ScriptStep[] = []
  for (const step of steps) {
    const previous = merged[merged.length - 1]
    if (step.kind === 'risk' && previous?.kind === 'risk') {
      merged[merged.length - 1] = {
        kind: 'risk',
        riskPct: previous.riskPct ?? step.riskPct,
        stopLossPct: previous.stopLossPct ?? step.stopLossPct,
        takeProfitPct: previous.takeProfitPct ?? step.takeProfitPct,
      }
    } else {
      merged.push(step)
    }
  }

  const code =
    merged.length === 0
      ? ''
      : [
          '// Meridian script — generated from your description',
          '// Each line runs with the paper account in this browser.',
          ...merged.map(stepCode),
        ].join('\n')

  return { steps: merged, problems, code }
}

/** A few descriptions that show what the generator understands. */
export const SCRIPT_SAMPLES: { label: string; text: string }[] = [
  {
    label: 'Buy two markets',
    text: 'Buy 2 XAU and 3 JPM at market, then focus XAU.',
  },
  {
    label: 'Bot + risk',
    text: 'Use breakout, set 2% risk with a 3% stop and an 8% target, then start the bot.',
  },
  {
    label: 'Rotate a position',
    text: 'Close my BTC position, sell 0.5 ETH at limit 2300, then pause the bot.',
  },
]
