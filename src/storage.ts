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
import { AUDIT_LIMIT, type AuditEvent, type AuditKind } from './audit'
import type { ExitBook } from './exits'
import type { FillMatch } from './match'
import {
  DEFAULT_BOT,
  DEFAULT_RISK,
  PARAM_DEFS,
  STRATEGIES,
  type BotConfig,
  type RiskSettings,
  type StrategyId,
  type StrategyParams,
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

export const DESK_STORAGE_KEY = 'kestrel.terminal.v1'
/** A rolling snapshot, kept so a corrupt or half-written save cannot lose the desk. */
const STORAGE_BACKUP_KEY = 'kestrel.terminal.backup.v1'
/** The key written before the rename, read once so the account survives it. */
const LEGACY_STORAGE_KEY = 'meridian.terminal.v1'
export const MAX_BACKUP_SIZE = 5_000_000
const MAX_SAVE_CHARS = MAX_BACKUP_SIZE

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

function parseIndicators(raw: unknown): Fill['indicators'] {
  if (!Array.isArray(raw)) return undefined
  const readings = raw.slice(0, 32).filter(
    (item): item is { label: string; value: string } =>
      isRecord(item) &&
      typeof item.label === 'string' &&
      item.label.length <= 100 &&
      typeof item.value === 'string' &&
      item.value.length <= 200,
  )
  return readings
}

function parseFill(raw: unknown): Fill | null {
  if (
    !isRecord(raw) ||
    typeof raw.id !== 'string' ||
    raw.id.length === 0 ||
    raw.id.length > 200 ||
    typeof raw.ts !== 'number' ||
    !Number.isFinite(raw.ts) ||
    typeof raw.symbol !== 'string' ||
    raw.symbol.length === 0 ||
    raw.symbol.length > 32 ||
    (raw.side !== 'buy' && raw.side !== 'sell') ||
    typeof raw.qty !== 'number' ||
    !Number.isFinite(raw.qty) ||
    raw.qty <= 0 ||
    typeof raw.price !== 'number' ||
    !Number.isFinite(raw.price) ||
    raw.price <= 0 ||
    (raw.source !== 'bot' && raw.source !== 'manual') ||
    typeof raw.reason !== 'string' ||
    raw.reason.length > 2000
  ) {
    return null
  }
  const fill: Fill = {
    id: raw.id,
    ts: raw.ts,
    symbol: raw.symbol,
    side: raw.side,
    qty: raw.qty,
    price: raw.price,
    source: raw.source,
    reason: raw.reason,
  }
  if (typeof raw.pnl === 'number' && Number.isFinite(raw.pnl)) fill.pnl = raw.pnl
  if (STRATEGIES.some((strategy) => strategy.id === raw.strategy)) {
    fill.strategy = raw.strategy as StrategyId
  }
  fill.indicators = parseIndicators(raw.indicators)

  const match = raw.match
  if (
    isRecord(match) &&
    STRATEGIES.some((strategy) => strategy.id === match.strategy) &&
    typeof match.name === 'string' &&
    match.name.length <= 100 &&
    typeof match.score === 'number' &&
    Number.isFinite(match.score) &&
    match.score >= 0 &&
    match.score <= 100 &&
    (match.verdict === 'Profitable' ||
      match.verdict === 'Minor loss' ||
      match.verdict === 'Risky') &&
    typeof match.note === 'string' &&
    match.note.length <= 2000
  ) {
    const safeMatch: FillMatch = {
      strategy: match.strategy as StrategyId,
      name: match.name,
      score: match.score,
      verdict: match.verdict,
      note: match.note,
      indicators: parseIndicators(match.indicators),
    }
    fill.match = safeMatch
  }
  return fill
}

function parseFills(raw: unknown, limit: number): Fill[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, limit).map(parseFill).filter((fill): fill is Fill => fill !== null)
}

function parseOrders(raw: unknown): WorkingOrder[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 40).filter(
    (item): item is WorkingOrder =>
      isRecord(item) &&
      typeof item.id === 'string' &&
      item.id.length > 0 &&
      item.id.length <= 200 &&
      typeof item.ts === 'number' &&
      Number.isFinite(item.ts) &&
      typeof item.symbol === 'string' &&
      item.symbol.length > 0 &&
      item.symbol.length <= 32 &&
      (item.side === 'buy' || item.side === 'sell') &&
      typeof item.qty === 'number' &&
      Number.isFinite(item.qty) &&
      item.qty > 0 &&
      typeof item.limit === 'number' &&
      Number.isFinite(item.limit) &&
      item.limit > 0 &&
      (item.status === 'working' || item.status === 'filled' || item.status === 'cancelled') &&
      typeof item.broker === 'string' &&
      item.broker.length <= 100 &&
      typeof item.note === 'string' &&
      item.note.length <= 2000,
  )
}

/**
 * Rebuilds the bot config. Saves from before per-strategy exits held one shared
 * set, which is kept with the strategy that was armed at the time.
 */
export function loadBot(raw: unknown): BotConfig {
  const stored = (isRecord(raw) ? raw : {}) as Partial<BotConfig> & Partial<RiskSettings>
  const strategy = STRATEGIES.some((s) => s.id === stored.strategy)
    ? (stored.strategy as StrategyId)
    : DEFAULT_BOT.strategy
  const migratedRisk = stored.riskSizingVersion !== 1

  const riskPrefs: Partial<Record<StrategyId, RiskSettings>> = {}
  const savedPrefs = isRecord(stored.riskPrefs) ? stored.riskPrefs : {}
  if (Object.keys(savedPrefs).length > 0) {
    for (const s of STRATEGIES) {
      const saved = savedPrefs[s.id]
      if (!isRecord(saved)) continue
      const defaults = DEFAULT_RISK[s.id]
      const stopLossPct = boundedNumber(saved.stopLossPct, defaults.stopLossPct, 1, 10)
      const hasSavedRisk = typeof saved.riskPct === 'number' && Number.isFinite(saved.riskPct)
      const previousSizingPct = boundedNumber(saved.riskPct, defaults.riskPct, 1, 10)
      riskPrefs[s.id] = {
        riskPct: migratedRisk && hasSavedRisk
          ? boundedNumber(
              (previousSizingPct * stopLossPct) / 100,
              defaults.riskPct,
              0.01,
              3,
            )
          : boundedNumber(saved.riskPct, defaults.riskPct, 0.01, 3),
        stopLossPct,
        takeProfitPct: boundedNumber(saved.takeProfitPct, defaults.takeProfitPct, 2, 25),
      }
    }
  }
  if (
    !riskPrefs[strategy] &&
    (stored.riskPct !== undefined ||
      stored.stopLossPct !== undefined ||
      stored.takeProfitPct !== undefined)
  ) {
    const stopLossPct = boundedNumber(
      stored.stopLossPct,
      DEFAULT_RISK[strategy].stopLossPct,
      1,
      10,
    )
    const previousSizingPct = boundedNumber(
      stored.riskPct,
      DEFAULT_RISK[strategy].riskPct,
      1,
      10,
    )
    const hasSavedRisk = typeof stored.riskPct === 'number' && Number.isFinite(stored.riskPct)
    riskPrefs[strategy] = {
      ...DEFAULT_RISK[strategy],
      riskPct: migratedRisk && hasSavedRisk
        ? boundedNumber(
            (previousSizingPct * stopLossPct) / 100,
            DEFAULT_RISK[strategy].riskPct,
            0.01,
            3,
          )
        : boundedNumber(stored.riskPct, DEFAULT_RISK[strategy].riskPct, 0.01, 3),
      stopLossPct,
      takeProfitPct: boundedNumber(
        stored.takeProfitPct,
        DEFAULT_RISK[strategy].takeProfitPct,
        2,
        25,
      ),
    }
  }

  const params: StrategyParams = {}
  const savedParams = isRecord(stored.params) ? stored.params : {}
  for (const s of STRATEGIES) {
    const values = savedParams[s.id]
    if (!isRecord(values)) continue
    const safe: Record<string, number> = {}
    for (const def of PARAM_DEFS[s.id]) {
      const value = values[def.key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        safe[def.key] = Math.min(def.max, Math.max(def.min, value))
      }
    }
    if (Object.keys(safe).length > 0) params[s.id] = safe
  }

  return {
    ...DEFAULT_BOT,
    running: stored.running === true,
    strategy,
    strategyMode: stored.strategyMode === 'market-fit' ? 'market-fit' : 'fixed',
    maxAllocPct: boundedNumber(stored.maxAllocPct, DEFAULT_BOT.maxAllocPct, 20, 100),
    classes: Array.isArray(stored.classes)
      ? stored.classes.filter((c): c is AssetClass => ASSET_CLASSES.includes(c))
      : DEFAULT_BOT.classes,
    params,
    routeToBroker: stored.routeToBroker === true,
    riskPrefs,
  }
}

/**
 * Reads a saved terminal, used both for this browser's storage and for a
 * backup file. Returns null when the text is not a usable save.
 */
export function parseState(raw: string | null): StoredState | null {
  if (!raw || raw.length > MAX_SAVE_CHARS) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredState>
    const portfolio = parsed.portfolio
    if (
      !portfolio ||
      typeof portfolio.cash !== 'number' ||
      !Number.isFinite(portfolio.cash) ||
      portfolio.cash < 0 ||
      !portfolio.holdings ||
      typeof portfolio.holdings !== 'object' ||
      Array.isArray(portfolio.holdings)
    ) {
      return null
    }
    const holdings: Record<string, Holding> = Object.create(null)
    for (const [symbol, rawHolding] of Object.entries(portfolio.holdings)) {
      if (
        !rawHolding ||
        typeof rawHolding !== 'object' ||
        typeof rawHolding.qty !== 'number' ||
        !Number.isFinite(rawHolding.qty) ||
        rawHolding.qty <= 0 ||
        typeof rawHolding.avgCost !== 'number' ||
        !Number.isFinite(rawHolding.avgCost) ||
        rawHolding.avgCost <= 0
      ) {
        return null
      }
      holdings[symbol] = { qty: rawHolding.qty, avgCost: rawHolding.avgCost }
    }
    const realized = portfolio.realized ?? 0
    const deposited = portfolio.deposited ?? START_CASH
    if (
      typeof realized !== 'number' ||
      !Number.isFinite(realized) ||
      typeof deposited !== 'number' ||
      !Number.isFinite(deposited) ||
      deposited <= 0
    ) {
      return null
    }
    const safePortfolio: Portfolio = {
      ...startingPortfolio(),
      cash: portfolio.cash,
      holdings,
      realized,
      deposited,
    }
    const brokers: BrokerConnection[] = [paperConnection()]
    const brokerKinds = new Set<string>(['paper'])
    const brokerIds = new Set<string>([PAPER_BROKER_ID])
    if (Array.isArray(parsed.brokers)) {
      for (const rawBroker of parsed.brokers) {
        if (!isRecord(rawBroker)) continue
        const def = BROKER_DEFS.find((candidate) => candidate.kind === rawBroker.kind)
        if (
          !def ||
          def.kind === 'paper' ||
          brokerKinds.has(def.kind) ||
          typeof rawBroker.id !== 'string' ||
          rawBroker.id.length === 0 ||
          rawBroker.id.length > 120 ||
          brokerIds.has(rawBroker.id) ||
          typeof rawBroker.label !== 'string' ||
          rawBroker.label.length > 100 ||
          typeof rawBroker.endpoint !== 'string' ||
          rawBroker.endpoint.length > 2048 ||
          typeof rawBroker.key !== 'string' ||
          rawBroker.key.length > 4096 ||
          typeof rawBroker.secret !== 'string' ||
          rawBroker.secret.length > 4096 ||
          typeof rawBroker.message !== 'string' ||
          rawBroker.message.length > 1000
        ) {
          continue
        }
        const broker: BrokerConnection = {
          id: rawBroker.id,
          kind: def.kind,
          label: rawBroker.label,
          endpoint: rawBroker.endpoint,
          key: rawBroker.key,
          secret: rawBroker.secret,
          status: rawBroker.status === 'linked' ? 'linked' : 'error',
          message: rawBroker.message,
        }
        if (typeof rawBroker.accountPath === 'string' && rawBroker.accountPath.length <= 512) {
          broker.accountPath = rawBroker.accountPath
        }
        if (typeof rawBroker.orderPath === 'string' && rawBroker.orderPath.length <= 512) {
          broker.orderPath = rawBroker.orderPath
        }
        if (typeof rawBroker.checkedAt === 'number' && Number.isFinite(rawBroker.checkedAt)) {
          broker.checkedAt = rawBroker.checkedAt
        }
        brokers.push(broker)
        brokerKinds.add(def.kind)
        brokerIds.add(broker.id)
      }
    }
    const activeBroker = brokers.some((b) => b.id === parsed.activeBroker)
      ? (parsed.activeBroker as string)
      : PAPER_BROKER_ID
    const routes: Partial<Record<AssetClass, string>> = {}
    const storedRoutes = parsed.routes
    if (isRecord(storedRoutes)) {
      for (const cls of ASSET_CLASSES) {
        const id = (storedRoutes as Record<string, unknown>)[cls]
        if (typeof id === 'string' && brokers.some((b) => b.id === id)) routes[cls] = id
      }
    }
    const exits: ExitBook = {}
    const storedExits = parsed.exits
    if (storedExits && typeof storedExits === 'object') {
      for (const [symbol, raw] of Object.entries(storedExits as Record<string, unknown>)) {
        const level = isRecord(raw) ? raw : null
        if (
          symbol.length > 0 &&
          symbol.length <= 32 &&
          level &&
          typeof level.stopLoss === 'number' &&
          typeof level.takeProfit === 'number' &&
          Number.isFinite(level.stopLoss) &&
          Number.isFinite(level.takeProfit) &&
          level.stopLoss > 0 &&
          level.takeProfit > level.stopLoss
        ) {
          exits[symbol] = { stopLoss: level.stopLoss, takeProfit: level.takeProfit }
        }
      }
    }

    const auditKinds: AuditKind[] = [
      'trade',
      'block',
      'streak',
      'graduation',
      'session',
      'stale',
      'feed',
      'order',
      'halt',
      'resume',
    ]
    const audit = Array.isArray(parsed.audit)
      ? parsed.audit.slice(0, AUDIT_LIMIT).filter(
          (event): event is AuditEvent =>
            isRecord(event) &&
            typeof event.id === 'string' &&
            event.id.length <= 200 &&
            typeof event.ts === 'number' &&
            Number.isFinite(event.ts) &&
            typeof event.kind === 'string' &&
            auditKinds.includes(event.kind as AuditKind) &&
            typeof event.detail === 'string' &&
            event.detail.length <= 2000 &&
            (event.subject === undefined ||
              (typeof event.subject === 'string' && event.subject.length <= 100)),
        )
      : []
    const storedGovernor = parsed.governor
    const bookValue = Object.values(safePortfolio.holdings).reduce(
      (sum, held) => sum + (held?.qty ?? 0) * (held?.avgCost ?? 0),
      safePortfolio.cash,
    )
    if (!Number.isFinite(bookValue)) return null
    const governor: DayAnchor =
      storedGovernor &&
      typeof storedGovernor.day === 'string' &&
      storedGovernor.day.length <= 16 &&
      typeof storedGovernor.startEquity === 'number' &&
      Number.isFinite(storedGovernor.startEquity) &&
      storedGovernor.startEquity > 0
        ? { day: storedGovernor.day, startEquity: storedGovernor.startEquity }
        : newDayAnchor(bookValue, Date.now())

    return {
      portfolio: safePortfolio,
      fills: parseFills(parsed.fills, 160),
      history: parseFills(parsed.history, 1200),
      bot: loadBot(parsed.bot),
      orders: parseOrders(parsed.orders),
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
  try {
    expectedPrimary = localStorage.getItem(DESK_STORAGE_KEY)
    const primary = parseState(
      expectedPrimary ?? localStorage.getItem(LEGACY_STORAGE_KEY),
    )
    if (primary) return primary
    const backup = parseState(localStorage.getItem(STORAGE_BACKUP_KEY))
    if (backup) return backup
  } catch {
    // Storage can be disabled or unavailable; the desk still works in memory.
    expectedPrimary = null
  }
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
let expectedPrimary: string | null = null
const BACKUP_EVERY_MS = 5 * 60_000

/**
 * Writes the desk to this browser, keeping a known-good copy of the previous
 * save every few minutes. Storage is a convenience: a browser with it turned
 * off keeps running, just without the account surviving a reload.
 */
export function saveDesk(state: StoredState, now = Date.now()): boolean {
  try {
    const current = localStorage.getItem(DESK_STORAGE_KEY)
    if (current !== expectedPrimary) return false
    if (now - lastBackupAt > BACKUP_EVERY_MS) {
      if (current && parseState(current)) {
        localStorage.setItem(STORAGE_BACKUP_KEY, current)
        lastBackupAt = now
      }
    }
    const next = serialise(state)
    localStorage.setItem(DESK_STORAGE_KEY, next)
    expectedPrimary = next
    return true
  } catch {
    return false
  }
}
