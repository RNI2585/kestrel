# Meridian — paper trading terminal

A self-contained terminal for paper trading stocks, metals, FX, energy and crypto. Everything
runs in the browser: the market feed is simulated locally, the account is a simulated ledger, and
no server ever sees your state. It also installs as an app on a phone or desktop and works offline.

## Run it locally

```bash
npm install
npm run dev
```

Vite prints a local address (usually `http://localhost:5173`). `npm run build` type-checks and
writes a static `dist/` folder you can serve from any static host; `npm run preview` serves that
build. There is no backend, no database and no build-time secret.

## Install it on a phone (Android or iOS)

The project ships a web app manifest (`public/manifest.webmanifest`) and a service worker
(`public/sw.js`), so a hosted copy installs to the home screen and runs offline after the first
visit. You need an `https://` address for this — a deployed copy, not `http://` LAN dev.

- **Android / Chrome:** open the site → menu (⋮) → **Add to Home screen** / **Install app**.
  It launches full screen with no browser chrome, like a normal app.
- **iOS / Safari:** Share → **Add to Home Screen**.

Because it is a web app rather than an `.apk`, installing it needs no sideloading, no unknown
sources toggle and no update step: opening it while online picks up the newest build. Store
publishing is the only thing this does not give you.

## Your data

- State lives in `this browser's localStorage` under `meridian.terminal.v1`, per origin. A copy
  served from a different host or port is a separate account.
- **Export / Import** in the Account panel writes the whole terminal — portfolio, fills, bot
  settings, working orders, equity history, broker list and per-class routing — to a JSON file and
  reads it back. Use it to move between devices or to keep a backup; clearing site data otherwise
  resets the account.
- Exported files deliberately **do not contain broker keys or secrets**. After a restore, affected
  venues ask for credentials again.

## Broker connections

Broker keys are stored locally in plain text in `localStorage`. If you connect a real venue:

- use paper or read-only keys where the venue offers them, and disable withdrawals;
- keep them in a local copy of the terminal rather than a shared computer;
- assume only the paper ledger is proven. Exchanges reject direct browser calls (CORS), so routing
  to a live venue needs your own proxy/bridge at the endpoint you configure, and that path has not
  been tested against a real account here.

The account is long-only by design: sells reduce or close an existing position.

## Layout

| Area | What it does |
| --- | --- |
| Watchlist / chart | Instruments across five asset classes, 1H / 1D / 1W ranges |
| Trade setup | Market and limit orders, venue selector, open position |
| Current trades | Account, positions, equity curve, working orders, activity |
| Bot & backtest | Seven strategies with per-strategy risk, stop and target; sweep and apply |
| Broker connections | Local venue list, keys, connection test, routing |
| Scripts | Chart-derived plans and plain-English instructions |

## Notes

- Fonts load from Google Fonts; offline the terminal falls back to system fonts.
- Prices are simulated with a local model, not real quotes. Nothing here is investment advice.
