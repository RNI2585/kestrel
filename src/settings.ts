import type { StrategyId } from './bot'
import type { IndicatorReading } from './trade'
import { clampLimits, DEFAULT_RISK_LIMITS, type RiskLimits } from './risk'

/** The local profile the login screen creates. Nothing leaves the browser. */
export interface Profile {
  name: string
  email: string
  since: number
}

export interface Settings {
  /**
   * When on, the bot only proposes trades and waits for you to approve them.
   * When off it fills in the paper ledger as soon as a signal fires.
   */
  requireApproval: boolean
  /** How far price may drift before a queued proposal is stale, in percent. */
  maxDriftPct: number
  /** The limits that guard an unattended bot. */
  limits: RiskLimits
  /**
   * An SSE bridge that streams quotes for markets with no key-less feed —
   * stocks and energy. Empty means the poller and the simulated tape.
   */
  streamUrl: string
}

export const DEFAULT_SETTINGS: Settings = {
  requireApproval: true,
  maxDriftPct: 0.4,
  limits: DEFAULT_RISK_LIMITS,
  streamUrl: '',
}

const SETTINGS_KEY = 'kestrel.settings.v1'
const PROFILE_KEY = 'kestrel.profile.v1'
/** Keys written before the rename, read once so a saved profile survives it. */
const LEGACY_SETTINGS_KEY = 'meridian.settings.v1'
const LEGACY_PROFILE_KEY = 'meridian.profile.v1'

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function loadSettings(): Settings {
  const stored = read(SETTINGS_KEY) ?? read(LEGACY_SETTINGS_KEY)
  const source = stored && typeof stored === 'object' ? (stored as Partial<Settings>) : {}
  return {
    requireApproval:
      typeof source.requireApproval === 'boolean'
        ? source.requireApproval
        : DEFAULT_SETTINGS.requireApproval,
    maxDriftPct:
      typeof source.maxDriftPct === 'number' && source.maxDriftPct > 0
        ? source.maxDriftPct
        : DEFAULT_SETTINGS.maxDriftPct,
    limits: clampLimits(source.limits),
    streamUrl:
      typeof source.streamUrl === 'string' ? source.streamUrl.trim().slice(0, 400) : '',
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // storage is a convenience; settings stay in memory without it
  }
}

export function loadProfile(): Profile | null {
  const stored = read(PROFILE_KEY) ?? read(LEGACY_PROFILE_KEY)
  if (!stored || typeof stored !== 'object') return null
  const source = stored as Partial<Profile>
  const name = typeof source.name === 'string' ? source.name.trim() : ''
  if (!name) return null
  return {
    name: name.slice(0, 40),
    email: typeof source.email === 'string' ? source.email.slice(0, 80) : '',
    since: typeof source.since === 'number' ? source.since : Date.now(),
  }
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  } catch {
    // the session works without persistence
  }
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(PROFILE_KEY)
  } catch {
    // nothing to clear
  }
}

/** A trade the bot wants to place, waiting on the trader's decision. */
export interface Proposal {
  id: string
  ts: number
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  /** Price when the signal fired, kept to detect a faded setup. */
  price: number
  reason: string
  status: 'pending' | 'approved' | 'skipped' | 'expired'
  note?: string
  /** The strategy and its indicator readings when the signal fired. */
  strategy?: StrategyId
  indicators?: IndicatorReading[]
}
