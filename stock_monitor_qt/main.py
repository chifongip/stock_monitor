import subprocess
import sys
from datetime import datetime

from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLineEdit, QLabel, QStatusBar, QInputDialog,
)
from PyQt5.QtCore import Qt, QTimer, QThreadPool, QRunnable, pyqtSignal, QObject
from PyQt5.QtGui import QPalette, QColor, QIcon, QFont

from .config import (
    load_config, get_config, save_config,
    add_stock, remove_stock, set_target, unset_alert,
    update_last_price, set_alert_fired, reorder_stocks,
)
from .api import fetch_stock, get_technical_signal, check_alert
from .widgets import StockTable, COLORS


class FetchSignals(QObject):
    finished = pyqtSignal(int, object)  # (row, stock_data_or_None)


class FetchWorker(QRunnable):
    def __init__(self, row, code):
        super().__init__()
        self.row = row
        self.code = code
        self.signals = FetchSignals()

    def run(self):
        data = fetch_stock(self.code)
        self.signals.finished.emit(self.row, data)


class StockMonitorWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle('HK Real-Time Terminal — Composite Technical Signals')
        self.setMinimumSize(960, 500)

        self.cfg = load_config()

        self._setup_dark_palette()
        self._setup_ui()
        self._setup_timer()
        self._populate_table()

    def _setup_dark_palette(self):
        palette = QPalette()
        palette.setColor(QPalette.Window, QColor('#111111'))
        palette.setColor(QPalette.WindowText, QColor('#E8E8E8'))
        palette.setColor(QPalette.Base, QColor('#111111'))
        palette.setColor(QPalette.AlternateBase, QColor('#1A1A1A'))
        palette.setColor(QPalette.ToolTipBase, QColor('#1A1A1A'))
        palette.setColor(QPalette.ToolTipText, QColor('#E8E8E8'))
        palette.setColor(QPalette.Text, QColor('#E8E8E8'))
        palette.setColor(QPalette.Button, QColor('#1A1A1A'))
        palette.setColor(QPalette.ButtonText, QColor('#E8E8E8'))
        palette.setColor(QPalette.Highlight, QColor('#2A2A2A'))
        palette.setColor(QPalette.HighlightedText, QColor('#FFFFFF'))
        palette.setColor(QPalette.Link, QColor('#E8E8E8'))
        self.setPalette(palette)

    def _setup_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(6)

        title = QLabel('HK REAL-TIME TERMINAL — COMPOSITE TECHNICAL SIGNALS')
        title.setFont(QFont('Ubuntu Mono, Monospace', 13, QFont.Bold))
        title.setStyleSheet('color: #E8E8E8; padding: 4px 0;')
        title.setAlignment(Qt.AlignLeft)
        layout.addWidget(title)

        self.table = StockTable(self)
        self.table.set_show_names(self.cfg.get('showNames', True))
        self.table.set_compact_mode(self.cfg.get('compactMode', False))
        self.table.set_color_mode(self.cfg.get('colorMode', False))
        layout.addWidget(self.table)

        self.table.remove_requested.connect(self._on_remove)
        self.table.set_target_requested.connect(self._on_set_target)
        self.table.unset_alert_requested.connect(self._on_unset_alert)
        self.table.stock_reordered.connect(self._on_reorder)

        cmd_layout = QHBoxLayout()
        cmd_label = QLabel('>')
        cmd_label.setFont(QFont('Ubuntu Mono, Monospace', 11))
        cmd_label.setStyleSheet('color: #666;')
        self.cmd_input = QLineEdit()
        self.cmd_input.setFont(QFont('Ubuntu Mono, Monospace', 11))
        self.cmd_input.setPlaceholderText('a [code] | r [code] | t [code] [price] | ua [code] | name | compact | color')
        self.cmd_input.setStyleSheet("""
            QLineEdit {
                background-color: #1A1A1A;
                color: #E8E8E8;
                border: 1px solid #2A2A2A;
                padding: 4px;
                font-family: 'Ubuntu Mono', 'Monospace';
                font-size: 11pt;
            }
        """)
        self.cmd_input.returnPressed.connect(self._handle_command)
        cmd_layout.addWidget(cmd_label)
        cmd_layout.addWidget(self.cmd_input)
        layout.addLayout(cmd_layout)

        self.status_bar = QStatusBar()
        self.setStatusBar(self.status_bar)
        self.status_bar.setStyleSheet("""
            QStatusBar {
                background-color: #1A1A1A;
                color: #666;
                font-family: 'Ubuntu Mono', 'Monospace';
                font-size: 10pt;
            }
        """)


    def _setup_timer(self):
        self.timer = QTimer(self)
        self.timer.timeout.connect(self._refresh)
        self.timer.start(5000)

    def _populate_table(self):
        self.table.setRowCount(len(self.cfg['stocks']))

    def _refresh(self):
        self.cfg = get_config()
        codes = self.cfg['stocks']

        if self.table.rowCount() != len(codes):
            self.table.setRowCount(len(codes))

        pool = QThreadPool.globalInstance()
        for row, code in enumerate(codes):
            worker = FetchWorker(row, code)
            worker.signals.finished.connect(self._on_stock_fetched)
            pool.start(worker)

    def _on_stock_fetched(self, row, stock):
        if stock is None:
            return
        if row >= self.table.rowCount():
            return

        code = stock['code']
        self.cfg = get_config()

        alert_text, alert_color, alert_fired = check_alert(stock, self.cfg)
        if alert_fired:
            set_alert_fired(code)
            self._notify(f'Price Cross: {stock["name"]}', f'{stock["code"]} {alert_text.strip()}')

        update_last_price(code, stock['price'])

        signal_text, signal_color = get_technical_signal(stock)

        self.table.update_stock_row(row, stock, alert_text, alert_color, signal_text, signal_color, alert_fired)

        self.status_bar.showMessage(f'Last Sync: {datetime.now().strftime("%H:%M:%S")}')

    def _handle_command(self):
        text = self.cmd_input.text().strip()
        if not text:
            return
        self.cmd_input.clear()

        parts = text.split()
        cmd = parts[0].lower()

        if cmd == 'a' and len(parts) >= 2:
            code = parts[1].zfill(5)
            add_stock(code)
            self.cfg = get_config()
            self._populate_table()
            self._refresh()

        elif cmd == 'r' and len(parts) >= 2:
            code = parts[1].zfill(5)
            remove_stock(code)
            self.cfg = get_config()
            self._populate_table()

        elif cmd == 't' and len(parts) >= 3:
            code = parts[1].zfill(5)
            try:
                price = float(parts[2])
                set_target(code, price)
            except ValueError:
                self.status_bar.showMessage(f'Invalid price: {parts[2]}')

        elif cmd == 'ua' and len(parts) >= 2:
            code = parts[1].zfill(5)
            unset_alert(code)

        elif cmd == 'name':
            self._toggle_names()

        elif cmd == 'compact':
            self._toggle_compact()

        elif cmd == 'color':
            self._toggle_color()

        self.cfg = get_config()

    def _on_remove(self, code):
        remove_stock(code)
        self.cfg = get_config()
        self._populate_table()

    def _on_set_target(self, code):
        price, ok = QInputDialog.getDouble(
            self, f'Set Target for {code}',
            'Target Price:', decimals=3
        )
        if ok:
            set_target(code, price)

    def _on_unset_alert(self, code):
        unset_alert(code)

    def _on_reorder(self, new_order):
        reorder_stocks(new_order)

    def _toggle_names(self):
        self.cfg['showNames'] = not self.cfg.get('showNames', True)
        self.table.set_show_names(self.cfg['showNames'])
        save_config()

    def _toggle_compact(self):
        self.cfg['compactMode'] = not self.cfg.get('compactMode', False)
        self.table.set_compact_mode(self.cfg['compactMode'])
        save_config()

    def _toggle_color(self):
        self.cfg['colorMode'] = not self.cfg.get('colorMode', False)
        self.table.set_color_mode(self.cfg['colorMode'])
        save_config()

    def _notify(self, title, message):
        try:
            subprocess.Popen(['notify-send', '-u', 'normal', title, message])
        except FileNotFoundError:
            pass


def main():
    app = QApplication(sys.argv)
    app.setApplicationName('Stock Monitor')
    app.setStyle('Fusion')

    window = StockMonitorWindow()
    window.show()
    window._refresh()

    sys.exit(app.exec_())


if __name__ == '__main__':
    main()
