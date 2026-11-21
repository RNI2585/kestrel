import { useState } from 'react'
import { money } from '../format'
import type { Profile, Settings } from '../settings'

interface Props {
  profile: Profile
  settings: Settings
  onChangeSettings: (patch: Partial<Settings>) => void
  onSaveProfile: (profile: Profile) => void
  onSignOut: () => void
  onExport: () => void
  onImport: (file: File) => void
  onReset: () => void
  equity: number
  startingCash: number
}

export default function SettingsView({
  profile,
  settings,
  onChangeSettings,
  onSaveProfile,
  onSignOut,
  onExport,
  onImport,
  onReset,
  equity,
  startingCash,
}: Props) {
  const [name, setName] = useState(profile.name)
  const [email, setEmail] = useState(profile.email)
  const [saved, setSaved] = useState(false)
  const dirty = name.trim() !== profile.name || email.trim() !== profile.email
  const since = new Date(profile.since).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return (
    <div className="view">
      <div className="view__head">
        <div>
          <h1 className="view__title">Settings</h1>
          <p className="view__sub">Your profile, how the bot hands over trades, and this account.</p>
        </div>
        <span className="view__meta">{money(equity)} paper equity</span>
      </div>

      <div className="settings">
        <section className="panel">
          <header className="panel__head">
            <h2>Profile</h2>
            <span className="panel__meta">Since {since}</span>
          </header>

          <label className="field">
            <span>Display name</span>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setSaved(false)
              }}
              maxLength={40}
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setSaved(false)
              }}
              placeholder="Optional"
              maxLength={80}
            />
          </label>
          <div className="settings__actions">
            <button
              className="mini-btn"
              disabled={!dirty || !name.trim()}
              onClick={() => {
                onSaveProfile({ ...profile, name: name.trim(), email: email.trim() })
                setSaved(true)
              }}
            >
              Save profile
            </button>
            {saved && !dirty && <span className="settings__saved">Saved</span>}
          </div>
          <p className="hint">
            The profile is a name tag stored in this browser. There is no server account and no
            password to lose — signing out only clears the name, not the paper account.
          </p>
          <button className="mini-btn mini-btn--quiet settings__signout" onClick={onSignOut}>
            Sign out
          </button>
        </section>

        <section className="panel">
          <header className="panel__head">
            <h2>Trade approval</h2>
            <span className={`status ${settings.requireApproval ? 'status--on' : ''}`}>
              <i aria-hidden="true" />
              {settings.requireApproval ? 'You approve' : 'Auto-execute'}
            </span>
          </header>

          <label className="check settings__check">
            <input
              type="checkbox"
              checked={settings.requireApproval}
              onChange={(e) => onChangeSettings({ requireApproval: e.target.checked })}
            />
            <span>Ask me before the bot trades</span>
          </label>
          <p className="hint">
            {settings.requireApproval
              ? 'Signals arrive as proposals in Current trades. Nothing reaches the ledger, or a broker, until you approve it.'
              : 'The bot books its trades as soon as a signal fires, with no approval step.'}
          </p>

          <label className="slider">
            <span className="slider__row">
              <span>Retire a setup after price moves</span>
              <span className="slider__value">{settings.maxDriftPct.toFixed(1)}%</span>
            </span>
            <input
              type="range"
              min={0.1}
              max={2}
              step={0.1}
              value={settings.maxDriftPct}
              disabled={!settings.requireApproval}
              onChange={(e) => onChangeSettings({ maxDriftPct: Number(e.target.value) })}
            />
          </label>
          <p className="hint">
            Approving a proposal whose price has drifted further than this is refused, so a stale
            signal is never filled at a worse price.
          </p>
        </section>

        <section className="panel">
          <header className="panel__head">
            <h2>Paper account</h2>
            <span className="panel__meta">Opened with {money(startingCash, 0)}</span>
          </header>
          <dl className="kv">
            <div>
              <dt>Equity now</dt>
              <dd>{money(equity)}</dd>
            </div>
            <div>
              <dt>Strategy, risk and sizing</dt>
              <dd>Bot &amp; backtest</dd>
            </div>
          </dl>
          <div className="settings__actions">
            <button className="mini-btn" onClick={onExport}>
              Export backup
            </button>
            <label className="mini-btn">
              Import backup
              <input
                type="file"
                accept="application/json,.json"
                className="settings__file"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) onImport(file)
                }}
              />
            </label>
          </div>
          <p className="hint">
            A backup holds the paper account, fills, bot settings and broker connections — never
            broker keys, which you re-enter after restoring.
          </p>
          <button className="mini-btn mini-btn--danger settings__reset" onClick={onReset}>
            Reset to {money(startingCash, 0)}
          </button>
        </section>

        <section className="panel">
          <header className="panel__head">
            <h2>About</h2>
            <span className="panel__meta">v0.1.0</span>
          </header>
          <p className="hint">
            Kestrel is a paper desk: prices are simulated, fills are simulated, and the
            seven-strategy bot trades the same cash balance you do. Orders only leave the browser
            when you route them to a broker you connected yourself.
          </p>
        </section>
      </div>
    </div>
  )
}
