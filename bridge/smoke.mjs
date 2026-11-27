import worker from './worker.js'

const env = {
  BRIDGE_TOKEN: 'test-token',
  PRIMEXBT_KEY_ID: 'pxk_test',
  PRIMEXBT_SECRET: 'AAAA',
  MAX_NOTIONAL: '100',
  ALLOWED_SYMBOLS: 'BTC',
  RATE_LIMIT_PER_MINUTE: '30',
}

const call = (method, path, { token = 'test-token', body, headers = {} } = {}) =>
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
    env,
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

res = await call('POST', '/close', { body: { symbol: 'BTC' } })
check('close reaches venue (not 400)', res.status !== 400 && res.status !== 401, `status ${res.status}`)

res = await call('POST', '/cancel', { body: {} })
check('cancel without id 400', res.status === 400)

res = await call('POST', '/orders', { body: { symbol: 'BTC', side: 'buy', qty: 0.001, reference_price: 69000 } })
check('under cap passes auth/limits', res.status !== 400 && res.status !== 401 && res.status !== 429, `status ${res.status}`)

let sawLimit = 0
for (let i = 0; i < 40; i++) {
  const r = await call('POST', '/cancel', { body: {} })
  if (r.status === 429) sawLimit++
}
check('rate limit engages', sawLimit > 0, `${sawLimit} of 40 were 429`)

console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL'))
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
