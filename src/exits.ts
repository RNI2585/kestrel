import type { RiskSettings } from './bot'

/**
 * The stop and target a position was opened with, held as absolute prices so
 * a setup's exits travel with the trade rather than with whatever strategy is
 * armed later. The bot closes the position when either level trades.
 */
export interface PositionExit {
  stopLoss: number
  takeProfit: number
}

export type ExitBook = Record<string, PositionExit>

function roundTo(value: number, dp: number): number {
  return Number(value.toFixed(dp))
}

/** Turns the risk percentages of a setup into prices around the entry fill. */
export function exitsFrom(entry: number, risk: RiskSettings, dp: number): PositionExit {
  return {
    stopLoss: roundTo(entry * (1 - risk.stopLossPct / 100), dp),
    takeProfit: roundTo(entry * (1 + risk.takeProfitPct / 100), dp),
  }
}

/** Which attached exit the tape has traded through, if any. */
export function exitHit(exit: PositionExit | undefined, price: number): 'stop' | 'target' | null {
  if (!exit) return null
  if (exit.stopLoss > 0 && price <= exit.stopLoss) return 'stop'
  if (exit.takeProfit > 0 && price >= exit.takeProfit) return 'target'
  return null
}
