import worker from './worker.js'

const env = {
  BRIDGE_TOKEN: 'test-token',
  PRIMEXBT_KEY_ID: 'pxk_test',
  PRIMEXBT_SECRET: 'AAAA',
  MAX_NOTIONAL: '100',
  ALLOWED_SYMBOLS: 'BTC',
  RATE_LIMIT_PER_MINUTE: '30',
}

const call = (method, path, { token = 'test-token', body, headers = {}, env: target = env } = {}) =>
  worker.fetch(
    new Request(`https://b.test${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
        'cf-connecting-ip': '10.0.0.1',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    target,
  )

const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)

let res = await call('GET', '/health', { token: '' })
const health = await res.json()
check('health 200', res.status === 200)
check('health lists routes', Boolean(health.routes?.close && health.routes?.cancel && health.routes?.positions))
check('health caps notional', health.limits?.maxNotional === 100, String(health.limits?.maxNotional))
check('health symbols normalised', JSON.stringify(health.limits?.symbols) === '["BTC/USD"]')

res = await call('GET', '/account', { token: '' })
check('no token 401', res.status === 401)

res = await call('GET', '/account', { token: 'wrong' })
check('wrong token 401', res.status === 401)

res = await call('POST', '/orders', { body: { symbol: 'DOGE', side: 'buy', qty: 1 } })
check('symbol outside allowlist 400', res.status === 400, (await res.json()).error)

res = await call('POST', '/orders', { body: { symbol: 'BTC', side: 'buy', qty: 1, reference_price: 69000 } })
check('over notional cap 400', res.status === 400, (await res.json()).error)

res = await call('POST', '/orders', { body: { symbol: 'BTC', side: 'buy', qty: 0.001 } })
check('cap without price 400', res.status === 400, (await res.json()).error)

res = await call('POST', '/orders', { body: { symbol: 'BTC', side: 'hold', qty: 0.001, reference_price: 69000 } })
check('bad side 400', res.status === 400)

res = await call('POST', '/orders', { body: { symbol: 'BTC', side: 'buy', qty: 0.001, type: 'limit' } })
check('limit without price 400', res.status === 400, (await res.json()).error)

res = await call('POST', '/orders', { body: { symbol: 'BTC', side: 'buy', qty: 0.001, type: 'bogus' } })
check('unknown order type 400', res.status === 400, (await res.json()).error)

res = await call('POST', '/orders', {
  body: { symbol: 'BTC', side: 'buy', qty: 1, type: 'limit', price: 100000 },
})
check('limit uses price for the cap', res.status === 400, (await res.json()).error)

res = await call('POST', '/orders', {
  body: { symbol: 'BTC', side: 'buy', qty: 0.001, type: 'limit', price: 50000 },
})
check('limit under the cap reaches the venue', res.status !== 400 && res.status !== 429, `status ${res.status}`)

res = await call('GET', '/working')
check('working orders reaches the venue', res.status !== 400 && res.status !== 404, `status ${res.status}`)

res = await call('POST', '/close', { body: { symbol: 'BTC' } })
check('close reaches venue (not 400)', res.status !== 400 && res.status !== 401, `status ${res.status}`)

res = await call('POST', '/cancel', { body: {} })
check('cancel without id 400', res.status === 400)

res = await call('POST', '/cancel', { body: { orderId: 'kestrelprobe1' } })
check('cancel refuses a non-numeric id', res.status === 400, (await res.json()).error)

res = await call('POST', '/cancel', { body: { orderId: '999999999999' } })
check('numeric cancel reaches the venue', res.status !== 400 && res.status !== 401, `status ${res.status}`)

res = await call('POST', '/orders', { body: { symbol: 'BTC', side: 'buy', qty: 0.001, reference_price: 69000 } })
check('under cap passes auth/limits', res.status !== 400 && res.status !== 401 && res.status !== 429, `status ${res.status}`)

let sawLimit = 0
let memoryScope = ''
for (let i = 0; i < 40; i++) {
  const r = await call('POST', '/cancel', { body: {} })
  if (r.status === 429) {
    sawLimit++
    memoryScope = r.headers.get('x-rate-scope') ?? ''
  }
}
check('rate limit engages', sawLimit > 0, `${sawLimit} of 40 were 429`)
check('memory limiter labels itself', memoryScope === 'memory', memoryScope || 'no header')

// A D1 binding should make the counter shared rather than per-isolate.
const rows = new Map()
const fakeDb = {
  prepare(sql) {
    let args = []
    const stmt = {
      bind(...a) {
        args = a
        return stmt
      },
      async run() {
        return { success: true }
      },
      async first() {
        if (!sql.startsWith('INSERT')) return null
        const row = `${args[0]}|${args[1]}`
        const hits = (rows.get(row) ?? 0) + 1
        rows.set(row, hits)
        return { hits }
      },
    }
    return stmt
  },
}
const durableEnv = { ...env, RATE_LIMIT_PER_MINUTE: '3', RATE_DB: fakeDb }

let durableHits = 0
let durableScope = ''
for (let i = 0; i < 6; i++) {
  const r = await call('POST', '/cancel', { body: {}, env: durableEnv })
  if (r.status === 429) {
    durableHits++
    durableScope = r.headers.get('x-rate-scope') ?? ''
  }
}
check('durable limiter shares one counter', durableHits === 3, `${durableHits} of 6 were 429`)
check('durable limiter labels itself', durableScope === 'durable', durableScope || 'no header')

const durableHealth = await (await call('GET', '/health', { token: '', env: durableEnv })).json()
check('health reports durable scope', durableHealth.limits?.rateLimitScope === 'durable (D1)')

const brokenEnv = { ...env, RATE_DB: { prepare() { throw new Error('no db') } } }
const fallback = await call('POST', '/cancel', {
  body: {},
  env: brokenEnv,
  headers: { 'cf-connecting-ip': '10.9.9.9' },
})
check('broken RATE_DB falls back to memory', fallback.status === 400, `status ${fallback.status}`)

console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL'))
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
