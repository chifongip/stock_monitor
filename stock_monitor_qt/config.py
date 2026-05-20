import json
import os
import sys
import time

if getattr(sys, 'frozen', False):
    CONFIG_FILE = os.path.join(os.path.dirname(sys.executable), 'stocks.json')
else:
    CONFIG_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'stocks.json')

DEFAULT_CONFIG = {
    'stocks': ['00700', '00005', '02800'],
    'targets': {},
    'lastAlerted': {},
    'targetSetTime': {},
    'lastPrice': {},
    'showNames': True,
    'compactMode': False,
}

_config = dict(DEFAULT_CONFIG)


def load_config():
    global _config
    _config = dict(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE) as f:
                file_data = json.load(f)
            if isinstance(file_data, list):
                _config['stocks'] = file_data
            else:
                _config.update(file_data)
        except (json.JSONDecodeError, OSError):
            save_config()
    return _config


def get_config():
    return _config


def save_config():
    with open(CONFIG_FILE, 'w') as f:
        json.dump(_config, f)


def add_stock(code):
    code = code.zfill(5)
    if code not in _config['stocks']:
        _config['stocks'].append(code)
        save_config()
        return True
    return False


def remove_stock(code):
    code = code.zfill(5)
    if code in _config['stocks']:
        _config['stocks'].remove(code)
        _config['targets'].pop(code, None)
        _config['lastAlerted'].pop(code, None)
        _config['targetSetTime'].pop(code, None)
        _config['lastPrice'].pop(code, None)
        save_config()
        return True
    return False


def set_target(code, price):
    code = code.zfill(5)
    _config['targets'][code] = price
    _config['lastAlerted'][code] = 0
    _config['targetSetTime'][code] = int(time.time() * 1000)
    save_config()


def unset_alert(code):
    code = code.zfill(5)
    _config['targets'].pop(code, None)
    _config['lastAlerted'].pop(code, None)
    _config['targetSetTime'].pop(code, None)
    save_config()


def update_last_price(code, price):
    _config['lastPrice'][code] = price


def set_alert_fired(code):
    _config['lastAlerted'][code] = int(time.time() * 1000)
    save_config()


def reorder_stocks(new_order):
    _config['stocks'] = list(new_order)
    save_config()
