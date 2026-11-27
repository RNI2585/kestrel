/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Proposals from '../components/Proposals'
import type { Proposal } from '../settings'

afterEach(cleanup)

describe('broker-accepted proposals', () => {
  it('shows accepted orders as sent, not filled or awaiting approval', () => {
    const proposal: Proposal = {
      id: 'proposal-1',
      ts: Date.now(),
      symbol: 'BTC',
      side: 'buy',
      qty: 1,
      price: 100,
      reason: 'Momentum signal',
      status: 'accepted',
      note: 'Order accepted; fill not confirmed.',
    }

    render(<Proposals proposals={[proposal]} onApprove={vi.fn()} onSkip={vi.fn()} />)

    expect(screen.getByText('Sent')).toBeTruthy()
    expect(screen.getByText('Order accepted; fill not confirmed.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })
})
