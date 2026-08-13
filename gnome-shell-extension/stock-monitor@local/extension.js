/* exported init, enable, disable */

const {Clutter, Gio, GLib, Soup, St} = imports.gi;
const ByteArray = imports.byteArray;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const REFRESH_MINIMUM_SECONDS = 15;
const ROTATION_SECONDS = 10;
const QUOTE_URL = 'https://realtime-money18-cdn.on.cc/securityQuote/genStockDetailHKJSON.php?stockcode=';
const REFERER = 'https://money18.on.cc/';
const USER_AGENT = 'Mozilla/5.0 (GNOME Shell Stock Monitor)';

let extension = null;

function normaliseSymbol(value) {
    const code = String(value).trim();
    if (!/^\d{1,5}$/.test(code))
        return null;

    return code.padStart(5, '0');
}

function formatPercent(value) {
    const percent = String(value ?? '').trim().replace(/%$/, '');
    return percent ? `${percent}%` : '—';
}

function quoteStyle(change) {
    if (change > 0)
        return 'stock-monitor-positive';
    if (change < 0)
        return 'stock-monitor-negative';
    return 'stock-monitor-neutral';
}

function timeToMinutes(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value));
    if (!match)
        return null;

    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    if (hours > 23 || minutes > 59)
        return null;

    return hours * 60 + minutes;
}

class StockMonitorExtension {
    constructor() {
        this._settings = ExtensionUtils.getSettings();
        this._session = new Soup.Session({timeout: 15});
        this._cancellable = new Gio.Cancellable();
        this._quotes = new Map();
        this._symbols = [];
        this._indicator = null;
        this._panelLabel = null;
        this._refreshTimerId = 0;
        this._rotationTimerId = 0;
        this._scheduleTimerId = 0;
        this._rotationIndex = 0;
        this._refreshInFlight = false;
        this._refreshQueued = false;
        this._refreshGeneration = 0;
        this._loading = false;
        this._lastError = null;
        this._settingsSignals = [];
        this._enabled = false;
        this._scheduleActive = null;
    }

    enable() {
        this._enabled = true;
        this._reloadSymbols();

        this._indicator = new PanelMenu.Button(0.0, 'Stock Monitor', false);
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._panelLabel = new St.Label({
            text: 'Stocks: Loading…',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'stock-monitor-panel-label stock-monitor-status',
        });
        box.add_child(this._panelLabel);
        this._indicator.add_child(box);
        Main.panel.addToStatusArea('stock-monitor', this._indicator, 0, 'right');

        this._settingsSignals.push(
            this._settings.connect('changed::symbols', () => {
                this._rotationIndex = 0;
                this._refreshGeneration++;
                this._reloadSymbols();
                this._refreshQuotes();
            }),
            this._settings.connect('changed::refresh-interval', () => {
                this._refreshGeneration++;
                this._applySchedule();
                this._refreshQuotes();
            }),
            this._settings.connect('changed::schedule-enabled', () => this._applySchedule()),
            this._settings.connect('changed::schedule-start', () => this._applySchedule()),
            this._settings.connect('changed::schedule-end', () => this._applySchedule())
        );

        this._applySchedule();
    }

    disable() {
        this._enabled = false;
        this._refreshGeneration++;
        this._cancellable.cancel();
        this._removeTimer('_refreshTimerId');
        this._removeTimer('_rotationTimerId');
        this._removeTimer('_scheduleTimerId');

        for (const signalId of this._settingsSignals)
            this._settings.disconnect(signalId);
        this._settingsSignals = [];

        this._indicator?.destroy();
        this._indicator = null;
        this._panelLabel = null;
        this._quotes.clear();
        this._refreshQueued = false;
    }

    _reloadSymbols() {
        const seen = new Set();
        this._symbols = this._settings.get_strv('symbols')
            .map(normaliseSymbol)
            .filter(code => {
                if (!code || seen.has(code))
                    return false;
                seen.add(code);
                return true;
            });

        const retainedQuotes = new Map();
        for (const code of this._symbols) {
            if (this._quotes.has(code))
                retainedQuotes.set(code, this._quotes.get(code));
        }
        this._quotes = retainedQuotes;
        this._updateUi();
    }

    _refreshInterval() {
        return Math.max(REFRESH_MINIMUM_SECONDS, this._settings.get_uint('refresh-interval'));
    }

    _scheduleTimes() {
        if (!this._settings.get_boolean('schedule-enabled'))
            return null;

        const start = timeToMinutes(this._settings.get_string('schedule-start'));
        const end = timeToMinutes(this._settings.get_string('schedule-end'));
        if (start === null || end === null)
            return null;

        return {start, end};
    }

    _isWithinScheduledHours() {
        const schedule = this._scheduleTimes();
        if (!schedule || schedule.start === schedule.end)
            return true;

        const now = new Date();
        const current = now.getHours() * 60 + now.getMinutes();
        if (schedule.start < schedule.end)
            return current >= schedule.start && current < schedule.end;

        return current >= schedule.start || current < schedule.end;
    }

    _secondsUntilScheduleChange() {
        const schedule = this._scheduleTimes();
        if (!schedule || schedule.start === schedule.end)
            return 0;

        const now = new Date();
        const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
        const boundaries = [schedule.start * 60, schedule.end * 60];
        const seconds = boundaries.map(boundary => {
            let remaining = boundary - currentSeconds;
            if (remaining <= 0)
                remaining += 24 * 60 * 60;
            return remaining;
        });
        return Math.max(1, Math.min(...seconds));
    }

    _applySchedule() {
        const active = this._isWithinScheduledHours();
        const changed = active !== this._scheduleActive;
        this._scheduleActive = active;
        this._startScheduleTimer();

        if (!active) {
            this._removeTimer('_refreshTimerId');
            this._removeTimer('_rotationTimerId');
            this._cancelRefresh();
            this._indicator?.hide();
            return;
        }

        this._indicator?.show();
        this._startRefreshTimer();
        this._startRotationTimer();
        this._updateUi();
        if (changed || this._quotes.size === 0)
            this._refreshQuotes();
    }

    _startScheduleTimer() {
        this._removeTimer('_scheduleTimerId');
        const seconds = this._secondsUntilScheduleChange();
        if (!seconds)
            return;

        this._scheduleTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            seconds,
            () => {
                this._scheduleTimerId = 0;
                this._applySchedule();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _cancelRefresh() {
        this._refreshGeneration++;
        this._refreshQueued = false;
        this._loading = false;
        this._cancellable.cancel();
        this._cancellable = new Gio.Cancellable();
    }

    _startRefreshTimer() {
        this._removeTimer('_refreshTimerId');
        this._refreshTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            this._refreshInterval(),
            () => {
                this._refreshQuotes();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _startRotationTimer() {
        this._removeTimer('_rotationTimerId');
        this._rotationTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            ROTATION_SECONDS,
            () => {
                this._rotationIndex++;
                this._updatePanel();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _removeTimer(property) {
        if (this[property]) {
            GLib.source_remove(this[property]);
            this[property] = 0;
        }
    }

    async _refreshQuotes() {
        if (!this._enabled || !this._scheduleActive)
            return;

        if (this._refreshInFlight) {
            this._refreshQueued = true;
            return;
        }

        const symbols = [...this._symbols];

        if (symbols.length === 0) {
            this._loading = false;
            this._lastError = 'Add a Hong Kong stock code in Preferences.';
            this._updateUi();
            return;
        }

        const generation = this._refreshGeneration;
        this._refreshInFlight = true;
        this._loading = true;
        this._lastError = null;
        this._updateUi();

        try {
            const results = await Promise.allSettled(symbols.map(code => this._fetchQuote(code)));
            if (!this._enabled || generation !== this._refreshGeneration)
                return;

            const failedCodes = [];
            results.forEach((result, index) => {
                if (result.status === 'fulfilled')
                    this._quotes.set(result.value.code, result.value);
                else
                    failedCodes.push(symbols[index]);
            });

            this._loading = false;
            this._lastError = failedCodes.length > 0
                ? `Could not refresh ${failedCodes.join(', ')}. Showing the latest available prices.`
                : null;
            this._updateUi();
        } finally {
            this._refreshInFlight = false;
            if (this._enabled && this._scheduleActive && this._refreshQueued) {
                this._refreshQueued = false;
                this._refreshQuotes();
            }
        }
    }

    async _fetchQuote(code) {
        const message = Soup.Message.new('GET', `${QUOTE_URL}${encodeURIComponent(code)}`);
        message.request_headers.append('Referer', REFERER);
        message.request_headers.append('User-Agent', USER_AGENT);

        const bytes = await this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            this._cancellable
        );
        if (message.status_code < 200 || message.status_code >= 300)
            throw new Error(`HTTP ${message.status_code}`);

        const raw = ByteArray.toString(bytes.get_data());
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start === -1 || end === -1 || end < start)
            throw new Error('The quote service returned an invalid response.');

        const data = JSON.parse(raw.slice(start, end + 1));
        const price = Number.parseFloat(data.real?.np);
        if (!Number.isFinite(price))
            throw new Error('The quote did not include a numeric price.');

        const change = Number.parseFloat(data.calculation?.change);
        return {
            code,
            name: data.daily?.nameChi || data.daily?.name || code,
            price,
            change: Number.isFinite(change) ? change : 0,
            percent: formatPercent(data.calculation?.pctChange),
            sourceTime: data.real?.ltt || 'Time unavailable',
            fetchedAt: new Date(),
        };
    }

    _updateUi() {
        this._updatePanel();
        this._rebuildMenu();
    }

    _updatePanel() {
        if (!this._panelLabel)
            return;

        const quotes = this._symbols
            .map(code => this._quotes.get(code))
            .filter(Boolean);
        this._panelLabel.remove_style_class_name('stock-monitor-positive');
        this._panelLabel.remove_style_class_name('stock-monitor-negative');
        this._panelLabel.remove_style_class_name('stock-monitor-neutral');
        this._panelLabel.remove_style_class_name('stock-monitor-status');

        if (quotes.length === 0) {
            this._panelLabel.set_text(this._loading ? 'Stocks: Loading…' : 'Stocks: unavailable');
            this._panelLabel.add_style_class_name('stock-monitor-status');
            return;
        }

        this._rotationIndex %= quotes.length;
        const quote = quotes[this._rotationIndex];
        this._panelLabel.set_text(`${quote.code} ${quote.price.toFixed(3)} ${quote.percent}`);
        this._panelLabel.add_style_class_name(quoteStyle(quote.change));
    }

    _rebuildMenu() {
        if (!this._indicator)
            return;

        this._indicator.menu.removeAll();
        if (this._lastError)
            this._addStatusItem(this._lastError, 'stock-monitor-error');
        else if (this._loading)
            this._addStatusItem('Refreshing prices…', 'stock-monitor-status');

        for (const code of this._symbols) {
            const quote = this._quotes.get(code);
            if (quote)
                this._addQuoteItem(quote);
        }

        if (this._quotes.size === 0 && !this._loading && !this._lastError)
            this._addStatusItem('No prices are available yet.', 'stock-monitor-status');

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refreshItem = new PopupMenu.PopupMenuItem('Refresh now');
        refreshItem.connect('activate', () => this._refreshQuotes());
        this._indicator.menu.addMenuItem(refreshItem);

        const exitItem = new PopupMenu.PopupMenuItem('Exit');
        exitItem.connect('activate', () => {
            Main.extensionManager.disableExtension(Me.uuid);
        });
        this._indicator.menu.addMenuItem(exitItem);
    }

    _addStatusItem(text, styleClass) {
        const item = new PopupMenu.PopupMenuItem(text, {reactive: false, can_focus: false});
        item.add_style_class_name(styleClass);
        this._indicator.menu.addMenuItem(item);
    }

    _addQuoteItem(quote) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const row = new St.BoxLayout({style_class: 'stock-monitor-row', x_expand: true});
        const details = new St.Label({
            text: `${quote.code}  ${quote.name}\n${quote.sourceTime}`,
            x_expand: true,
            style_class: 'stock-monitor-row-details',
        });
        const price = new St.Label({
            text: `${quote.price.toFixed(3)}  ${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(3)}  ${quote.percent}`,
            style_class: quoteStyle(quote.change),
        });
        row.add_child(details);
        row.add_child(price);
        item.add_child(row);
        this._indicator.menu.addMenuItem(item);
    }
}

function init() {
}

function enable() {
    extension = new StockMonitorExtension();
    extension.enable();
}

function disable() {
    extension?.disable();
    extension = null;
}
