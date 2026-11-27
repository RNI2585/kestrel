import { useState } from 'react'
import { money } from '../format'
import { clampLimits, type RiskLimits } from '../risk'
import type { Profile, Settings } from '../settings'

/** One input per governor limit, in the order they matter. */
const RISK_FIELDS: {
  key: keyof RiskLimits
  label: string
  unit: string
  min: number
  max: number
  step: number
}[] = [
  { key: 'maxDailyLossPct', label: 'Daily loss limit', unit: '%', min: 0.1, max: 50, step: 0.1 },
  { key: 'maxExposurePct', label: 'Max exposure', unit: '%', min: 5, max: 500, step: 5 },
  {
    key: 'maxClassExposurePct',
    label: 'Max exposure per asset class',
    unit: '%',
    min: 5,
    max: 100,
    step: 5,
  },
  { key: 'maxPositions', label: 'Max open positions', unit: '', min: 1, max: 50, step: 1 },
  { key: 'maxTradesPerDay', label: 'Max entries a day', unit: '', min: 1, max: 500, step: 1 },
  { key: 'maxConsecutiveLosses', label: 'Pause after losers in a row', unit: '', min: 1, max: 50, step: 1 },
  { key: 'graduationTrades', label: 'Graduation bar', unit: ' closed', min: 1, max: 200, step: 1 },
  { key: 'maxQuoteAgeSec', label: 'Max quote age', unit: 's', min: 15, max: 3600, step: 15 },
]

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
            <h2>Risk governor</h2>
            <span className={`status ${settings.limits.requireGraduation ? 'status--on' : ''}`}>
              <i aria-hidden="true" />
              {settings.limits.requireGraduation ? 'Graduation enforced' : 'Ungraded models'}
            </span>
          </header>
          <p className="hint">
            These limits pause new entries — never exits — and the day resets at local midnight.
            Every breach is written to the desk log in Current trades.
          </p>
          <div className="settings__risk">
            {RISK_FIELDS.map((field) => (
              <label className="field field--tight" key={field.key}>
                <span>
                  {field.label}
                  {field.unit && <em className="field__unit">{field.unit}</em>}
                </span>
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={settings.limits[field.key] as number}
                  onChange={(e) =>
                    onChangeSettings({
                      limits: clampLimits({
                        ...settings.limits,
                        [field.key]: Number(e.target.value),
                      }),
                    })
                  }
                />
              </label>
            ))}
          </div>
          <label className="check settings__check">
            <input
              type="checkbox"
              checked={settings.limits.requireGraduation}
              onChange={(e) =>
                onChangeSettings({
                  limits: { ...settings.limits, requireGraduation: e.target.checked },
                })
              }
            />
            <span>Only trade a model unattended once it has earned it</span>
          </label>
          <p className="hint">
            With this on, auto execution needs {settings.limits.graduationTrades} closed round trips
            on the armed model and a positive net result before it will book a single entry.
            Proposals are always allowed, so a new model can still build that record.
          </p>
        </section>

        <section className="panel">
          <header className="panel__head">
            <h2>Live quotes</h2>
            <span className={`status ${settings.streamUrl.trim() ? 'status--on' : ''}`}>
              <i aria-hidden="true" />
              {settings.streamUrl.trim() ? 'Bridge set' : 'Public feeds'}
            </span>
          </header>
          <label className="field">
            <span>Quote stream URL</span>
            <input
              value={settings.streamUrl}
              placeholder="https://your-bridge.example.com/quotes"
              spellCheck={false}
              onChange={(e) => onChangeSettings({ streamUrl: e.target.value })}
            />
          </label>
          <p className="hint">
            Crypto already streams from Coinbase’s public ticker socket. Stocks and energy have no
            key-less feed, so they stay simulated until an SSE bridge you run emits{' '}
            {'{"symbol":"AAPL","price":228.4}'} events on this URL. Keep any provider key inside
            that bridge — never in this field.
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
            broker keys, which you re-enter after restoring. The desk also saves to this browser on
            every change, with a rolling snapshot kept as a fallback.
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
