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

## Build an Android app (APK)

The repo is already wired for [Capacitor](https://capacitorjs.com) 8, which wraps the same web
build in a native Android shell. The native project lives in `android/` and is committed, so you
do not need to run `cap add android` again.

You need, on your own machine:

| Requirement | Version |
| --- | --- |
| Node.js | 22 or newer |
| Android Studio | Otter 2025.2.1 or newer (bundles JDK 21) |
| Android SDK platform | API 36, plus SDK Build Tools 36 |
| Minimum Android version | 7.0 (API 24) |

The JDK comes with Android Studio; do not install one separately. This machine has no Android
SDK, so the APK itself has to be built where Android Studio is installed.

```bash
npm install
npm run android:sync   # builds the web app and copies it into android/
npm run android:open   # opens the project in Android Studio
```

In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**. The debug APK lands in
`android/app/build/outputs/apk/debug/app-debug.apk`. Copy it to your phone (cable, Drive, or
`adb install -r app-debug.apk` with USB debugging on and "install unknown apps" allowed for the
file manager).

A debug APK is signed with Android's debug key, which is fine for your own phone. For a Play Store
upload or a release file you would need a keystore:

```bash
keytool -genkey -v -keystore meridian.jks -keyalg RSA -keysize 2048 -validity 10000 -alias meridian
```

Add it under **Build → Generate Signed Bundle / APK**; keep the `.jks` file and its passwords out
of the repo (`.gitignore` already excludes `*.jks` and `*.keystore`, but a committed key is still a
leaked key).

The launcher icon, round icon, adaptive icon layers and splash screens are Meridian's own branding
(`android/app/src/main/res/mipmap-*` and `drawable-port-*` / `drawable-land-*`), drawn from the
same three-bar mark as the web icons, so the installed app does not look like a Capacitor demo.

After changing web code, rerun `npm run android:sync` before building, otherwise the APK ships the
previous bundle. The web app and the APK are separate installs with separate `localStorage`:
move an account between them with **Export / Import** in the Account panel.

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
