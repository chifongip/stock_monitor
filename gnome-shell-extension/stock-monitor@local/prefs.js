/* exported init, fillPreferencesWindow */

const {Adw, Gio, Gtk} = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;

const REFRESH_MINIMUM_SECONDS = 15;
const REFRESH_MAXIMUM_SECONDS = 3600;
const WEEKDAYS = [
    {id: 'mon', label: 'Monday'},
    {id: 'tue', label: 'Tuesday'},
    {id: 'wed', label: 'Wednesday'},
    {id: 'thu', label: 'Thursday'},
    {id: 'fri', label: 'Friday'},
    {id: 'sat', label: 'Saturday'},
    {id: 'sun', label: 'Sunday'},
];

function normaliseTime(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match)
        return null;

    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    if (hours > 23 || minutes > 59)
        return null;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normaliseSymbols(text) {
    const seen = new Set();
    return text.split(/[\n,\s]+/)
        .map(value => value.trim())
        .filter(value => /^\d{1,5}$/.test(value))
        .map(value => value.padStart(5, '0'))
        .filter(code => {
            if (seen.has(code))
                return false;
            seen.add(code);
            return true;
        });
}

function normaliseDays(days) {
    const selected = new Set(days);
    return WEEKDAYS.filter(day => selected.has(day.id)).map(day => day.id);
}

function init() {
}

function fillPreferencesWindow(window) {
    const settings = ExtensionUtils.getSettings();
    const page = new Adw.PreferencesPage();
    const watchlistGroup = new Adw.PreferencesGroup({
        title: 'Watchlist',
        description: 'Prices use the Hong Kong market codes supplied by Money18.',
    });
    const symbolsRow = new Adw.ActionRow({
        title: 'Stock codes',
        subtitle: settings.get_strv('symbols').join(', ') || 'No symbols configured',
        activatable: true,
    });
    const editButton = new Gtk.Button({label: 'Edit', valign: Gtk.Align.CENTER});
    symbolsRow.add_suffix(editButton);
    symbolsRow.set_activatable_widget(editButton);

    const refreshRow = new Adw.ActionRow({
        title: 'Refresh interval',
        subtitle: 'Seconds between automatic quote requests',
    });
    const interval = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
            lower: REFRESH_MINIMUM_SECONDS,
            upper: REFRESH_MAXIMUM_SECONDS,
            step_increment: 15,
            page_increment: 60,
            value: settings.get_uint('refresh-interval'),
        }),
        valign: Gtk.Align.CENTER,
    });
    interval.connect('value-changed', widget => {
        settings.set_uint('refresh-interval', widget.get_value_as_int());
    });
    refreshRow.add_suffix(interval);
    refreshRow.set_activatable_widget(interval);

    watchlistGroup.add(symbolsRow);
    watchlistGroup.add(refreshRow);
    page.add(watchlistGroup);

    const scheduleGroup = new Adw.PreferencesGroup({
        title: 'Scheduled active hours',
        description: 'Hide the indicator and pause price updates outside this daily local-time range.',
    });
    const scheduleRow = new Adw.ActionRow({
        title: 'Enable scheduled hours',
        subtitle: 'The extension resumes automatically at the start time.',
    });
    const scheduleSwitch = new Gtk.Switch({
        active: settings.get_boolean('schedule-enabled'),
        valign: Gtk.Align.CENTER,
    });
    settings.bind('schedule-enabled', scheduleSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    scheduleRow.add_suffix(scheduleSwitch);
    scheduleRow.set_activatable_widget(scheduleSwitch);

    const addTimeRow = (title, key) => {
        const row = new Adw.ActionRow({
            title,
            subtitle: '24-hour local time (HH:MM)',
        });
        const entry = new Gtk.Entry({
            text: settings.get_string(key),
            width_chars: 5,
            max_length: 5,
            valign: Gtk.Align.CENTER,
            placeholder_text: 'HH:MM',
        });
        const saveTime = () => {
            const time = normaliseTime(entry.get_text());
            if (!time) {
                entry.add_css_class('error');
                return;
            }

            entry.remove_css_class('error');
            if (entry.get_text() !== time)
                entry.set_text(time);
            if (settings.get_string(key) !== time)
                settings.set_string(key, time);
        };
        entry.connect('changed', saveTime);
        entry.connect('activate', saveTime);
        settings.bind('schedule-enabled', row, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(entry);
        row.set_activatable_widget(entry);
        scheduleGroup.add(row);
    };

    scheduleGroup.add(scheduleRow);

    for (const day of WEEKDAYS) {
        const dayRow = new Adw.ActionRow({title: day.label});
        const daySwitch = new Gtk.Switch({
            active: settings.get_strv('active-days').includes(day.id),
            valign: Gtk.Align.CENTER,
        });
        daySwitch.connect('notify::active', widget => {
            const selected = new Set(settings.get_strv('active-days'));
            if (widget.active)
                selected.add(day.id);
            else
                selected.delete(day.id);
            settings.set_strv('active-days', normaliseDays(selected));
        });
        settings.bind('schedule-enabled', dayRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        dayRow.add_suffix(daySwitch);
        dayRow.set_activatable_widget(daySwitch);
        scheduleGroup.add(dayRow);
    }

    addTimeRow('Start time', 'schedule-start');
    addTimeRow('End time', 'schedule-end');
    page.add(scheduleGroup);
    window.add(page);

    const openEditor = () => {
        const dialog = new Gtk.Dialog({
            title: 'Edit stock codes',
            transient_for: window,
            modal: true,
            default_width: 420,
            default_height: 280,
        });
        dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
        dialog.add_button('Save', Gtk.ResponseType.ACCEPT);

        const content = dialog.get_content_area();
        content.spacing = 12;
        content.margin_top = 12;
        content.margin_bottom = 12;
        content.margin_start = 12;
        content.margin_end = 12;
        const help = new Gtk.Label({
            label: 'Enter one Hong Kong stock code per line. Codes are saved as five digits.',
            wrap: true,
            xalign: 0,
        });
        const buffer = new Gtk.TextBuffer({text: settings.get_strv('symbols').join('\n')});
        const editor = new Gtk.TextView({buffer, monospace: true, vexpand: true});
        const scroller = new Gtk.ScrolledWindow({
            child: editor,
            vexpand: true,
            min_content_height: 160,
        });
        content.append(help);
        content.append(scroller);

        dialog.connect('response', (_dialog, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                const text = buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), false);
                const symbols = normaliseSymbols(text);
                settings.set_strv('symbols', symbols);
                symbolsRow.set_subtitle(symbols.join(', ') || 'No symbols configured');
            }
            dialog.destroy();
        });
        dialog.present();
    };

    editButton.connect('clicked', openEditor);
    symbolsRow.connect('activated', openEditor);
}
