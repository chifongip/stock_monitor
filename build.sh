#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "Building stock-monitor with PyInstaller..."
pyinstaller stock_monitor.spec --clean --noconfirm

echo ""
echo "Build complete. Output:"
ls -lh dist/
