import { describe, expect, it } from 'vitest'
import { httpUrlError } from '../urlPolicy'

describe('configured network URLs', () => {
  it('accepts HTTPS services and local HTTP bridges', () => {
    expect(httpUrlError('https://broker.example/api', 'Broker endpoint')).toBeNull()
    expect(httpUrlError('http://localhost:5000/quotes', 'Quote stream', true)).toBeNull()
  })

  it('rejects remote plaintext URLs and embedded credentials', () => {
    expect(httpUrlError('http://broker.example/api', 'Broker endpoint')).toMatch(/HTTPS/)
    expect(httpUrlError('https://user:secret@broker.example', 'Broker endpoint')).toMatch(
      /credentials/,
    )
    expect(httpUrlError('https://broker.example/api?key=secret', 'Broker endpoint')).toMatch(
      /query/,
    )
  })
})
