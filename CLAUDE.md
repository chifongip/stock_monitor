# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Terminal-based real-time Hong Kong stock monitor with price alerts and technical analysis signals. Single-file Node.js application (`terminal-stock-alert.js`) that renders a live-updating table in the terminal.

## Commands

- `npm start` — Run the application
- `npm run build` — Compile standalone binaries (Linux/macOS/Windows) via `pkg`

No test framework, linter, or CI is configured.

## Architecture

Everything lives in `terminal-stock-alert.js` (379 lines). Key sections:

1. **Config management** — Loads/saves `stocks.json` (tracked stock codes, alert targets, UI prefs like `compactMode`, `showNames`, `sortingMode`).
2. **Input handling** — Two modes: normal (readline commands: `a` add, `r` remove, `t` set target, `ua` unset alert, `name`/`compact`/`s` toggles) and sorting (raw stdin with arrow keys for reordering).
3. **Data fetching** (`getHKRealTimePrice`) — Pulls from `realtime-money18-cdn.on.cc` API. Returns price, change, MA10/20/50, RSI14, 52-week/10-day highs/lows, daily range, volume.
4. **Technical analysis** (`getTechnicalSignal`) — Composite score from MA position, RSI, 52-week range, 10-day range, and intraday momentum. Outputs STRONG BUY through STRONG SELL.
5. **Alert system** (`checkAlert`) — Fires desktop notification via `node-notifier` when price crosses a user-set target. Has 10s grace period on new targets and 15-min cooldown between alerts.
6. **UI rendering** (`displayTable`) — Redraws `cli-table3` table every 5 seconds. Supports compact mode and sorting mode with checkbox column.
7. **Main loop** — `setInterval` at 5000ms calling `displayTable()`.

## Dependency Note

`cli-table3`, `chalk`, and `node-notifier` are used in code but **not listed in `package.json`**. A clean `npm install` from the manifest alone will fail at runtime. These must be added to `package.json` dependencies before rebuilding.
