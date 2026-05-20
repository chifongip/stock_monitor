# -*- mode: python ; coding: utf-8 -*-

import sys

a = Analysis(
    ['run.py'],
    pathex=[],
    binaries=[],
    datas=[('stocks.json', '.')],
    hiddenimports=['PyQt5.sip'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='stock-monitor',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=(sys.platform == 'darwin'),
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
