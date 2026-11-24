import { afterEach, describe, expect, it, vi } from 'vitest'
import { START_CASH } from '../trade'
import { loadSettings } from '../settings'
import { DESK_STORAGE_KEY, loadBot, loadState, parseState, saveDesk } from '../storage'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('saved portfolio validation', () => {
  it('rejects non-finite cash and malformed holdings', () => {
    expect(
      parseState('{"portfolio":{"cash":1e309,"holdings":{}}}'),
    ).toBeNull()
    expect(
      parseState(
        JSON.stringify({
          portfolio: { cash: 100, holdings: { BTC: { qty: '1', avgCost: 10 } } },
        }),
      ),
    ).toBeNull()
    expect(
      parseState(
        JSON.stringify({
          portfolio: { cash: 0, holdings: { BTC: { qty: 1e308, avgCost: 1e308 } } },
        }),
      ),
    ).toBeNull()
  })

  it('fills missing legacy account totals from the original defaults', () => {
    const parsed = parseState(
      JSON.stringify({ portfolio: { cash: 500, holdings: { BTC: { qty: 1, avgCost: 10 } } } }),
    )

    expect(parsed?.portfolio).toEqual({
      cash: 500,
      holdings: { BTC: { qty: 1, avgCost: 10 } },
      realized: 0,
      deposited: START_CASH,
    })
  })

  it('filters malformed fills and orders and bounds imported bot settings', () => {
    const parsed = parseState(
      JSON.stringify({
        portfolio: { cash: 100, holdings: {} },
        fills: [null, { side: 'buy', qty: 1 }],
        orders: [{ status: 'working', qty: 'many' }],
      }),
    )
    expect(parsed?.fills).toEqual([])
    expect(parsed?.orders).toEqual([])

    const bot = loadBot({
      maxAllocPct: 500,
      riskPrefs: { momentum: { riskPct: 500, stopLossPct: 50, takeProfitPct: 0 } },
      params: { momentum: { fast: 500, slow: 1 } },
    })
    expect(bot.maxAllocPct).toBe(100)
    expect(bot.riskPrefs.momentum).toEqual({
      riskPct: 10,
      stopLossPct: 10,
      takeProfitPct: 2,
    })
    expect(bot.params.momentum).toEqual({ fast: 40, slow: 20 })
  })

  it('bounds restored proposal drift settings', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ maxDriftPct: 500 }),
    })

    expect(loadSettings().maxDriftPct).toBe(2)
  })

  it('starts in memory when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage disabled')
      },
    })

    expect(loadState().portfolio.cash).toBe(START_CASH)
  })

  it('refuses to overwrite a desk changed in another tab', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
    })
    const state = loadState()

    expect(saveDesk(state)).toBe(true)
    values.set(DESK_STORAGE_KEY, 'updated elsewhere')
    expect(saveDesk(state)).toBe(false)
  })
})
