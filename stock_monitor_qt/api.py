import json
import re
import urllib.request

from .config import get_config


def fetch_stock(code):
    url = f'https://realtime-money18-cdn.on.cc/securityQuote/genStockDetailHKJSON.php?stockcode={code}'
    req = urllib.request.Request(url, headers={
        'Referer': 'https://money18.on.cc/',
        'User-Agent': 'Mozilla/5.0',
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
        start = raw.index('{')
        end = raw.rindex('}') + 1
        cleaned = raw[start:end]
        cleaned = re.sub(r'\r?\n|\r', '', cleaned)
        cleaned = re.sub(r'\t', '', cleaned)
        cleaned = re.sub(r' {2,}', ' ', cleaned)
        data = json.loads(cleaned)

        daily = data.get('daily', {})
        real = data.get('real', {})
        calc = data.get('calculation', {})

        return {
            'code': code,
            'name': daily.get('nameChi') or daily.get('name', ''),
            'price': float(real.get('np', 0)),
            'preClose': float(daily.get('preCPrice', 0)),
            'change': calc.get('change', '0'),
            'percent': str(calc.get('pctChange', '0')) + '%',
            'time': real.get('ltt', ''),
            'ma10': float(daily['ma10']) if daily.get('ma10') else None,
            'ma20': float(daily['ma20']) if daily.get('ma20') else None,
            'ma50': float(daily['ma50']) if daily.get('ma50') else None,
            'rsi14': float(daily['rsi14']) if daily.get('rsi14') else None,
            'wk52High': float(daily['wk52High']) if daily.get('wk52High') else None,
            'wk52Low': float(daily['wk52Low']) if daily.get('wk52Low') else None,
            'tenDayHigh': float(daily['tenDayHigh']) if daily.get('tenDayHigh') else None,
            'tenDayLow': float(daily['tenDayLow']) if daily.get('tenDayLow') else None,
            'dayHigh': float(real['dyh']) if real.get('dyh') else None,
            'dayLow': float(real['dyl']) if real.get('dyl') else None,
            'volume': float(real.get('vol', 0)),
        }
    except Exception as e:
        print(f'Error fetching {code}: {e}')
        return None


def update_stock_state(stock, config):
    code = stock['code']

    if stock['ma10'] and stock['ma20'] and stock['ma50']:
        config['prevMA'][code] = {
            'ma10': stock['ma10'],
            'ma20': stock['ma20'],
            'ma50': stock['ma50'],
        }

    prev_vol = config.get('_lastVolume', {}).get(code)
    current_vol = stock.get('volume', 0)
    if prev_vol is not None and current_vol > 0:
        delta = current_vol - prev_vol
        if delta > 0:
            history = config['volumeHistory'].setdefault(code, [])
            history.append(delta)
            if len(history) > 20:
                history.pop(0)

    config.setdefault('_lastVolume', {})[code] = current_vol


def get_technical_signal(stock, config=None):
    if not stock['ma10'] or not stock['ma20'] or not stock['ma50'] or not stock['rsi14']:
        return 'N/A', 0, 'gray'

    if config is None:
        config = get_config()

    p = stock['price']
    rsi = stock['rsi14']
    score = 0

    # 1. Granular MA scoring: +10/-10 per MA independently
    for ma_val in [stock['ma10'], stock['ma20'], stock['ma50']]:
        if p > ma_val:
            score += 10
        elif p < ma_val:
            score -= 10

    # 2. RSI interpolation: linear mapping [30,70] -> [+30,-30]
    if rsi <= 30:
        score += 30
    elif rsi >= 70:
        score -= 30
    else:
        score += int(30 - (rsi - 30) * 60 / 40)

    # 3. 52-week range: linear [0%,100%] -> [+15,-15]
    if stock['wk52High'] and stock['wk52Low'] and stock['wk52High'] != stock['wk52Low']:
        range_pct = (p - stock['wk52Low']) / (stock['wk52High'] - stock['wk52Low']) * 100
        score += int(15 - range_pct * 30 / 100)

    # 4. 10-day range: linear [0%,100%] -> [+8,-8]
    if stock['tenDayHigh'] and stock['tenDayLow'] and stock['tenDayHigh'] != stock['tenDayLow']:
        ten_day_pct = (p - stock['tenDayLow']) / (stock['tenDayHigh'] - stock['tenDayLow']) * 100
        score += int(8 - ten_day_pct * 16 / 100)

    # 5. Intraday momentum (unchanged)
    if stock['dayHigh'] and stock['dayLow'] and stock['dayHigh'] != stock['dayLow']:
        day_pct = (p - stock['dayLow']) / (stock['dayHigh'] - stock['dayLow']) * 100
        change_str = str(stock['change'])
        if day_pct < 30 and change_str.startswith('-'):
            score -= 10
        if day_pct > 70 and not change_str.startswith('-'):
            score += 10

    # 6. Volume confirmation
    vol_history = config.get('volumeHistory', {}).get(stock['code'], [])
    if vol_history and len(vol_history) >= 3:
        avg_delta = sum(vol_history) / len(vol_history)
        if avg_delta > 0:
            prev_vol = config.get('_lastVolume', {}).get(stock['code'])
            if prev_vol:
                current_vol = stock.get('volume', 0)
                current_delta = current_vol - prev_vol
                vol_ratio = current_delta / avg_delta
                change_str = str(stock['change'])
                is_up = not change_str.startswith('-')

                if vol_ratio > 1.5:
                    score += 10 if is_up else -10
                elif vol_ratio > 1.0:
                    score += 5 if is_up else -5
                elif vol_ratio < 0.5:
                    score += -3 if is_up else 3

    # 7. MA crossover detection
    prev = config.get('prevMA', {}).get(stock['code'])
    if prev and prev.get('ma10') and prev.get('ma20') and prev.get('ma50'):
        prev_10_above_20 = prev['ma10'] > prev['ma20']
        curr_10_above_20 = stock['ma10'] > stock['ma20']
        if not prev_10_above_20 and curr_10_above_20:
            score += 8
        elif prev_10_above_20 and not curr_10_above_20:
            score -= 8

        prev_20_above_50 = prev['ma20'] > prev['ma50']
        curr_20_above_50 = stock['ma20'] > stock['ma50']
        if not prev_20_above_50 and curr_20_above_50:
            score += 12
        elif prev_20_above_50 and not curr_20_above_50:
            score -= 12

    # 8. Trend strength: MA10-MA50 spread as % of price
    if stock['ma50']:
        spread_pct = (stock['ma10'] - stock['ma50']) / p * 100
        clamped = max(-2.0, min(2.0, spread_pct))
        score += int(clamped * 4)

    # 9. Mean reversion: price deviation from MA20, inverted
    if stock['ma20']:
        deviation_pct = (p - stock['ma20']) / stock['ma20'] * 100
        clamped = max(-5.0, min(5.0, deviation_pct))
        score += int(-clamped * 8 / 5)

    if score >= 75:
        return 'STRONG BUY', score, 'green_bold'
    elif score >= 35:
        return 'BUY', score, 'green'
    elif score <= -75:
        return 'STRONG SELL', score, 'red_bold'
    elif score <= -35:
        return 'SELL', score, 'red'
    elif score >= 12:
        return 'MILD BUY', score, 'green'
    elif score <= -12:
        return 'MILD SELL', score, 'red'
    else:
        return 'HOLD', score, 'yellow'


def check_alert(stock, cfg):
    target = cfg['targets'].get(stock['code'])
    if target is None:
        return '-', 'gray', False

    current = stock['price']
    last_price = cfg['lastPrice'].get(stock['code'], stock['preClose'])
    last_alert_time = cfg['lastAlerted'].get(stock['code'], 0)
    target_set_time = cfg['targetSetTime'].get(stock['code'], 0)
    now = int(__import__('time').time() * 1000)
    cooldown = 15 * 60 * 1000

    just_set = (now - target_set_time < 10000)

    triggered = False
    msg = ''

    if last_price < target and current >= target:
        triggered = True
        msg = f'crossed UP to {current:.3f} (target {target})'
    elif last_price > target and current <= target:
        triggered = True
        msg = f'crossed DOWN to {current:.3f} (target {target})'
    elif last_price != target and current == target:
        triggered = True
        msg = f'exactly hit {target}'

    if triggered and not just_set and (now - last_alert_time > cooldown):
        return f' HIT {target} ', 'alert', True

    if current > target:
        return f'▼ [T: {target}]', 'cyan', False
    elif current < target:
        return f'▲ [T: {target}]', 'cyan', False
    else:
        return f'→ [T: {target}]', 'cyan', False
