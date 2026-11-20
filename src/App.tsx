import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ASSET_CLASSES,
  CLASS_COLOR,
  MarketEngine,
  changePct,
  type AssetClass,
  type Instrument,
} from './market'
import {
  DEFAULT_BOT,
  DEFAULT_RISK,
  STRATEGIES,
  patchRisk,
  runBotStep,
  type BotConfig,
  type BotIntent,
  type RiskSettings,
  type StrategyId,
} from './bot'
import {
  applyOrder,
  limitReached,
  startingPortfolio,
  type Fill,
  type Holding,
  type OrderType,
  type Portfolio,
  type Side,
  type WorkingOrder,
} from './trade'
import {
  BROKER_DEFS,
  PAPER_BROKER_ID,
  defaultConnections,
  paperConnection,
  submitBrokerOrder,
  venueSymbol,
  type BrokerConnection,
} from './brokers'
import { money, price as fmtPrice, signedPct } from './format'
import type { MeridianApi, ScriptStep } from './scripts'
import type { ChartPlan, PlanLevel } from './chartPlan'
import Watchlist from './components/Watchlist'
import PriceChart from './components/PriceChart'
import TradeTicket from './components/TradeTicket'
import PositionCard from './components/PositionCard'
import AccountPanel from './components/AccountPanel'
import EquityCurve from './components/EquityCurve'
import Positions from './components/Positions'
import BotPanel from './components/BotPanel'
import Activity from './components/Activity'
import WorkingOrders from './components/WorkingOrders'
import Brokers from './components/Brokers'
import BacktestPanel from './components/BacktestPanel'
import ScriptsPanel from './components/ScriptsPanel'

const STORAGE_KEY = 'meridian.terminal.v1'

const RANGES = [
  { id: '1H', points: 60 },
  { id: '1D', points: 160 },
  { id: '1W', points: 320 },
] as const

type RangeId = (typeof RANGES)[number]['id']

type ViewId = 'trade' | 'trades' | 'bot' | 'brokers' | 'scripts'

const VIEWS: { id: ViewId; label: string; short: string; hint: string }[] = [
  { id: 'trade', label: 'Trade setup', short: 'Trade', hint: 'Chart & ticket' },
  { id: 'trades', label: 'Current trades', short: 'Trades', hint: 'Positions & fills' },
  { id: 'bot', label: 'Bot & backtest', short: 'Bot', hint: 'Strategy settings' },
  { id: 'brokers', label: 'Broker connections', short: 'Brokers', hint: 'Venues & keys' },
  { id: 'scripts', label: 'Scripts', short: 'Scripts', hint: 'Chart or plain English' },
]

interface StoredState {
  portfolio: Portfolio
  fills: Fill[]
  bot: BotConfig
  orders: WorkingOrder[]
  equity: number[]
  brokers: BrokerConnection[]
  activeBroker: string
  /** Venue the ticket picks for each asset class. */
  routes: Partial<Record<AssetClass, string>>
}

function emptyState(): StoredState {
  return {
    portfolio: startingPortfolio(),
    fills: [],
    bot: DEFAULT_BOT,
    orders: [],
    equity: [],
    brokers: defaultConnections(),
    activeBroker: PAPER_BROKER_ID,
    routes: {},
  }
}

/**
 * Rebuilds the bot config. Saves from before per-strategy exits held one shared
 * set, which is kept with the strategy that was armed at the time.
 */
function loadBot(raw: unknown): BotConfig {
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
function parseState(raw: string | null): StoredState | null {
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

    return {
      portfolio: { ...startingPortfolio(), ...portfolio },
      fills: Array.isArray(parsed.fills) ? parsed.fills.slice(0, 160) : [],
      bot: loadBot(parsed.bot),
      orders: Array.isArray(parsed.orders) ? parsed.orders.slice(0, 40) : [],
      equity: Array.isArray(parsed.equity) ? parsed.equity.slice(-240) : [],
      brokers,
      activeBroker,
      routes,
    }
  } catch {
    return null
  }
}

function loadState(): StoredState {
  return parseState(localStorage.getItem(STORAGE_KEY)) ?? emptyState()
}

/** Backups never carry broker keys, so restored venues ask for them again. */
function withoutSecrets(state: StoredState): StoredState {
  return {
    ...state,
    brokers: state.brokers.map((b) =>
      b.kind === 'paper'
        ? b
        : { ...b, key: '', secret: '', status: 'error' as const, message: 'Keys are not part of a backup — re-enter them' },
    ),
  }
}

export default function App() {
  const engineRef = useRef<MarketEngine | null>(null)
  if (!engineRef.current) engineRef.current = new MarketEngine()
  const engine = engineRef.current

  const [initial] = useState(loadState)
  const [portfolio, setPortfolio] = useState<Portfolio>(initial.portfolio)
  const portfolioRef = useRef(portfolio)
  const [fills, setFills] = useState<Fill[]>(initial.fills)
  const [bot, setBot] = useState<BotConfig>(initial.bot)
  const botRef = useRef(bot)
  const cooldownsRef = useRef<Record<string, number>>({})
  const tickRef = useRef(0)

  const [orders, setOrders] = useState<WorkingOrder[]>(initial.orders)
  const ordersRef = useRef(orders)
  const [equitySeries, setEquitySeries] = useState<number[]>(initial.equity)
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

  useEffect(() => {
    botRef.current = bot
  }, [bot])

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
        })
      }
      if (booked.length > 0) {
        portfolioRef.current = pf
        setPortfolio(pf)
        setFills((prev) => [...booked, ...prev].slice(0, 160))
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
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      engine.tick()
      tickRef.current += 1
      setNow(Date.now())

      if (botRef.current.running) {
        const venue = botRef.current.routeToBroker
          ? brokersRef.current.find((b) => b.id === activeBrokerRef.current)
          : undefined
        if (venue && venue.kind !== 'paper') {
          if (!routingRef.current) {
            const plan = runBotStep(
              engine.instruments,
              portfolioRef.current,
              botRef.current,
              cooldownsRef.current,
              tickRef.current,
              true,
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
          )
          if (result.fills.length > 0) {
            portfolioRef.current = result.portfolio
            setPortfolio(result.portfolio)
            setFills((prev) => [...result.fills, ...prev].slice(0, 160))
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
          setFills((prev) => [...fillsNow, ...prev].slice(0, 160))
        }
      }

      const equityNow = equityOf(portfolioRef.current)
      setEquitySeries((prev) =>
        prev.length > 0 && Math.abs(prev[prev.length - 1] - equityNow) < 0.005
          ? prev
          : [...prev, equityNow].slice(-240),
      )
    }, 900)
    return () => window.clearInterval(id)
  }, [engine, equityOf, dispatchBotIntents])

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          portfolio,
          fills: fills.slice(0, 80),
          bot,
          orders: orders.slice(0, 40),
          equity: equitySeries.slice(-240),
          brokers,
          activeBroker,
          routes,
        }),
      )
    } catch {
      // storage is a convenience; the terminal keeps running without it
    }
  }, [portfolio, fills, bot, orders, equitySeries, brokers, activeBroker, routes])

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

      portfolioRef.current = result.portfolio
      setPortfolio(result.portfolio)
      setFills((prev) =>
        [
          {
            id: `${Date.now()}-${ins.symbol}-${side}`,
            ts: Date.now(),
            symbol: ins.symbol,
            side,
            qty,
            price: ins.price,
            source: 'manual' as const,
            reason:
              activeBrokerConn.kind === 'paper'
                ? side === 'buy'
                  ? 'Market buy placed by you'
                  : 'Market sell placed by you'
                : `Routed to ${activeBrokerConn.label}`,
            pnl: result.pnl,
          },
          ...prev,
        ].slice(0, 160),
      )
      return { ok: true }
    },
    [engine, activeBrokerConn],
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
  const apiRef = useRef<MeridianApi | null>(null)
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
    const api: MeridianApi = {
      order: (symbol, side, qty) => current.current!.order(symbol, side, qty),
      limit: (symbol, side, qty, limitPrice) => current.current!.limit(symbol, side, qty, limitPrice),
      close: (symbol) => current.current!.close(symbol),
      select: (symbol) => current.current!.select(symbol),
      bot: (patch) => current.current!.bot(patch),
      strategy: (id) => current.current!.strategy(id),
      risk: (patch) => current.current!.risk(patch),
      route: (target) => current.current!.route(target),
    }
    window.meridian = api
    return () => {
      delete window.meridian
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
    setOrders([])
    ordersRef.current = []
    setEquitySeries([])
    setBot((prev) => ({ ...prev, running: false }))
  }

  const updateBot = (patch: Partial<BotConfig>) => setBot((prev) => ({ ...prev, ...patch }))

  /** Puts a whole saved terminal in place, refs included, so the next tick sees it. */
  const applyState = (next: StoredState) => {
    portfolioRef.current = next.portfolio
    setPortfolio(next.portfolio)
    setFills(next.fills)
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
    cooldownsRef.current = {}
  }

  const exportState = () => {
    const saved = withoutSecrets({
      portfolio,
      fills: fills.slice(0, 80),
      bot,
      orders: orders.slice(0, 40),
      equity: equitySeries.slice(-240),
      brokers,
      activeBroker,
      routes,
    })
    const blob = new Blob(
      [JSON.stringify({ app: 'meridian', version: 1, savedAt: new Date().toISOString(), state: saved }, null, 2)],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `meridian-${new Date().toISOString().slice(0, 10)}.json`
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
      window.alert('That file is not a Meridian backup.')
      return
    }
    if (!window.confirm('Replace the current paper account with this backup?')) return
    applyState(withoutSecrets(next))
  }

  const change = changePct(instrument)
  const rangePoints = RANGES.find((r) => r.id === range)?.points ?? 160
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
  const activeView = VIEWS.find((v) => v.id === view) ?? VIEWS[0]

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <div>
            <div className="brand__name">Meridian</div>
            <div className="brand__sub">Paper trading terminal</div>
          </div>
        </div>
        <div className="topbar__right">
          <span className={`topbar__bot ${bot.running ? 'is-on' : ''}`}>
            <i aria-hidden="true" />
            {bot.running ? 'Bot scanning' : 'Bot paused'}
          </span>
          <span className="topbar__badge">
            {activeBrokerConn.kind === 'paper' ? 'Simulated feed' : `${activeBrokerConn.label} linked`}
          </span>
          <span className="topbar__clock">{clock}</span>
          <span className="topbar__equity">{money(equity)}</span>
        </div>
      </header>

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
          {view === 'trade' && (
            <div className="view view--trade">
              <div className="market">
                <div className="market__head">
                  <div>
                    <div className="market__id">
                      <span className="dot" style={{ background: CLASS_COLOR[instrument.cls] }} />
                      <span>{instrument.cls}</span>
                      <span className="market__name">{instrument.name}</span>
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
                  levels={planLevels?.symbol === instrument.symbol ? planLevels.levels : undefined}
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
                    {fills.length} fill{fills.length === 1 ? '' : 's'} this session
                  </p>
                </div>
                <span className="view__meta">{money(equity)}</span>
              </div>

              <div className="trades-grid">
                <div className="stack">
                  <AccountPanel
                    portfolio={portfolio}
                    equity={equity}
                    unrealized={unrealized}
                    onReset={resetAccount}
                    onExport={exportState}
                    onImport={(file) => void importState(file)}
                  />
                  <Positions rows={holdingRows} onSelect={setSelected} />
                  <EquityCurve points={equitySeries} deposited={portfolio.deposited} equity={equity} />
                </div>
                <div className="stack">
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
                  <h1 className="view__title">Bot &amp; backtest</h1>
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
                : 0
          return (
            <button
              key={item.id}
              className={view === item.id ? 'dock__btn is-active' : 'dock__btn'}
              aria-current={view === item.id}
              onClick={() => setView(item.id)}
            >
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
