import { ASSET_CLASSES, type AssetClass } from './market'
import {
  BROKER_DEFS,
  PAPER_BROKER_ID,
  defaultConnections,
  paperConnection,
  type BrokerConnection,
} from './brokers'
import {
  START_CASH,
  startingPortfolio,
  type Fill,
  type Holding,
  type Portfolio,
  type WorkingOrder,
} from './trade'
import { parseEquity, type EquityPoint } from './timeline'
import { AUDIT_LIMIT, type AuditEvent } from './audit'
import type { ExitBook } from './exits'
import {
  DEFAULT_BOT,
  DEFAULT_RISK,
  STRATEGIES,
  type BotConfig,
  type RiskSettings,
  type StrategyId,
} from './bot'
import { newDayAnchor, type DayAnchor } from './risk'

/**
 * Everything the desk saves, and the rules for reading it back.
 *
 * The save is deliberately defensive: an account is worth more than any one
 * field in it, so a half-written or older file loses only the parts that
 * cannot be understood. A rolling copy of the previous save sits beside the
 * current one so a browser that loses a write can still be recovered.
 */

export interface StoredState {
  portfolio: Portfolio
  fills: Fill[]
  /** A longer archive behind the trade log, so closed trades survive reloads. */
  history: Fill[]
  bot: BotConfig
  orders: WorkingOrder[]
  /** Equity samples with the moment each was taken, for the session chart. */
  equity: EquityPoint[]
  brokers: BrokerConnection[]
  activeBroker: string
  /** Venue the ticket picks for each asset class. */
  routes: Partial<Record<AssetClass, string>>
  /** The stop and target each open position was taken with. */
  exits: ExitBook
  /** Why the bot did or did not act, newest first. */
  audit: AuditEvent[]
  /** The equity the current trading day opened at, for the daily loss limit. */
  governor: DayAnchor
}

const STORAGE_KEY = 'kestrel.terminal.v1'
/** A rolling snapshot, kept so a corrupt or half-written save cannot lose the desk. */
const STORAGE_BACKUP_KEY = 'kestrel.terminal.backup.v1'
/** The key written before the rename, read once so the account survives it. */
const LEGACY_STORAGE_KEY = 'meridian.terminal.v1'

function emptyState(): StoredState {
  return {
    portfolio: startingPortfolio(),
    fills: [],
    history: [],
    bot: DEFAULT_BOT,
    orders: [],
    equity: [],
    brokers: defaultConnections(),
    activeBroker: PAPER_BROKER_ID,
    routes: {},
    exits: {},
    audit: [],
    governor: newDayAnchor(START_CASH, Date.now()),
  }
}

/**
 * Rebuilds the bot config. Saves from before per-strategy exits held one shared
 * set, which is kept with the strategy that was armed at the time.
 */
export function loadBot(raw: unknown): BotConfig {
  const stored = (raw && typeof raw === 'object' ? raw : {}) as Partial<BotConfig> &
    Partial<RiskSettings>
  const strategy = STRATEGIES.some((s) => s.id === stored.strategy)
    ? (stored.strategy as StrategyId)
    : DEFAULT_BOT.strategy

  const riskPrefs: Partial<Record<StrategyId, RiskSettings>> = {}
  const savedPrefs = stored.riskPrefs
  if (savedPrefs && typeof savedPrefs === 'object') {
    for (const s of STRATEGIES) {
      const saved = savedPrefs[s.id]
      if (saved) riskPrefs[s.id] = { ...DEFAULT_RISK[s.id], ...saved }
    }
  }
  if (
    !riskPrefs[strategy] &&
    (stored.riskPct !== undefined ||
      stored.stopLossPct !== undefined ||
      stored.takeProfitPct !== undefined)
  ) {
    riskPrefs[strategy] = {
      ...DEFAULT_RISK[strategy],
      ...(typeof stored.riskPct === 'number' ? { riskPct: stored.riskPct } : {}),
      ...(typeof stored.stopLossPct === 'number' ? { stopLossPct: stored.stopLossPct } : {}),
      ...(typeof stored.takeProfitPct === 'number'
        ? { takeProfitPct: stored.takeProfitPct }
        : {}),
    }
  }

  return {
    ...DEFAULT_BOT,
    running: stored.running === true,
    strategy,
    maxAllocPct:
      typeof stored.maxAllocPct === 'number' ? stored.maxAllocPct : DEFAULT_BOT.maxAllocPct,
    classes: Array.isArray(stored.classes)
      ? stored.classes.filter((c): c is AssetClass => ASSET_CLASSES.includes(c))
      : DEFAULT_BOT.classes,
    params: { ...(stored.params ?? {}) },
    routeToBroker: stored.routeToBroker === true,
    riskPrefs,
  }
}

/**
 * Reads a saved terminal, used both for this browser's storage and for a
 * backup file. Returns null when the text is not a usable save.
 */
export function parseState(raw: string | null): StoredState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredState>
    const portfolio = parsed.portfolio
    if (!portfolio || typeof portfolio.cash !== 'number' || typeof portfolio.holdings !== 'object') {
      return null
    }
    const brokers = Array.isArray(parsed.brokers)
      ? parsed.brokers.filter(
          (b): b is BrokerConnection =>
            !!b && BROKER_DEFS.some((d) => d.kind === (b as BrokerConnection).kind),
        )
      : []
    if (!brokers.some((b) => b.kind === 'paper')) brokers.unshift(paperConnection())
    const activeBroker = brokers.some((b) => b.id === parsed.activeBroker)
      ? (parsed.activeBroker as string)
      : PAPER_BROKER_ID
    const routes: Partial<Record<AssetClass, string>> = {}
    const storedRoutes = parsed.routes
    if (storedRoutes && typeof storedRoutes === 'object') {
      for (const cls of ASSET_CLASSES) {
        const id = (storedRoutes as Record<string, unknown>)[cls]
        if (typeof id === 'string' && brokers.some((b) => b.id === id)) routes[cls] = id
      }
    }
    const exits: ExitBook = {}
    const storedExits = parsed.exits
    if (storedExits && typeof storedExits === 'object') {
      for (const [symbol, raw] of Object.entries(storedExits as Record<string, unknown>)) {
        const level = raw as Partial<{ stopLoss: number; takeProfit: number }> | null
        if (
          level &&
          typeof level.stopLoss === 'number' &&
          typeof level.takeProfit === 'number' &&
          Number.isFinite(level.stopLoss) &&
          Number.isFinite(level.takeProfit)
        ) {
          exits[symbol] = { stopLoss: level.stopLoss, takeProfit: level.takeProfit }
        }
      }
    }

    const audit = Array.isArray(parsed.audit)
      ? (parsed.audit as AuditEvent[])
          .filter(
            (e) =>
              !!e &&
              typeof e.ts === 'number' &&
              typeof e.detail === 'string' &&
              typeof e.kind === 'string',
          )
          .slice(0, AUDIT_LIMIT)
      : []
    const storedGovernor = parsed.governor
    const bookValue = Object.values(portfolio.holdings as Record<string, Holding>).reduce(
      (sum, held) => sum + (held?.qty ?? 0) * (held?.avgCost ?? 0),
      portfolio.cash,
    )
    const governor: DayAnchor =
      storedGovernor &&
      typeof storedGovernor.day === 'string' &&
      typeof storedGovernor.startEquity === 'number' &&
      storedGovernor.startEquity > 0
        ? { day: storedGovernor.day, startEquity: storedGovernor.startEquity }
        : newDayAnchor(bookValue, Date.now())

    return {
      portfolio: { ...startingPortfolio(), ...portfolio },
      fills: Array.isArray(parsed.fills) ? parsed.fills.slice(0, 160) : [],
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, 1200) : [],
      bot: loadBot(parsed.bot),
      orders: Array.isArray(parsed.orders) ? parsed.orders.slice(0, 40) : [],
      equity: parseEquity(parsed.equity),
      brokers,
      activeBroker,
      routes,
      exits,
      audit,
      governor,
    }
  } catch {
    return null
  }
}

export function loadState(): StoredState {
  const primary = parseState(
    localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY),
  )
  if (primary) return primary
  const backup = parseState(localStorage.getItem(STORAGE_BACKUP_KEY))
  if (backup) return backup
  return emptyState()
}

/** Backups never carry broker keys, so restored venues ask for them again. */
export function withoutSecrets(state: StoredState): StoredState {
  return {
    ...state,
    brokers: state.brokers.map((b) =>
      b.kind === 'paper'
        ? b
        : {
            ...b,
            key: '',
            secret: '',
            status: 'error' as const,
            message: 'Keys are not part of a backup — re-enter them',
          },
    ),
  }
}

/** What actually goes to storage: trimmed, newest-first, no secrets. */
function serialise(state: StoredState): string {
  const saved = withoutSecrets(state)
  return JSON.stringify({
    portfolio: saved.portfolio,
    fills: saved.fills.slice(0, 80),
    history: saved.history.slice(0, 1200),
    bot: saved.bot,
    orders: saved.orders.slice(0, 40),
    equity: saved.equity.slice(-1200),
    brokers: saved.brokers,
    activeBroker: saved.activeBroker,
    routes: saved.routes,
    exits: saved.exits,
    audit: saved.audit.slice(0, 200),
    governor: saved.governor,
  })
}

let lastBackupAt = 0
const BACKUP_EVERY_MS = 5 * 60_000

/**
 * Writes the desk to this browser, keeping a known-good copy of the previous
 * save every few minutes. Storage is a convenience: a browser with it turned
 * off keeps running, just without the account surviving a reload.
 */
export function saveDesk(state: StoredState, now = Date.now()): boolean {
  try {
    if (now - lastBackupAt > BACKUP_EVERY_MS) {
      const previous = localStorage.getItem(STORAGE_KEY)
      if (previous && parseState(previous)) {
        localStorage.setItem(STORAGE_BACKUP_KEY, previous)
        lastBackupAt = now
      }
    }
    localStorage.setItem(STORAGE_KEY, serialise(state))
    return true
  } catch {
    return false
  }
}
