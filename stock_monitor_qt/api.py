import json
import re
import urllib.request


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


def get_technical_signal(stock):
    if not stock['ma10'] or not stock['ma20'] or not stock['ma50'] or not stock['rsi14']:
        return 'N/A', 'gray'

    p = stock['price']
    rsi = stock['rsi14']
    score = 0

    above_all = p > stock['ma10'] and p > stock['ma20'] and p > stock['ma50']
    below_all = p < stock['ma10'] and p < stock['ma20'] and p < stock['ma50']
    if above_all:
        score += 40
    elif below_all:
        score -= 40
    elif p > stock['ma50']:
        score += 15
    else:
        score -= 15

    if rsi > 70:
        score -= 30
    elif rsi < 30:
        score += 30
    elif rsi > 60:
        score -= 15
    elif rsi < 40:
        score += 15
    elif rsi > 50:
        score += 5
    else:
        score -= 5

    if stock['wk52High'] and stock['wk52Low'] and stock['wk52High'] != stock['wk52Low']:
        range_pct = (p - stock['wk52Low']) / (stock['wk52High'] - stock['wk52Low']) * 100
        if range_pct < 20:
            score += 15
        elif range_pct > 80:
            score -= 15

    if stock['tenDayHigh'] and stock['tenDayLow'] and stock['tenDayHigh'] != stock['tenDayLow']:
        ten_day_pct = (p - stock['tenDayLow']) / (stock['tenDayHigh'] - stock['tenDayLow']) * 100
        if ten_day_pct < 25:
            score += 8
        elif ten_day_pct > 75:
            score -= 8

    if stock['dayHigh'] and stock['dayLow'] and stock['dayHigh'] != stock['dayLow']:
        day_pct = (p - stock['dayLow']) / (stock['dayHigh'] - stock['dayLow']) * 100
        change_str = str(stock['change'])
        if day_pct < 30 and change_str.startswith('-'):
            score -= 10
        if day_pct > 70 and not change_str.startswith('-'):
            score += 10

    if score >= 60:
        return 'STRONG BUY', 'green_bold'
    elif score >= 30:
        return 'BUY', 'green'
    elif score <= -60:
        return 'STRONG SELL', 'red_bold'
    elif score <= -30:
        return 'SELL', 'red'
    elif score >= 10:
        return 'MILD BUY', 'green'
    elif score <= -10:
        return 'MILD SELL', 'red'
    else:
        return 'HOLD', 'yellow'


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
