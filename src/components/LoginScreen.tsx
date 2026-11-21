import { useState } from 'react'
import type { Profile } from '../settings'

interface Props {
  onSubmit: (profile: Profile) => void
}

/**
 * The terminal opens behind a local sign-in. There is no server account in a
 * paper-trading app, so the profile is a name tag kept in this browser — the
 * copy says so rather than pretending a password protects anything.
 */
export default function LoginScreen({ onSubmit }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [problem, setProblem] = useState('')

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const clean = name.trim()
    if (!clean) {
      setProblem('Enter a name for your desk.')
      return
    }
    onSubmit({ name: clean.slice(0, 40), email: email.trim().slice(0, 80), since: Date.now() })
  }

  return (
    <div className="login">
      <div className="login__card">
        <div className="brand login__brand">
          <span className="brand__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17">
              <path d="M13 3 5 14h6l-1 7 8-11h-6Z" fill="currentColor" />
            </svg>
          </span>
          <div>
            <div className="brand__name">Kestrel</div>
            <div className="brand__sub">Paper desk · Broker bridge</div>
          </div>
        </div>

        <h1 className="login__title">Sign in to your desk</h1>
        <p className="login__sub">
          One paper account across stocks, metals, FX, energy and crypto.
        </p>

        <form onSubmit={submit} className="login__form">
          <label className="field">
            <span>Your name</span>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (problem) setProblem('')
              }}
              placeholder="Alex Mercer"
              autoComplete="name"
              autoFocus
            />
          </label>
          <label className="field">
            <span>Email (optional)</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@example.com"
              autoComplete="email"
            />
          </label>
          {problem && <p className="login__problem">{problem}</p>}
          <button className="submit login__submit" type="submit">
            Open the terminal
          </button>
        </form>

        <button
          className="link-btn login__guest"
          type="button"
          onClick={() =>
            onSubmit({ name: 'Guest trader', email: '', since: Date.now() })
          }
        >
          Continue as guest
        </button>

        <p className="login__note">
          This profile is stored in this browser only. Nothing is sent anywhere, and the paper
          account stays on this device.
        </p>
      </div>
    </div>
  )
}
