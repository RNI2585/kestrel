import { money, signedPct } from '../format'

interface Props {
  /** Auto execution is armed: the bot runs without asking. */
  autoOn: boolean
  onToggleAuto: () => void
  botRunning: boolean
  clock: string
  /** The feed badge's text, already describing what is real. */
  feedBadge: string
  feedTitle: string
  feedWarn: boolean
  feedLive: boolean
  equity: number
  deposited: number
  pendingCount: number
  settingsActive: boolean
  onOpenSettings: () => void
  name: string
}

/** The chrome above every view: kill switch, bot state, feed state, equity. */
export default function Topbar({
  autoOn,
  onToggleAuto,
  botRunning,
  clock,
  feedBadge,
  feedTitle,
  feedWarn,
  feedLive,
  equity,
  deposited,
  pendingCount,
  settingsActive,
  onOpenSettings,
  name,
}: Props) {
  return (
    <header className="topbar">
      <div className="brand">
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
      <div className="topbar__right">
        <button
          className={`autoexec ${autoOn ? 'is-on' : ''}`}
          onClick={onToggleAuto}
          aria-pressed={autoOn}
          title={
            autoOn
              ? 'Stop auto execution and go back to approving proposals'
              : 'Run the bot and book every signal without asking'
          }
        >
          <i aria-hidden="true" />
          Auto execute
        </button>
        <span className={`topbar__bot ${botRunning ? 'is-on' : ''}`}>
          <i aria-hidden="true" />
          {botRunning ? 'Bot scanning' : 'Bot paused'}
        </span>
        <span
          className={`topbar__badge${feedWarn ? ' is-warn' : feedLive ? ' is-live' : ''}`}
          title={feedTitle}
        >
          {feedBadge}
        </span>
        <span className="topbar__clock">{clock}</span>
        <span className="topbar__equity-block">
          <span className="topbar__equity-label">Equity · paper</span>
          <strong className="topbar__equity">{money(equity)}</strong>
          <span className={`topbar__equity-delta ${equity >= deposited ? 'up' : 'down'}`}>
            {signedPct(((equity - deposited) / deposited) * 100)} today
          </span>
        </span>
        <button
          className={`topbar__gear ${settingsActive ? 'is-active' : ''}`}
          aria-label="Settings"
          aria-pressed={settingsActive}
          onClick={onOpenSettings}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M19.2 13.6a7.6 7.6 0 0 0 0-3.2l1.7-1.2-1.7-3-1.9.8a7.4 7.4 0 0 0-2.7-1.6L14.3 3h-3.4l-.3 2.4A7.4 7.4 0 0 0 7.9 7l-1.9-.8-1.7 3 1.6 1.2a7.6 7.6 0 0 0 0 3.2L4.3 14.8l1.7 3 1.9-.8a7.4 7.4 0 0 0 2.7 1.6l.3 2.4h3.4l.3-2.4a7.4 7.4 0 0 0 2.7-1.6l1.9.8 1.7-3-1.7-1.2Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
          <span className="topbar__gear-name">{name.split(' ')[0]}</span>
          {pendingCount > 0 && <span className="topbar__gear-dot" aria-hidden="true" />}
        </button>
      </div>
    </header>
  )
}
