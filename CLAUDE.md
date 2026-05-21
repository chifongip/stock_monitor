# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Real-time Hong Kong stock monitor with price alerts and composite technical analysis signals. Python/PyQt5 desktop application (`stock_monitor_qt/`).

## Commands

- `python3 -m stock_monitor_qt` — Run the application
- `python3 run.py` — Alternative entry point

No test framework, linter, or CI is configured. Only external dependency: `PyQt5`.

## Architecture

### Files

| File | Purpose |
|------|---------|
| `stock_monitor_qt/api.py` | Data fetching (`fetch_stock`), signal generation (`get_technical_signal`), alert logic (`check_alert`), state persistence (`update_stock_state`) |
| `stock_monitor_qt/config.py` | Configuration persistence (`stocks.json`). Manages stock list, alert targets, MA history, volume history, UI prefs |
| `stock_monitor_qt/main.py` | PyQt5 `QMainWindow`, 5s refresh loop, command input handling, desktop notifications |
| `stock_monitor_qt/widgets.py` | `QTableWidget` subclass, colors, table rendering, drag-and-drop reorder, context menu |
| `stocks.json` | Runtime config (stock codes, targets, last prices, prevMA, volumeHistory) |

### Data Flow

1. `_refresh()` fires every 5s, spawns `FetchWorker` per stock via `QThreadPool`
2. `fetch_stock(code)` pulls from Money18 API (`realtime-money18-cdn.on.cc`)
3. `_on_stock_fetched()` processes result: `check_alert()`, `update_stock_state()`, `get_technical_signal()`
4. `update_stock_row()` updates the table display

### Signal Generation (`get_technical_signal`)

9 scoring components (total range: -131 to +131):

| # | Component | Range | Description |
|---|-----------|-------|-------------|
| 1 | Granular MA | -30 to +30 | +10/-10 per MA independently (MA10, MA20, MA50) |
| 2 | RSI interpolation | -30 to +30 | Linear mapping RSI [30,70] -> [+30,-30], flat at extremes |
| 3 | 52-week range | -15 to +15 | Linear [0%,100%] -> [+15,-15] |
| 4 | 10-day range | -8 to +8 | Linear [0%,100%] -> [+8,-8] |
| 5 | Intraday momentum | -10 to +10 | Binary: strong move at day extremes confirms direction |
| 6 | Volume confirmation | -10 to +10 | Compares current volume delta rate vs rolling 20-sample avg |
| 7 | MA crossover | -12 to +12 | Detects MA10/MA20 and MA20/MA50 crossovers from previous refresh |
| 8 | Trend strength | -8 to +8 | MA10-MA50 spread as % of price, clamped to +/-2% |
| 9 | Mean reversion | -8 to +8 | Price deviation from MA20, inverted (far above = bearish) |

Signal thresholds: >=75 STRONG BUY, >=35 BUY, >=12 MILD BUY, -11 to +11 HOLD, <=-12 MILD SELL, <=-35 SELL, <=-75 STRONG SELL.

### State Persistence (`update_stock_state`)

- `prevMA`: Previous MA values for crossover detection (dict per stock code)
- `volumeHistory`: Rolling window of 20 volume deltas for volume confirmation
- `_lastVolume`: Transient working dict for delta computation (not persisted to JSON)

### Alert System (`check_alert`)

User-configured price targets. Fires desktop notification via `notify-send` when price crosses target. 10s grace period on new targets, 15-min cooldown between alerts.

### UI Features

- Dark theme, optional color mode, compact mode, name column toggle
- Drag-and-drop row reordering (persisted to config)
- Right-click context menu (set target, unset alert, remove stock)
- Command input: `a [code]`, `r [code]`, `t [code] [price]`, `ua [code]`, `name`, `compact`, `color`
