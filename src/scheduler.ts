/**
 * The desk's clock and its keep-alive.
 *
 * A browser tab that goes to the background — or an Android WebView that is
 * paused — stops getting its 900 ms scans on time. Rather than pretend the bot
 * traded through that gap, the desk notices how long it was away and replays
 * the missed scans in a bounded burst when it comes back, so stops, targets
 * and limit orders are all evaluated against the tape as it is now.
 */

export const TICK_MS = 900

/** The most scans replayed on return, so a long sleep cannot freeze the app. */
export const MAX_CATCH_UP_SCANS = 90

export interface CatchUp {
  /** Scans to run now to stand in for the missed ones. */
  scans: number
  /** How long the desk went without a scan, in milliseconds. */
  stalledMs: number
}

export function catchUp(
  lastScanAt: number,
  now: number,
  tickMs: number = TICK_MS,
  maxScans: number = MAX_CATCH_UP_SCANS,
): CatchUp {
  if (!Number.isFinite(lastScanAt) || lastScanAt <= 0) return { scans: 0, stalledMs: 0 }
  const stalledMs = Math.max(0, now - lastScanAt - tickMs)
  const scans = Math.min(maxScans, Math.max(0, Math.floor(stalledMs / tickMs)))
  return { scans, stalledMs }
}

/** A duration said the way a trader would say it: "45s", "6m 20s", "2h 5m". */
export function humanSpan(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`
}

interface WakeSentinel {
  release: () => Promise<void>
}

/**
 * Holds the screen awake while auto execution is armed, which is the closest a
 * web page can get to a foreground service: without it an Android device is
 * free to suspend the WebView and stop the scans. Returns null where the
 * browser has no Wake Lock support (or refuses it), and the desk falls back to
 * the catch-up path.
 */
export async function requestWakeLock(): Promise<{ release: () => Promise<void> } | null> {
  const api = (navigator as Navigator & {
    wakeLock?: { request: (type: 'screen') => Promise<WakeSentinel> }
  }).wakeLock
  if (!api || typeof api.request !== 'function') return null
  try {
    const sentinel = await api.request('screen')
    return { release: () => sentinel.release() }
  } catch {
    return null
  }
}
