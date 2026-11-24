import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CLASS_COLOR,
  CRYPTO_SYMBOLS,
  MarketEngine,
  changePct,
  type AssetClass,
  type Instrument,
  type QuoteUpdate,
} from './market'
import {
  STRATEGIES,
  patchRisk,
  riskFor,
  runBotStep,
  type BotConfig,
  type BotIntent,
  type RiskSettings,
  type StrategyId,
} from './bot'
import {
  START_CASH,
  applyOrder,
  limitReached,
  startingPortfolio,
  type Fill,
  type Holding,
  type IndicatorReading,
  type OrderType,
  type Portfolio,
  type Side,
  type WorkingOrder,
} from './trade'
import {
  PAPER_BROKER_ID,
  paperConnection,
  submitBrokerOrder,
  venueSymbol,
  type BrokerConnection,
} from './brokers'
import { clockTime, money, price as fmtPrice, signedPct } from './format'
import { exitHit, exitsFrom, type ExitBook } from './exits'
import { fetchLiveQuotes } from './liveQuotes'
import { matchFill, strategyRecords } from './match'
import {
  consecutiveLosses,
  entriesToday,
  evaluateRisk,
  rollDay,
  type DayAnchor,
  type RiskBlock,
} from './risk'
import { closedNote, marketState, quoteStale } from './session'
import { noteOnce, type AuditEvent, type AuditKind } from './audit'
import type { EquityPoint } from './timeline'
import {
  clearProfile,
  loadProfile,
  loadSettings,
  saveProfile,
  saveSettings,
  type Profile,
  type Proposal,
  type Settings,
} from './settings'
import type { KestrelApi, ScriptStep } from './scripts'
import type { ChartPlan, PlanLevel } from './chartPlan'
import Watchlist from './components/Watchlist'
import PriceChart from './components/PriceChart'
import TradeTicket from './components/TradeTicket'
import PositionCard from './components/PositionCard'
import AccountPanel from './components/AccountPanel'
import TradeLog from './components/TradeLog'
import Positions from './components/Positions'
import BotPanel from './components/BotPanel'
import Activity from './components/Activity'
import WorkingOrders from './components/WorkingOrders'
import Brokers from './components/Brokers'
import BacktestPanel from './components/BacktestPanel'
import ScriptsPanel from './components/ScriptsPanel'
import ScanPanel from './components/ScanPanel'
import StrategiesTab from './components/StrategiesTab'
import PerformanceChart from './components/PerformanceChart'
import DeskLog from './components/DeskLog'
import Proposals from './components/Proposals'
import SettingsView from './components/SettingsView'
import LoginScreen from './components/LoginScreen'
import Topbar from './components/Topbar'
import AnalyticsPanel from './components/AnalyticsPanel'
import RiskPanel from './components/RiskPanel'
import Reconciliation from './components/Reconciliation'
import { loadState, parseState, saveDesk, withoutSecrets, type StoredState } from './storage'
import { catchUp, humanSpan, requestWakeLock, TICK_MS } from './scheduler'
import {
  startBridgeStream,
  startCoinbaseStream,
  type StreamStatus,
} from './quoteStream'


const RANGES = [
  { id: '1H', points: 60 },
  { id: '1D', points: 160 },
  { id: '1W', points: 320 },
] as const

type RangeId = (typeof RANGES)[number]['id']

type ViewId =
  | 'trade'
  | 'scan'
  | 'strategies'
  | 'trades'
  | 'bot'
  | 'brokers'
  | 'scripts'
  | 'settings'

const VIEWS: { id: ViewId; label: string; short: string; hint: string }[] = [
  { id: 'trade', label: 'Desk', short: 'Desk', hint: 'Chart & ticket' },
  { id: 'scan', label: 'Scan', short: 'Scan', hint: 'Ranked signals' },
  { id: 'strategies', label: 'Strategies', short: 'Models', hint: 'Models & indicators' },
  { id: 'trades', label: 'Trades', short: 'Trades', hint: 'Positions & fills' },
  { id: 'bot', label: 'Test lab', short: 'Test', hint: 'Strategy & backtest' },
  { id: 'scripts', label: 'Scripts', short: 'Scripts', hint: 'Chart or plain English' },
  { id: 'brokers', label: 'Brokers', short: 'Brokers', hint: 'Venues & keys' },
  { id: 'settings', label: 'Setup', short: 'Setup', hint: 'Profile & approvals' },
]

/** One compact stroke icon per tab, drawn to match the rest of the chrome. */
const DOCK_ICONS: Record<ViewId, ReactNode> = {
  trade: <polyline points="3 13 7 13 10 5.5 14 18.5 17 11 21 11" />,
  strategies: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.6v2.2" />
      <path d="M12 18.2v2.2" />
    </>
  ),
  scan: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  trades: (
    <>
      <path d="M4 20V11" />
      <path d="M10 20V4" />
      <path d="M16 20v-6" />
      <path d="M22 20H2" />
    </>
  ),
  bot: (
    <>
      <path d="M9 3h6" />
      <path d="M10 3v5l-4.7 7.8A3 3 0 0 0 7.9 21h8.2a3 3 0 0 0 2.6-5.2L14 8V3" />
      <path d="M7.6 15h8.8" />
    </>
  ),
  scripts: (
    <>
      <path d="m8.5 8-4.5 4 4.5 4" />
      <path d="m15.5 8 4.5 4-4.5 4" />
    </>
  ),
  brokers: (
    <>
      <path d="M9 3v6" />
      <path d="M15 3v6" />
      <path d="M6 9h12v3a6 6 0 0 1-12 0V9Z" />
      <path d="M12 18v3" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9" />
      <path d="M19 7h1" />
      <circle cx="15.5" cy="7" r="2.2" />
      <path d="M4 17h1" />
      <path d="M11 17h9" />
      <circle cx="8.5" cy="17" r="2.2" />
    </>
  ),
}

export default function App() {
  const engineRef = useRef<MarketEngine | null>(null)
  if (!engineRef.current) engineRef.current = new MarketEngine()
  const engine = engineRef.current

  const [initial] = useState(loadState)
  const [portfolio, setPortfolio] = useState<Portfolio>(initial.portfolio)
  const portfolioRef = useRef(portfolio)
  const [fills, setFills] = useState<Fill[]>(initial.fills)
  const [tradeHistory, setTradeHistory] = useState<Fill[]>(initial.history)
  const [auditLog, setAuditLog] = useState<AuditEvent[]>(initial.audit)
  const auditRef = useRef(auditLog)
  const [governor, setGovernor] = useState<DayAnchor>(initial.governor)
  const governorRef = useRef(governor)
  /** Latest risk verdict and day anchor, refreshed every render for the scan loop. */
  const riskBlocksRef = useRef<RiskBlock[]>([])
  const dayAnchorRef = useRef<DayAnchor>(initial.governor)
  const [bot, setBot] = useState<BotConfig>(initial.bot)
  const botRef = useRef(bot)
  const cooldownsRef = useRef<Record<string, number>>({})
  const tickRef = useRef(0)

  const [orders, setOrders] = useState<WorkingOrder[]>(initial.orders)
  const ordersRef = useRef(orders)
  const [exits, setExits] = useState<ExitBook>(initial.exits)
  const exitsRef = useRef(exits)
  const [equitySeries, setEquitySeries] = useState<EquityPoint[]>(initial.equity)
  /** What the last live quote pull returned, so the header can say what is real. */
  const [quoteFeed, setQuoteFeed] = useState<{
    at: number
    live: number
    sources: { name: string; detail: string }[]
    failed: string[]
  }>({ at: 0, live: 0, sources: [], failed: [] })
  const [brokers, setBrokers] = useState<BrokerConnection[]>(initial.brokers)
  const brokersRef = useRef(brokers)
  const [activeBroker, setActiveBroker] = useState<string>(initial.activeBroker)
  const activeBrokerRef = useRef(activeBroker)
  const routingRef = useRef(false)
  const [routes, setRoutes] = useState<Partial<Record<AssetClass, string>>>(initial.routes)
  const routesRef = useRef(routes)

  const [selected, setSelected] = useState('XAU')
  const selectedRef = useRef(selected)
  const [filter, setFilter] = useState<AssetClass | 'All'>('All')
  const [range, setRange] = useState<RangeId>('1D')
  const [view, setView] = useState<ViewId>('trade')
  const [planLevels, setPlanLevels] = useState<{ symbol: string; levels: PlanLevel[] } | null>(null)
  const [now, setNow] = useState(Date.now())
  const mainRef = useRef<HTMLElement | null>(null)

  const [profile, setProfile] = useState<Profile | null>(loadProfile)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const settingsRef = useRef(settings)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const proposalsRef = useRef(proposals)

  // Live quotes: crypto from Coinbase, spot metals from gold-api and the daily
  // FX fix from open.er-api, all key-less and open to the browser. Stocks and
  // energy have no such feed, so they keep the simulated tape.
  useEffect(() => {
    let cancelled = false
    const pull = async () => {
      const snapshot = await fetchLiveQuotes()
      if (cancelled) return
      const applied = engine.applyLive(snapshot.quotes)
      setQuoteFeed({
        at: snapshot.at,
        live: applied,
        sources: snapshot.sources,
        failed: snapshot.failed,
      })
      if (applied > 0) setNow(Date.now())
    }
    void pull()
    const id = window.setInterval(() => void pull(), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [engine])

  // A real stream sits in front of that poll: Coinbase's public ticker socket
  // pushes crypto as it trades, and an SSE bridge you run yourself can cover
  // stocks and energy, which have no key-less feed the browser may call.
  const [streamStatus, setStreamStatus] = useState<StreamStatus>({
    state: 'idle',
    detail: 'Not connected yet',
    at: 0,
  })
  const [bridgeStatus, setBridgeStatus] = useState<StreamStatus>({
    state: 'idle',
    detail: 'No bridge configured',
    at: 0,
  })
  /** Quotes that arrived between two flushes, applied in one batch. */
  const pendingQuotesRef = useRef<Record<string, QuoteUpdate>>({})

  useEffect(() => {
    const push = (quotes: Record<string, QuoteUpdate>) => {
      Object.assign(pendingQuotesRef.current, quotes)
    }
    const stopSocket = startCoinbaseStream(CRYPTO_SYMBOLS, {
      onQuotes: push,
      onStatus: setStreamStatus,
    })
    const bridgeUrl = settings.streamUrl.trim()
    const stopBridge = bridgeUrl ? startBridgeStream(bridgeUrl, {
      onQuotes: push,
      onStatus: setBridgeStatus,
    }) : () => {}
    return () => {
      stopSocket()
      stopBridge()
    }
  }, [settings.streamUrl])

  // Applied on a short clock rather than per frame, so a busy tape cannot
  // cause a render per trade.
  useEffect(() => {
    const id = window.setInterval(() => {
      const batch = pendingQuotesRef.current
      if (Object.keys(batch).length === 0) return
      pendingQuotesRef.current = {}
      if (engine.applyLive(batch) > 0) setNow(Date.now())
    }, 250)
    return () => window.clearInterval(id)
  }, [engine])

  useEffect(() => {
    botRef.current = bot
  }, [bot])

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  // The visible fills only keep the newest 160. Every fill is also appended to
  // the trade archive by id, so round trips survive long after they scroll out
  // of the activity feed and across reloads.
  useEffect(() => {
    if (fills.length === 0) return
    setTradeHistory((prev) => {
      const seen = new Set(prev.map((f) => f.id))
      const fresh = fills.filter((f) => !seen.has(f.id))
      return fresh.length === 0 ? prev : [...fresh, ...prev].slice(0, 1200)
    })
  }, [fills])

  useEffect(() => {
    proposalsRef.current = proposals
  }, [proposals])

  /**
   * Parks the bot's signals in the approvals inbox. One pending proposal per
   * market and direction at a time, so a repeated scan cannot stack duplicates.
   */
  const enqueueProposals = useCallback((intents: BotIntent[]) => {
    setProposals((prev) => {
      const fresh = intents
        .filter(
          (intent) =>
            !prev.some(
              (p) =>
                p.status === 'pending' &&
                p.symbol === intent.symbol &&
                p.side === intent.side,
            ),
        )
        .map<Proposal>((intent, i) => ({
          id: `prop-${Date.now()}-${i}-${intent.symbol}`,
          ts: Date.now(),
          symbol: intent.symbol,
          side: intent.side,
          qty: intent.qty,
          price: intent.price,
          reason: intent.reason,
          status: 'pending',
          strategy: intent.strategy,
          indicators: intent.indicators,
        }))
      return [...fresh, ...prev].slice(0, 20)
    })
  }, [])

  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0
  }, [view])

  const equityOf = useCallback(
    (pf: Portfolio) =>
      pf.cash +
      Object.entries(pf.holdings).reduce(
        (sum, [symbol, held]) => sum + held.qty * (engine.get(symbol)?.price ?? 0),
        0,
      ),
    [engine],
  )

  /**
   * Stamps the stop and target on a position when its opening fill is booked,
   * using the settings of the strategy that opened it — the armed model for a
   * manual trade, the proposal's model for an approved one. A target is set
   * once per trade: adding to the position or arming another strategy never
   * moves it, and a closed position forgets its levels.
   */
  const syncExits = useCallback(
    (pf: Portfolio, booked: Fill[]) => {
      const next: ExitBook = { ...exitsRef.current }
      let changed = false
      for (const fill of booked) {
        const held = pf.holdings[fill.symbol]
        if (!held) {
          if (next[fill.symbol]) {
            delete next[fill.symbol]
            changed = true
          }
          continue
        }
        const ins = engine.get(fill.symbol)
        if (fill.side !== 'buy' || !ins) continue
        if (next[fill.symbol]) continue
        const risk = riskFor(botRef.current, fill.strategy ?? botRef.current.strategy)
        next[fill.symbol] = exitsFrom(held.avgCost, risk, ins.dp)
        changed = true
      }
      if (!changed) return
      exitsRef.current = next
      setExits(next)
    },
    [engine],
  )

  const historyRef = useRef<Fill[]>(tradeHistory)
  useEffect(() => {
    historyRef.current = tradeHistory
  }, [tradeHistory])

  useEffect(() => {
    auditRef.current = auditLog
  }, [auditLog])

  /** Appends to the desk log, collapsing a condition that merely persists. */
  const logEvent = useCallback(
    (event: { kind: AuditKind; subject?: string; detail: string }) => {
      const next = noteOnce(auditRef.current, event)
      if (next === auditRef.current) return
      auditRef.current = next
      setAuditLog(next)
    },
    [],
  )

  /**
   * Stamps each fresh fill with the model that best explains it — the read on
   * the tape at that moment plus that model's record on this account — so the
   * log can mark it profitable, a minor loss or risky.
   */
  const withMatches = useCallback(
    (booked: Fill[]) => {
      if (booked.length === 0) return booked
      const records = strategyRecords(historyRef.current)
      return booked.map((fill) => {
        if (fill.match) return fill
        const ins = engine.get(fill.symbol)
        if (!ins) return fill
        return { ...fill, match: matchFill(ins, fill.side, botRef.current, records) }
      })
    },
    [engine],
  )

  /**
   * Sends the bot's proposed orders to the routed venue one by one and books
   * only the ones the venue accepts. One batch is in flight at a time so a slow
   * venue cannot pile up duplicate orders.
   */
  const dispatchBotIntents = useCallback(async (intents: BotIntent[], conn: BrokerConnection) => {
    routingRef.current = true
    let pf = portfolioRef.current
    const booked: Fill[] = []
    let lastMessage: string | null = null
    let failed = false
    try {
      for (const intent of intents) {
        if (!venueSymbol(conn.kind, intent.symbol)) continue
        const routed = await submitBrokerOrder(conn, {
          symbol: intent.symbol,
          side: intent.side,
          qty: intent.qty,
          price: intent.price,
        })
        lastMessage = routed.message
        if (!routed.ok) {
          failed = true
          continue
        }
        const result = applyOrder(pf, intent.symbol, intent.price, intent.side, intent.qty)
        if (!result.ok) continue
        pf = result.portfolio
        booked.push({
          id: `bot-${Date.now()}-${intent.symbol}-${intent.side}`,
          ts: Date.now(),
          symbol: intent.symbol,
          side: intent.side,
          qty: intent.qty,
          price: intent.price,
          source: 'bot',
          reason: `${intent.reason} · filled by ${conn.label}`,
          pnl: result.pnl,
          strategy: intent.strategy,
          indicators: intent.indicators,
        })
      }
      if (booked.length > 0) {
        portfolioRef.current = pf
        setPortfolio(pf)
        setFills((prev) => [...withMatches(booked), ...prev].slice(0, 160))
        syncExits(pf, booked)
      }
      if (lastMessage) {
        const next = brokersRef.current.map((b) =>
          b.id === conn.id
            ? {
                ...b,
                message: lastMessage as string,
                checkedAt: Date.now(),
                status: failed ? ('error' as const) : b.status,
              }
            : b,
        )
        brokersRef.current = next
        setBrokers(next)
      }
    } finally {
      routingRef.current = false
    }
  }, [syncExits, withMatches])

  /**
   * One scan of the desk: advance the tape, roll the day, run the bot, fill
   * resting limits and evaluate stops and targets. It used to live inside the
   * interval; lifting it out is what lets a wake-up after a background pause
   * replay the scans it missed.
   */
  const step = useCallback(() => {
    engine.tick()

    tickRef.current += 1
    setNow(Date.now())

    // Roll the day's equity anchor at local midnight, so the daily loss
    // limit resets without a reload.
    if (dayAnchorRef.current.day !== governorRef.current.day) {
      governorRef.current = dayAnchorRef.current
      setGovernor(dayAnchorRef.current)
    }

    const blocks = riskBlocksRef.current
    const scannedAt = Date.now()
    /** Asked before every entry; exits are never blocked. */
    const entryBlock = (ins: Instrument): string | null => {
      const top = blocks[0]
      if (top) {
        logEvent({ kind: 'block', subject: ins.symbol, detail: top.reason })
        return top.reason
      }
      if (marketState(ins.cls) === 'closed') {
        const why = closedNote(ins.cls)
        logEvent({ kind: 'session', subject: ins.symbol, detail: why })
        return why
      }
      const maxAge = settingsRef.current.limits.maxQuoteAgeSec * 1000
      if (quoteStale(ins, scannedAt, maxAge)) {
        const why = `${ins.symbol} quote is older than ${settingsRef.current.limits.maxQuoteAgeSec}s`
        logEvent({ kind: 'stale', subject: ins.symbol, detail: why })
        return why
      }
      return null
    }

    if (botRef.current.running) {
      const venue = botRef.current.routeToBroker
        ? brokersRef.current.find((b) => b.id === activeBrokerRef.current)
        : undefined
      if (settingsRef.current.requireApproval) {
        // Approval mode: the scan only proposes, the trader decides.
        const plan = runBotStep(
          engine.instruments,
          portfolioRef.current,
          botRef.current,
          cooldownsRef.current,
          tickRef.current,
          true,
          exitsRef.current,
          entryBlock,
        )
        if (plan.intents.length > 0) enqueueProposals(plan.intents)
      } else if (venue && venue.kind !== 'paper') {
        if (!routingRef.current) {
          const plan = runBotStep(
            engine.instruments,
            portfolioRef.current,
            botRef.current,
            cooldownsRef.current,
            tickRef.current,
            true,
            exitsRef.current,
            entryBlock,
          )
          if (plan.intents.length > 0) void dispatchBotIntents(plan.intents, venue)
        }
      } else {
        const result = runBotStep(
          engine.instruments,
          portfolioRef.current,
          botRef.current,
          cooldownsRef.current,
          tickRef.current,
          false,
          exitsRef.current,
          entryBlock,
        )
        if (result.fills.length > 0) {
          portfolioRef.current = result.portfolio
          setPortfolio(result.portfolio)
          setFills((prev) => [...withMatches(result.fills), ...prev].slice(0, 160))
          syncExits(result.portfolio, result.fills)
        }
      }
    }

    // resting limit orders: fill when the market trades through the price
    if (ordersRef.current.some((order) => order.status === 'working')) {
      let pf = portfolioRef.current
      const fillsNow: Fill[] = []
      const next: WorkingOrder[] = ordersRef.current.map((order) => {
        if (order.status !== 'working') return order
        const ins = engine.get(order.symbol)
        if (!ins) return { ...order, status: 'cancelled', note: 'Instrument unavailable' }
        if (!limitReached(order, ins.price)) return order
        const result = applyOrder(pf, order.symbol, ins.price, order.side, order.qty)
        if (!result.ok) return { ...order, status: 'cancelled', note: result.error }
        pf = result.portfolio
        fillsNow.push({
          id: `limit-${order.id}`,
          ts: Date.now(),
          symbol: order.symbol,
          side: order.side,
          qty: order.qty,
          price: ins.price,
          source: 'manual',
          reason: `Limit order filled at ${fmtPrice(ins.price, ins.dp)}`,
          pnl: result.pnl,
        })
        return { ...order, status: 'filled', note: `Filled at ${fmtPrice(ins.price, ins.dp)}` }
      })
      ordersRef.current = next
      setOrders(next)
      if (fillsNow.length > 0) {
        portfolioRef.current = pf
        setPortfolio(pf)
        setFills((prev) => [...withMatches(fillsNow), ...prev].slice(0, 160))
        syncExits(pf, fillsNow)
      }
    }

    // attached stops and targets: whatever opened the trade — the bot, a
    // chart plan, a script or the ticket — it closes when either level hits
    const book = exitsRef.current
    if (Object.keys(book).length > 0) {
      let pf = portfolioRef.current
      const exitFills: Fill[] = []
      let nextBook: ExitBook | null = null
      for (const [symbol, exit] of Object.entries(book)) {
        const held = pf.holdings[symbol]
        const ins = engine.get(symbol)
        if (!held || !ins) {
          nextBook = { ...(nextBook ?? book) }
          delete nextBook[symbol]
          continue
        }
        const hit = exitHit(exit, ins.price)
        if (!hit) continue
        const result = applyOrder(pf, symbol, ins.price, 'sell', held.qty)
        if (!result.ok) continue
        pf = result.portfolio
        nextBook = { ...(nextBook ?? book) }
        delete nextBook[symbol]
        exitFills.push({
          id: `exit-${Date.now()}-${symbol}`,
          ts: Date.now(),
          symbol,
          side: 'sell',
          qty: held.qty,
          price: ins.price,
          source: 'manual',
          reason:
            hit === 'stop'
              ? `Stop loss hit at ${fmtPrice(ins.price, ins.dp)}`
              : `Take profit hit at ${fmtPrice(ins.price, ins.dp)}`,
          pnl: result.pnl,
        })
      }
      if (nextBook) {
        exitsRef.current = nextBook
        setExits(nextBook)
      }
      if (exitFills.length > 0) {
        portfolioRef.current = pf
        setPortfolio(pf)
        setFills((prev) => [...exitFills, ...prev].slice(0, 160))
      }
    }

    const equityNow = equityOf(portfolioRef.current)
    const sampledAt = Date.now()
    setEquitySeries((prev) => {
      const lastPoint = prev[prev.length - 1]
      if (lastPoint && Math.abs(lastPoint.v - equityNow) < 0.005) return prev
      return [...prev, { t: sampledAt, v: equityNow }].slice(-1200)
    })
  }, [engine, equityOf, dispatchBotIntents, enqueueProposals, syncExits, logEvent])

  const lastScanRef = useRef(Date.now())

  useEffect(() => {
    const id = window.setInterval(() => {
      lastScanRef.current = Date.now()
      step()
    }, TICK_MS)

    // Browsers throttle timers in a hidden tab and Android may pause the
    // WebView outright. On return, replay the scans that were missed so stops,
    // targets and limits are judged against the tape as it is now — and say so
    // in the desk log, because a silent gap is indistinguishable from a broken
    // bot.
    const onVisibility = () => {
      if (document.hidden) {
        logEvent({
          kind: 'halt',
          detail: 'Desk went to the background — scans pause here and catch up on return',
        })
        return
      }
      const plan = catchUp(lastScanRef.current, Date.now())
      for (let i = 0; i < plan.scans; i += 1) step()
      lastScanRef.current = Date.now()
      logEvent({
        kind: 'resume',
        detail:
          plan.scans > 0
            ? `Caught up ${plan.scans} scan${plan.scans === 1 ? '' : 's'} after ${humanSpan(
                plan.stalledMs,
              )} in the background`
            : `Back in the foreground after ${humanSpan(plan.stalledMs)}`,
      })
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [step, logEvent])

  // The whole desk, written to this browser on every change. The storage
  // module keeps a known-good fallback copy behind it.
  useEffect(() => {
    saveDesk({
      portfolio,
      fills,
      history: tradeHistory,
      bot,
      orders,
      equity: equitySeries,
      brokers,
      activeBroker,
      routes,
      exits,
      audit: auditLog,
      governor,
    })
  }, [
    portfolio,
    fills,
    tradeHistory,
    bot,
    orders,
    equitySeries,
    brokers,
    activeBroker,
    routes,
    exits,
    auditLog,
    governor,
  ])

  const instrument = engine.get(selected) ?? engine.instruments[0]

  const holdingRows: { instrument: Instrument; holding: Holding; value: number }[] = []
  for (const [symbol, holding] of Object.entries(portfolio.holdings)) {
    const held = engine.get(symbol)
    if (held) holdingRows.push({ instrument: held, holding, value: holding.qty * held.price })
  }
  holdingRows.sort((a, b) => b.value - a.value)

  const positionsValue = holdingRows.reduce((sum, row) => sum + row.value, 0)
  const equity = portfolio.cash + positionsValue
  const unrealized = holdingRows.reduce(
    (sum, row) => sum + (row.value - row.holding.qty * row.holding.avgCost),
    0,
  )

  const activeBrokerConn =
    brokers.find((b) => b.id === activeBrokerRef.current) ?? paperConnection()

  const quotePrices: Record<string, number> = {}
  for (const ins of engine.instruments) quotePrices[ins.symbol] = ins.price
  const riskRows = holdingRows.map((row) => ({
    symbol: row.instrument.symbol,
    cls: row.instrument.cls,
    value: row.value,
    qty: row.holding.qty,
    price: row.instrument.price,
  }))

  /** What the last quote pull reached and what it could not, for the feed badge. */
  const feedTitle = (() => {
    if (quoteFeed.at === 0) return 'Waiting for the first live quote pull'
    const lines = [`Pulled ${clockTime(quoteFeed.at)}`]
    if (quoteFeed.sources.length > 0) {
      lines.push(...quoteFeed.sources.map((s) => `${s.name} — ${s.detail}`))
    }
    if (quoteFeed.failed.length > 0) {
      lines.push('Feed errors:', ...quoteFeed.failed.map((f) => `· ${f}`))
    }
    lines.push(`Crypto stream — ${streamStatus.detail}`)
    if (settings.streamUrl.trim()) lines.push(`Your bridge — ${bridgeStatus.detail}`)
    lines.push('Stocks and energy have no free key-less feed, so they stay simulated.')
    return lines.join('\n')
  })()
  const feedFailed = quoteFeed.failed.length + (streamStatus.state === 'error' ? 1 : 0)
  const feedLive = quoteFeed.live > 0 || streamStatus.state === 'live'
  const feedBadge =
    activeBrokerConn.kind !== 'paper'
      ? `${activeBrokerConn.label} linked`
      : quoteFeed.live > 0
        ? `${quoteFeed.live} live quotes${feedFailed > 0 ? ` · ${feedFailed} feed errors` : ''}`
        : feedFailed > 0
          ? `${feedFailed} feed errors`
          : 'Simulated feed'

  // The risk governor, evaluated from live state so the banner and the scan
  // loop always agree. Only entries are ever blocked; exits keep running.
  const records = strategyRecords(tradeHistory)
  const dayAnchor = rollDay(governor, equity, now)
  const armedModel = STRATEGIES.find((s) => s.id === bot.strategy) ?? STRATEGIES[0]
  const riskBlocks = evaluateRisk({
    equity,
    startEquity: dayAnchor.startEquity,
    exposurePct: equity > 0 ? (positionsValue / equity) * 100 : 0,
    positions: holdingRows.length,
    tradesToday: entriesToday(tradeHistory, now),
    losingStreak: consecutiveLosses(tradeHistory),
    strategy: { id: armedModel.id, name: armedModel.name, record: records[armedModel.id] },
    auto: !settings.requireApproval,
    limits: settings.limits,
  })
  riskBlocksRef.current = riskBlocks
  dayAnchorRef.current = dayAnchor
  const dayChangePct = dayAnchor.startEquity > 0 ? (equity / dayAnchor.startEquity - 1) * 100 : 0

  /**
   * Routes orders to a venue and remembers it for the asset class of the
   * instrument on screen, so the next instrument of that class opens on it.
   * A venue that does not list the instrument is never remembered.
   */
  const routeBroker = (id: string) => {
    activeBrokerRef.current = id
    setActiveBroker(id)
    const conn = brokersRef.current.find((b) => b.id === id)
    const current = engine.get(selectedRef.current) ?? engine.instruments[0]
    if (!conn || !current) return
    if (conn.kind !== 'paper' && !venueSymbol(conn.kind, current.symbol)) return
    if (routesRef.current[current.cls] === id) return
    const next = { ...routesRef.current, [current.cls]: id }
    routesRef.current = next
    setRoutes(next)
  }

  // Switching instruments picks up the venue remembered for their asset class.
  useEffect(() => {
    selectedRef.current = selected
    const current = engine.get(selected)
    if (!current) return
    const usable = (conn: BrokerConnection | undefined) =>
      Boolean(conn && (conn.kind === 'paper' || venueSymbol(conn.kind, current.symbol)))
    const preferredId = routesRef.current[current.cls]
    const preferred = brokersRef.current.find((b) => b.id === preferredId)
    let target: string | undefined
    if (usable(preferred)) target = preferred!.id
    else if (!usable(brokersRef.current.find((b) => b.id === activeBrokerRef.current))) {
      target = PAPER_BROKER_ID
    }
    if (!target || target === activeBrokerRef.current) return
    activeBrokerRef.current = target
    setActiveBroker(target)
  }, [selected, engine])

  const placeOrder = useCallback(
    async (
      symbol: string,
      side: Side,
      qty: number,
      type: OrderType,
      limit: number,
      /** The setup behind a bot-approved proposal, kept with the fill. */
      setup?: { strategy: StrategyId; indicators?: IndicatorReading[] },
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const ins = engine.get(symbol)
      if (!ins) return { ok: false, error: `${symbol} is not a listed instrument.` }
      if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: 'Enter a quantity above zero.' }

      if (type === 'limit') {
        if (!Number.isFinite(limit) || limit <= 0) {
          return { ok: false, error: 'Enter a limit price above zero.' }
        }
        const order: WorkingOrder = {
          id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          ts: Date.now(),
          symbol: ins.symbol,
          side,
          qty,
          limit,
          status: 'working',
          broker: activeBrokerConn.kind === 'paper' ? 'paper' : activeBrokerConn.label,
          note: '',
        }
        const next = [order, ...ordersRef.current].slice(0, 40)
        ordersRef.current = next
        setOrders(next)
        return { ok: true }
      }

      const preview = applyOrder(portfolioRef.current, ins.symbol, ins.price, side, qty)
      if (!preview.ok) return preview

      if (activeBrokerConn.kind !== 'paper') {
        const routed = await submitBrokerOrder(activeBrokerConn, {
          symbol: ins.symbol,
          side,
          qty,
          price: ins.price,
        })
        const nextBrokers = brokersRef.current.map((b) =>
          b.id === activeBrokerConn.id
            ? {
                ...b,
                message: routed.message,
                checkedAt: Date.now(),
                status: routed.ok ? b.status : ('error' as const),
              }
            : b,
        )
        brokersRef.current = nextBrokers
        setBrokers(nextBrokers)
        if (!routed.ok) return { ok: false, error: routed.message }
      }

      const result = applyOrder(portfolioRef.current, ins.symbol, ins.price, side, qty)
      if (!result.ok) return result

      const fill: Fill = {
        id: `${Date.now()}-${ins.symbol}-${side}`,
        ts: Date.now(),
        symbol: ins.symbol,
        side,
        qty,
        price: ins.price,
        source: 'manual',
        reason:
          activeBrokerConn.kind === 'paper'
            ? side === 'buy'
              ? 'Market buy placed by you'
              : 'Market sell placed by you'
            : `Routed to ${activeBrokerConn.label}`,
        pnl: result.pnl,
        strategy: setup?.strategy,
        indicators: setup?.indicators,
      }
      portfolioRef.current = result.portfolio
      setPortfolio(result.portfolio)
      setFills((prev) => [...withMatches([fill]), ...prev].slice(0, 160))
      syncExits(result.portfolio, [fill])
      return { ok: true }
    },
    [engine, activeBrokerConn, syncExits, withMatches],
  )

  const submitOrder = useCallback(
    (side: Side, qty: number, type: OrderType, limit: number) =>
      placeOrder(selected, side, qty, type, limit),
    [placeOrder, selected],
  )

  const closeSymbol = useCallback(
    async (symbol: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      const held = portfolioRef.current.holdings[symbol]
      if (!held) return { ok: false, error: `No open position in ${symbol}.` }
      return placeOrder(symbol, 'sell', held.qty, 'market', 0)
    },
    [placeOrder],
  )

  /** Records a proposal's outcome with a line explaining it. */
  const settleProposal = useCallback(
    (id: string, status: Proposal['status'], note: string) => {
      setProposals((prev) => prev.map((p) => (p.id === id ? { ...p, status, note } : p)))
    },
    [],
  )

  const skipProposal = useCallback(
    (id: string) => settleProposal(id, 'skipped', 'Skipped by you'),
    [settleProposal],
  )

  /**
   * Books a proposal at the market, unless price has drifted past the retired
   * threshold since the signal fired — then the setup is closed out instead.
   */
  const approveProposal = useCallback(
    async (id: string) => {
      const proposal = proposalsRef.current.find((p) => p.id === id)
      if (!proposal || proposal.status !== 'pending') return
      const ins = engine.get(proposal.symbol)
      if (!ins) {
        settleProposal(id, 'expired', 'Instrument unavailable')
        return
      }
      const drift = Math.abs(ins.price / proposal.price - 1) * 100
      if (drift > settingsRef.current.maxDriftPct) {
        settleProposal(
          id,
          'expired',
          `Price moved ${drift.toFixed(2)}% since the signal — setup retired`,
        )
        return
      }
      const result = await placeOrder(
        proposal.symbol,
        proposal.side,
        proposal.qty,
        'market',
        0,
        proposal.strategy ? { strategy: proposal.strategy, indicators: proposal.indicators } : undefined,
      )
      settleProposal(
        id,
        result.ok ? 'approved' : 'expired',
        result.ok ? `Filled at ${fmtPrice(ins.price, ins.dp)}` : result.error,
      )
    },
    [engine, placeOrder, settleProposal],
  )

  /** Applies generated script steps in order and reports what happened. */
  const runScript = useCallback(
    async (steps: ScriptStep[]): Promise<string[]> => {
      const log: string[] = []
      for (const step of steps) {
        switch (step.kind) {
          case 'order': {
            const result = await placeOrder(
              step.symbol,
              step.side,
              step.qty,
              step.limit ? 'limit' : 'market',
              step.limit ?? 0,
            )
            if (!result.ok) {
              log.push(`${step.symbol}: ${result.error}`)
            } else if (step.limit) {
              log.push(
                `Resting ${step.side} of ${step.qty} ${step.symbol} at ${step.limit} — it fills when the market trades through.`,
              )
            } else {
              log.push(
                `${step.side === 'buy' ? 'Bought' : 'Sold'} ${step.qty} ${step.symbol} at market.`,
              )
            }
            break
          }
          case 'close': {
            const result = await closeSymbol(step.symbol)
            log.push(result.ok ? `Closed the ${step.symbol} position.` : result.error)
            break
          }
          case 'select':
            setSelected(step.symbol)
            log.push(`Focused ${step.symbol}.`)
            break
          case 'bot':
            setBot((prev) => ({ ...prev, running: step.running }))
            log.push(step.running ? 'Bot started.' : 'Bot paused.')
            break
          case 'strategy': {
            const name = STRATEGIES.find((s) => s.id === step.strategy)?.name ?? step.strategy
            setBot((prev) => ({ ...prev, strategy: step.strategy }))
            log.push(`Strategy set to ${name}.`)
            break
          }
          case 'risk': {
            const patch: Partial<RiskSettings> = {}
            if (step.riskPct !== undefined) patch.riskPct = step.riskPct
            if (step.stopLossPct !== undefined) patch.stopLossPct = step.stopLossPct
            if (step.takeProfitPct !== undefined) patch.takeProfitPct = step.takeProfitPct
            setBot((prev) => patchRisk(prev, patch))
            log.push('Risk settings updated.')
            break
          }
          case 'route': {
            if (step.to === 'paper') {
              routeBroker(PAPER_BROKER_ID)
              setBot((prev) => ({ ...prev, routeToBroker: false }))
              log.push('Orders route to the paper ledger.')
            } else {
              const venue = brokersRef.current.find(
                (b) => b.kind !== 'paper' && b.status === 'linked',
              )
              if (!venue) {
                log.push('No linked broker to route to — connect one first.')
              } else {
                routeBroker(venue.id)
                setBot((prev) => ({ ...prev, routeToBroker: true }))
                log.push(`Orders route to ${venue.label}.`)
              }
            }
            break
          }
        }
      }
      return log
    },
    [placeOrder, closeSymbol],
  )

  // The API generated scripts call, kept fresh through a ref.
  const apiRef = useRef<KestrelApi | null>(null)
  apiRef.current = {
    order: async (symbol, side, qty) => {
      const result = await placeOrder(symbol, side, qty, 'market', 0)
      if (!result.ok) throw new Error(result.error)
    },
    limit: async (symbol, side, qty, limitPrice) => {
      const result = await placeOrder(symbol, side, qty, 'limit', limitPrice)
      if (!result.ok) throw new Error(result.error)
    },
    close: async (symbol) => {
      const result = await closeSymbol(symbol)
      if (!result.ok) throw new Error(result.error)
    },
    select: (symbol) => setSelected(symbol),
    bot: (patch) => setBot((prev) => ({ ...prev, ...patch })),
    strategy: (id) => setBot((prev) => ({ ...prev, strategy: id })),
    risk: (patch) => setBot((prev) => patchRisk(prev, patch)),
    route: (target) => {
      if (target === 'paper') {
        routeBroker(PAPER_BROKER_ID)
        setBot((prev) => ({ ...prev, routeToBroker: false }))
        return
      }
      const venue = brokersRef.current.find((b) => b.kind !== 'paper' && b.status === 'linked')
      if (!venue) return
      routeBroker(venue.id)
      setBot((prev) => ({ ...prev, routeToBroker: true }))
    },
  }

  useEffect(() => {
    const current = apiRef
    const api: KestrelApi = {
      order: (symbol, side, qty) => current.current!.order(symbol, side, qty),
      limit: (symbol, side, qty, limitPrice) => current.current!.limit(symbol, side, qty, limitPrice),
      close: (symbol) => current.current!.close(symbol),
      select: (symbol) => current.current!.select(symbol),
      bot: (patch) => current.current!.bot(patch),
      strategy: (id) => current.current!.strategy(id),
      risk: (patch) => current.current!.risk(patch),
      route: (target) => current.current!.route(target),
    }
    window.kestrel = api
    return () => {
      delete window.kestrel
    }
  }, [])

  const cancelOrder = (id: string) => {
    const next = ordersRef.current.map((order) =>
      order.id === id ? { ...order, status: 'cancelled' as const, note: 'Cancelled by you' } : order,
    )
    ordersRef.current = next
    setOrders(next)
  }

  const saveBroker = (conn: BrokerConnection) => {
    const exists = brokersRef.current.some((b) => b.id === conn.id)
    const next = exists
      ? brokersRef.current.map((b) => (b.id === conn.id ? conn : b))
      : [...brokersRef.current, conn]
    brokersRef.current = next
    setBrokers(next)
    if (!exists && conn.status === 'linked' && conn.kind !== 'paper') routeBroker(conn.id)
  }

  const removeBroker = (id: string) => {
    const next = brokersRef.current.filter((b) => b.id !== id)
    brokersRef.current = next
    setBrokers(next)
    const keptRoutes = Object.fromEntries(
      Object.entries(routesRef.current).filter(([, brokerId]) => brokerId !== id),
    ) as Partial<Record<AssetClass, string>>
    routesRef.current = keptRoutes
    setRoutes(keptRoutes)
    if (activeBrokerRef.current === id) routeBroker(PAPER_BROKER_ID)
  }

  const closePosition = () => {
    void closeSymbol(instrument.symbol)
  }

  const resetAccount = () => {
    if (!window.confirm('Reset the account to $100,000, clear fills and cancel working orders?')) return
    const fresh = startingPortfolio()
    portfolioRef.current = fresh
    cooldownsRef.current = {}
    setPortfolio(fresh)
    setFills([])
    setTradeHistory([])
    setOrders([])
    ordersRef.current = []
    exitsRef.current = {}
    setExits({})
    setEquitySeries([])
    setProposals([])
    setBot((prev) => ({ ...prev, running: false }))
  }

  const updateBot = (patch: Partial<BotConfig>) => setBot((prev) => ({ ...prev, ...patch }))

  const signIn = (next: Profile) => {
    saveProfile(next)
    setProfile(next)
  }

  const updateProfile = (next: Profile) => {
    saveProfile(next)
    setProfile(next)
  }

  const signOut = () => {
    clearProfile()
    setProfile(null)
    setView('trade')
  }

  const changeSettings = (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      settingsRef.current = next
      return next
    })
  }

  /** Auto execution runs the bot and books every signal without asking. */
  const autoOn = bot.running && !settings.requireApproval
  const toggleAutoExecute = () => {
    if (autoOn) {
      setBot((prev) => ({ ...prev, running: false }))
      changeSettings({ requireApproval: true })
      return
    }
    changeSettings({ requireApproval: false })
    setBot((prev) => ({ ...prev, running: true }))
  }

  // Hold the screen awake while the bot is armed. Wake Lock is the closest a
  // web build gets to a foreground service: without it Android is free to
  // suspend the WebView, and replaying missed scans is all that is left.
  useEffect(() => {
    if (!autoOn) return
    let handle: { release: () => Promise<void> } | null = null
    let cancelled = false
    void requestWakeLock().then((acquired) => {
      if (cancelled) {
        void acquired?.release()
        return
      }
      handle = acquired
      if (!acquired) {
        logEvent({
          kind: 'feed',
          detail:
            'This browser will not hold the screen awake — background scans are replayed on return',
        })
      }
    })
    return () => {
      cancelled = true
      void handle?.release()
    }
  }, [autoOn, logEvent])

  /** Puts a whole saved terminal in place, refs included, so the next tick sees it. */
  const applyState = (next: StoredState) => {
    portfolioRef.current = next.portfolio
    setPortfolio(next.portfolio)
    setFills(next.fills)
    setTradeHistory(next.history)
    botRef.current = next.bot
    setBot(next.bot)
    ordersRef.current = next.orders
    setOrders(next.orders)
    setEquitySeries(next.equity)
    brokersRef.current = next.brokers
    setBrokers(next.brokers)
    activeBrokerRef.current = next.activeBroker
    setActiveBroker(next.activeBroker)
    routesRef.current = next.routes
    setRoutes(next.routes)
    exitsRef.current = next.exits
    setExits(next.exits)
    auditRef.current = next.audit
    setAuditLog(next.audit)
    governorRef.current = next.governor
    setGovernor(next.governor)
    cooldownsRef.current = {}
  }

  const exportState = () => {
    const saved = withoutSecrets({
      portfolio,
      fills: fills.slice(0, 80),
      history: tradeHistory.slice(0, 1200),
      bot,
      orders: orders.slice(0, 40),
      equity: equitySeries.slice(-240),
      brokers,
      activeBroker,
      routes,
      exits,
      audit: auditLog.slice(0, 120),
      governor,
    })
    const blob = new Blob(
      [JSON.stringify({ app: 'kestrel', version: 1, savedAt: new Date().toISOString(), state: saved }, null, 2)],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `kestrel-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const importState = async (file: File) => {
    let next: StoredState | null = null
    try {
      const parsed = JSON.parse(await file.text()) as { state?: unknown }
      const candidate = parsed && typeof parsed === 'object' && 'state' in parsed ? parsed.state : parsed
      next = parseState(JSON.stringify(candidate))
    } catch {
      next = null
    }
    if (!next) {
      window.alert('That file is not a Kestrel backup.')
      return
    }
    if (!window.confirm('Replace the current paper account with this backup?')) return
    applyState(withoutSecrets(next))
  }

  const change = changePct(instrument)
  const sessionStart = equitySeries[0]?.t ?? now
  const rangePoints = RANGES.find((r) => r.id === range)?.points ?? 160
  const held = portfolio.holdings[instrument.symbol]
  const attached = held ? exits[instrument.symbol] : undefined
  const exitLevels: PlanLevel[] = attached
    ? [
        { label: 'Stop', price: attached.stopLoss, tone: 'stop' },
        { label: 'Target', price: attached.takeProfit, tone: 'target' },
      ]
    : []
  const chartLevels = [
    ...(planLevels?.symbol === instrument.symbol ? planLevels.levels : []),
    ...exitLevels,
  ]
  const chartData = instrument.history.slice(-rangePoints)
  const high = Math.max(...chartData)
  const low = Math.min(...chartData)
  const rangeChange = ((chartData[chartData.length - 1] - chartData[0]) / chartData[0]) * 100

  const botSells = fills.filter((f) => f.source === 'bot' && f.side === 'sell')
  const botStats = {
    trades: fills.filter((f) => f.source === 'bot').length,
    winRate: botSells.length
      ? (botSells.filter((f) => (f.pnl ?? 0) > 0).length / botSells.length) * 100
      : null,
    realized: botSells.reduce((sum, f) => sum + (f.pnl ?? 0), 0),
  }

  const clock = new Date(now).toLocaleTimeString('en-GB', { hour12: false })
  const linkedBrokers = brokers.filter((b) => b.kind !== 'paper' && b.status === 'linked').length
  const pendingCount = proposals.filter((p) => p.status === 'pending').length
  const activeView = VIEWS.find((v) => v.id === view) ?? {
    id: view,
    label: 'Settings',
    short: 'Settings',
    hint: 'Profile & approvals',
  }

  if (!profile) return <LoginScreen onSubmit={signIn} />

  return (
    <div className="app">
      <Topbar
        autoOn={autoOn}
        onToggleAuto={toggleAutoExecute}
        botRunning={bot.running}
        clock={clock}
        feedBadge={feedBadge}
        feedTitle={feedTitle}
        feedWarn={feedFailed > 0 || streamStatus.state === 'error'}
        feedLive={feedLive}
        equity={equity}
        deposited={portfolio.deposited}
        pendingCount={pendingCount}
        settingsActive={view === 'settings'}
        onOpenSettings={() => setView('settings')}
        name={profile.name}
      />

      <div className="terminal">
        <aside className="col col--left">
          <Watchlist
            instruments={engine.instruments}
            selected={instrument.symbol}
            filter={filter}
            onFilter={setFilter}
            onSelect={setSelected}
          />
        </aside>

        <main className="col col--mid" ref={mainRef}>
          {riskBlocks.length > 0 && (
            <div className="riskbar" role="status">
              <strong>Entries paused</strong>
              <span>{riskBlocks[0].reason}</span>
              {riskBlocks.length > 1 && (
                <span className="riskbar__more">+{riskBlocks.length - 1} more limit breached</span>
              )}
              <span className="riskbar__note">Stops, targets and exits still run.</span>
            </div>
          )}
          {view === 'trade' && (
            <div className="view view--trade">
              <div className="market">
                <div className="market__head">
                  <div>
                    <div className="market__id">
                      <span className="dot" style={{ background: CLASS_COLOR[instrument.cls] }} />
                      <span>{instrument.cls}</span>
                      <span className="market__name">{instrument.name}</span>
                      <span
                        className={instrument.live ? 'market__feed is-live' : 'market__feed'}
                        title={
                          instrument.live
                            ? `${instrument.source} · updated ${clockTime(
                                instrument.liveAt ?? now,
                              )}`
                            : 'No free key-less feed for this market — the tape is simulated'
                        }
                      >
                        {instrument.live ? `Live · ${instrument.source}` : 'Simulated'}
                      </span>
                    </div>
                    <h1>{instrument.symbol}</h1>
                  </div>
                  <div className="market__quote">
                    <span
                      className={`market__price ${change >= 0 ? 'up' : 'down'}`}
                      key={instrument.price}
                    >
                      {fmtPrice(instrument.price, instrument.dp)}
                    </span>
                    <span className={`market__chg ${change >= 0 ? 'up' : 'down'}`}>
                      {signedPct(change)} today
                    </span>
                  </div>
                </div>

                <div className="ranges" role="group" aria-label="Chart range">
                  {RANGES.map((r) => (
                    <button
                      key={r.id}
                      className={range === r.id ? 'range is-active' : 'range'}
                      aria-pressed={range === r.id}
                      onClick={() => setRange(r.id)}
                    >
                      {r.id}
                    </button>
                  ))}
                </div>

                <PriceChart
                  data={chartData}
                  color={CLASS_COLOR[instrument.cls]}
                  label={range}
                  levels={chartLevels.length > 0 ? chartLevels : undefined}
                />

                <dl className="market__stats">
                  <div>
                    <dt>Prev close</dt>
                    <dd>{fmtPrice(instrument.prevClose, instrument.dp)}</dd>
                  </div>
                  <div>
                    <dt>{range} high</dt>
                    <dd>{fmtPrice(high, instrument.dp)}</dd>
                  </div>
                  <div>
                    <dt>{range} low</dt>
                    <dd>{fmtPrice(low, instrument.dp)}</dd>
                  </div>
                  <div>
                    <dt>{range} change</dt>
                    <dd className={rangeChange >= 0 ? 'up' : 'down'}>{signedPct(rangeChange)}</dd>
                  </div>
                </dl>
              </div>

              <div className="midgrid">
                <TradeTicket
                  key={instrument.symbol}
                  instrument={instrument}
                  cash={portfolio.cash}
                  holding={portfolio.holdings[instrument.symbol]}
                  connections={brokers}
                  activeBrokerId={activeBrokerConn.id}
                  remembered={routes[instrument.cls] === activeBrokerConn.id}
                  onRoute={routeBroker}
                  onSubmit={submitOrder}
                />
                <PositionCard
                  instrument={instrument}
                  holding={portfolio.holdings[instrument.symbol]}
                  onClose={closePosition}
                />
              </div>
            </div>
          )}

          {view === 'scan' && (
            <ScanPanel
              instruments={engine.instruments}
              bot={bot}
              tick={tickRef.current}
              onOpen={(symbol) => {
                setSelected(symbol)
                setView('trade')
              }}
            />
          )}

          {view === 'strategies' && (
            <StrategiesTab
              bot={bot}
              instruments={engine.instruments}
              instrument={instrument}
              exits={exits}
              portfolio={portfolio}
              tick={now}
              onChange={updateBot}
            />
          )}

          {view === 'settings' && (
            <SettingsView
              profile={profile}
              settings={settings}
              onChangeSettings={changeSettings}
              onSaveProfile={updateProfile}
              onSignOut={signOut}
              onExport={exportState}
              onImport={(file) => void importState(file)}
              onReset={resetAccount}
              equity={equity}
              startingCash={START_CASH}
            />
          )}

          {view === 'trades' && (
            <div className="view">
              <div className="view__head">
                <div>
                  <h1 className="view__title">Current trades</h1>
                  <p className="view__sub">
                    {holdingRows.length
                      ? `${holdingRows.length} open position${holdingRows.length === 1 ? '' : 's'}`
                      : 'No open positions'}
                    {' · '}
                    {tradeHistory.length} fill{tradeHistory.length === 1 ? '' : 's'} logged
                  </p>
                </div>
                <span className="view__meta">{money(equity)}</span>
              </div>

              <div className="trades-grid">
                <div className="stack">
                  <section className="panel">
                    <header className="panel__head">
                      <h2>Trade performance</h2>
                      <span className="panel__meta">
                        session from {clockTime(sessionStart)} · {equitySeries.length} samples
                      </span>
                    </header>
                    <PerformanceChart
                      points={equitySeries}
                      fills={tradeHistory}
                      startTs={sessionStart}
                      deposited={portfolio.deposited}
                      symbol={instrument.symbol}
                    />
                  </section>
                  <AnalyticsPanel fills={tradeHistory} points={equitySeries} />
                  <DeskLog events={auditLog} dayChangePct={dayChangePct} />
                  <RiskPanel rows={riskRows} equity={equity} quotes={quotePrices} />
                  <AccountPanel
                    portfolio={portfolio}
                    equity={equity}
                    unrealized={unrealized}
                    onOpenSettings={() => setView('settings')}
                  />
                  <Positions rows={holdingRows} onSelect={setSelected} />
                  <TradeLog
                    fills={tradeHistory}
                    priceOf={(symbol) => engine.get(symbol)?.price}
                    onSelect={setSelected}
                  />
                </div>
                <div className="stack">
                  <Proposals
                    proposals={proposals}
                    onApprove={(id) => void approveProposal(id)}
                    onSkip={skipProposal}
                  />
                  <WorkingOrders orders={orders} onCancel={cancelOrder} onSelect={setSelected} />
                  <Activity fills={fills} onSelect={setSelected} />
                </div>
              </div>
            </div>
          )}

          {view === 'bot' && (
            <div className="view">
              <div className="view__head">
                <div>
                  <h1 className="view__title">Test lab</h1>
                  <p className="view__sub">
                    One strategy per run, tuned per symbol class, sized by risk.
                  </p>
                </div>
                <span className="view__meta">
                  {botStats.trades} bot trade{botStats.trades === 1 ? '' : 's'}
                </span>
              </div>

              <div className="trades-grid">
                <BotPanel
                  bot={bot}
                  onChange={updateBot}
                  stats={botStats}
                  instruments={engine.instruments.length}
                  brokerLabel={activeBrokerConn.kind === 'paper' ? null : activeBrokerConn.label}
                />
                <BacktestPanel instrument={instrument} bot={bot} />
              </div>
            </div>
          )}

          {view === 'brokers' && (
            <div className="view">
              <div className="view__head">
                <div>
                  <h1 className="view__title">Broker connections</h1>
                  <p className="view__sub">
                    Hold keys locally and route orders to the venue you pick.
                  </p>
                </div>
                <span className="view__meta">
                  {linkedBrokers} linked · {activeBrokerConn.kind === 'paper' ? 'paper' : activeBrokerConn.label}
                </span>
              </div>

              <Brokers
                connections={brokers}
                activeId={activeBroker}
                onSave={saveBroker}
                onRemove={removeBroker}
                onRoute={routeBroker}
              />
              <Reconciliation fills={tradeHistory} />
            </div>
          )}

          {view === 'scripts' && (
            <div className="view">
              <div className="view__head">
                <div>
                  <h1 className="view__title">Scripts</h1>
                  <p className="view__sub">
                    Read a chart into a trade plan, or describe an action in plain English.
                  </p>
                </div>
                <span className="view__meta">Paper account</span>
              </div>

              <ScriptsPanel
                instruments={engine.instruments}
                selected={instrument.symbol}
                onSelect={setSelected}
                equity={equity}
                cash={portfolio.cash}
                holdingQty={portfolio.holdings[instrument.symbol]?.qty ?? 0}
                onRun={runScript}
                onShowLevels={(plan: ChartPlan) => {
                  setPlanLevels({ symbol: plan.read.symbol, levels: plan.levels })
                  setSelected(plan.read.symbol)
                  setView('trade')
                }}
                onLevelsChange={(plan: ChartPlan) =>
                  setPlanLevels({ symbol: plan.read.symbol, levels: plan.levels })
                }
              />
            </div>
          )}
        </main>
      </div>

      <nav className="dock" aria-label="Terminal sections">
        {VIEWS.map((item) => {
          const badge =
            item.id === 'trades'
              ? holdingRows.length
              : item.id === 'brokers'
                ? linkedBrokers
                : item.id === 'settings'
                  ? pendingCount
                  : 0
          return (
            <button
              key={item.id}
              className={view === item.id ? 'dock__btn is-active' : 'dock__btn'}
              aria-current={view === item.id}
              onClick={() => setView(item.id)}
            >
              <span className="dock__icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {DOCK_ICONS[item.id]}
                </svg>
              </span>
              <span className="dock__label dock__label--full">{item.label}</span>
              <span className="dock__label dock__label--short" aria-hidden="true">
                {item.short}
              </span>
              <span className="dock__hint">{item.hint}</span>
              {badge > 0 && <span className="dock__badge">{badge}</span>}
              {item.id === 'bot' && bot.running && <span className="dock__live" aria-hidden="true" />}
            </button>
          )
        })}
        <span className="dock__view">
          {activeView.label} · {activeView.hint}
        </span>
      </nav>
    </div>
  )
}
