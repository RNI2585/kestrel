/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

/** A small in-memory Storage, so the test does not depend on the host's. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value))
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  // No network and no sockets in a unit test: the desk has to survive a dead
  // feed, which is exactly what the simulated tape and the badge are for.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  vi.stubGlobal('WebSocket', undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the terminal shell', () => {
  it('signs in and moves between the views without throwing', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Sign in to your desk' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue as guest' }))

    expect(screen.getByText('Kestrel')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Auto execute' })).toBeTruthy()
    expect(screen.getByText('Bot paused')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Trades/ }))
    expect(screen.getByRole('heading', { name: 'Current trades' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Trade analytics' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Portfolio risk' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Desk log' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Brokers/ }))
    expect(screen.getByRole('heading', { name: 'Costs & reconciliation' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Setup/ }))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByText('Quote stream URL')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Desk/ }))
    expect(screen.getByRole('heading', { name: 'XAU' })).toBeTruthy()
  }, 30_000)

  it('arms auto execution and reflects it in the chrome', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue as guest' }))

    const toggle = screen.getByRole('button', { name: 'Auto execute' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Bot scanning')).toBeTruthy()
  }, 30_000)

  it('opens the desk from a restored profile without a sign-in screen', () => {
    localStorage.setItem(
      'kestrel.profile.v1',
      JSON.stringify({ name: 'Alex Mercer', email: '', since: Date.now() }),
    )
    render(<App />)
    expect(screen.queryByRole('heading', { name: 'Sign in to your desk' })).toBeNull()
    expect(screen.getByText('Alex')).toBeTruthy()
  }, 30_000)
})
