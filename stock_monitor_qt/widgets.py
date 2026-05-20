from PyQt5.QtWidgets import (
    QTableWidget, QTableWidgetItem, QHeaderView, QMenu, QAction,
    QInputDialog, QMessageBox, QAbstractItemView,
)
from PyQt5.QtCore import Qt, pyqtSignal
from PyQt5.QtGui import QColor, QFont, QBrush


COLORS = {
    'green': QColor('#00CC00'),
    'green_bold': QColor('#00FF00'),
    'red': QColor('#EF5350'),
    'red_bold': QColor('#E53935'),
    'yellow': QColor('#FFB900'),
    'cyan': QColor('#26C6DA'),
    'gray': QColor('#666666'),
    'white': QColor('#E8E8E8'),
    'alert_bg': QColor('#7B1FA2'),
    'alert_fg': QColor('#FFFFFF'),
    'header': QColor('#E8E8E8'),
    'bg': QColor('#111111'),
    'row_alt': QColor('#1A1A1A'),
    'grid': QColor('#222222'),
}

MONO_FONT = QFont('Ubuntu Mono, Monospace, Courier New', 11)
MONO_FONT.setFixedPitch(True)

BOLD_FONT = QFont(MONO_FONT)
BOLD_FONT.setBold(True)

COLUMNS = ['Code', 'Name', 'Price', 'Chg', '%', 'Alert Target', 'Signal', 'Time']


class StockTable(QTableWidget):
    stock_reordered = pyqtSignal(list)
    remove_requested = pyqtSignal(str)
    set_target_requested = pyqtSignal(str)
    unset_alert_requested = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(0, len(COLUMNS), parent)
        self.setHorizontalHeaderLabels(COLUMNS)
        self._show_names = True
        self._color_mode = False
        self._setup_appearance()
        self.setContextMenuPolicy(Qt.CustomContextMenu)
        self.customContextMenuRequested.connect(self._show_context_menu)
        self.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.setSelectionMode(QAbstractItemView.SingleSelection)
        self.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeToContents)
        self.horizontalHeader().setStretchLastSection(True)
        self.verticalHeader().setVisible(False)
        self.setDragDropMode(QAbstractItemView.InternalMove)
        self.setDefaultDropAction(Qt.MoveAction)
        self.model().rowsMoved.connect(self._on_rows_moved)

    def _setup_appearance(self):
        self.setStyleSheet(f"""
            QTableWidget {{
                background-color: {COLORS['bg'].name()};
                color: {COLORS['white'].name()};
                gridline-color: {COLORS['grid'].name()};
                font-family: 'Ubuntu Mono', 'Monospace', 'Courier New';
                font-size: 11pt;
                border: none;
                selection-background-color: #2A2A2A;
            }}
            QHeaderView::section {{
                background-color: {COLORS['row_alt'].name()};
                color: {COLORS['header'].name()};
                font-weight: bold;
                padding: 4px;
                border: none;
                border-bottom: 1px solid {COLORS['grid'].name()};
            }}
        """)

    def set_show_names(self, show):
        self._show_names = show
        self.setColumnHidden(1, not show)

    def set_compact_mode(self, compact):
        if compact:
            self.setShowGrid(False)
            self.verticalHeader().setDefaultSectionSize(20)
            self.setStyleSheet(self.styleSheet().replace(
                'gridline-color: ' + COLORS['grid'].name() + ';',
                'gridline-color: transparent;'
            ))
        else:
            self.setShowGrid(True)
            self.verticalHeader().setDefaultSectionSize(30)
            self.setStyleSheet(self.styleSheet().replace(
                'gridline-color: transparent;',
                'gridline-color: ' + COLORS['grid'].name() + ';'
            ))

    def set_color_mode(self, enabled):
        self._color_mode = enabled
        header_color = '#FFB900' if enabled else '#E8E8E8'
        self.setStyleSheet(self.styleSheet().replace(
            'color: ' + COLORS['header'].name() + ';',
            f'color: {header_color};'
        ))
        COLORS['header'] = QColor(header_color)

    def update_stock_row(self, row, stock, alert_text, alert_color, signal_text, signal_color, alert_fired):
        change_str = str(stock['change'])
        is_up = not change_str.startswith('-')

        if self._color_mode:
            price_color = COLORS['green'] if is_up else COLORS['red']
            alert_fg = COLORS.get(alert_color, COLORS['gray'])
            signal_fg = COLORS.get(signal_color, COLORS['gray'])
        else:
            price_color = COLORS['white']
            alert_fg = COLORS['gray']
            signal_fg = COLORS['white']

        code_item = QTableWidgetItem(stock['code'])
        code_item.setFont(MONO_FONT)
        code_item.setForeground(COLORS['white'])
        code_item.setFlags(code_item.flags() & ~Qt.ItemIsEditable)
        self.setItem(row, 0, code_item)

        name_item = QTableWidgetItem(stock['name'])
        name_item.setFont(MONO_FONT)
        name_item.setForeground(COLORS['gray'])
        name_item.setFlags(name_item.flags() & ~Qt.ItemIsEditable)
        self.setItem(row, 1, name_item)

        price_item = QTableWidgetItem(f"{stock['price']:.3f}")
        price_item.setFont(BOLD_FONT)
        price_item.setForeground(price_color)
        price_item.setFlags(price_item.flags() & ~Qt.ItemIsEditable)
        self.setItem(row, 2, price_item)

        chg_item = QTableWidgetItem(str(stock['change']))
        chg_item.setFont(MONO_FONT)
        chg_item.setForeground(price_color)
        chg_item.setFlags(chg_item.flags() & ~Qt.ItemIsEditable)
        self.setItem(row, 3, chg_item)

        pct_item = QTableWidgetItem(stock['percent'])
        pct_item.setFont(MONO_FONT)
        pct_item.setForeground(price_color)
        pct_item.setFlags(pct_item.flags() & ~Qt.ItemIsEditable)
        self.setItem(row, 4, pct_item)

        alert_item = QTableWidgetItem(alert_text)
        alert_item.setFont(MONO_FONT)
        if alert_fired:
            alert_item.setFont(BOLD_FONT)
            if self._color_mode:
                alert_item.setBackground(COLORS['alert_bg'])
                alert_item.setForeground(COLORS['alert_fg'])
            else:
                alert_item.setForeground(COLORS['white'])
        else:
            alert_item.setForeground(alert_fg)
        alert_item.setFlags(alert_item.flags() & ~Qt.ItemIsEditable)
        self.setItem(row, 5, alert_item)

        signal_item = QTableWidgetItem(signal_text)
        signal_font = BOLD_FONT if 'bold' in signal_color else MONO_FONT
        signal_item.setFont(signal_font)
        signal_item.setForeground(signal_fg)
        signal_item.setFlags(signal_item.flags() & ~Qt.ItemIsEditable)
        self.setItem(row, 6, signal_item)

        time_item = QTableWidgetItem(stock['time'])
        time_item.setFont(MONO_FONT)
        time_item.setForeground(COLORS['gray'])
        time_item.setFlags(time_item.flags() & ~Qt.ItemIsEditable)
        self.setItem(row, 7, time_item)

        bg = COLORS['row_alt'] if row % 2 else COLORS['bg']
        for col in range(len(COLUMNS)):
            item = self.item(row, col)
            if item and not alert_fired:
                item.setBackground(bg)

    def _show_context_menu(self, pos):
        row = self.rowAt(pos.y())
        if row < 0:
            return
        code_item = self.item(row, 0)
        if not code_item:
            return
        code = code_item.text()

        menu = QMenu(self)
        set_target_action = QAction(f'Set Target for {code}', self)
        set_target_action.triggered.connect(lambda: self.set_target_requested.emit(code))
        menu.addAction(set_target_action)

        unset_action = QAction(f'Unset Alert for {code}', self)
        unset_action.triggered.connect(lambda: self.unset_alert_requested.emit(code))
        menu.addAction(unset_action)

        menu.addSeparator()

        remove_action = QAction(f'Remove {code}', self)
        remove_action.triggered.connect(lambda: self.remove_requested.emit(code))
        menu.addAction(remove_action)

        menu.exec_(self.viewport().mapToGlobal(pos))

    def _on_rows_moved(self, parent, start, end, dest, row):
        new_order = []
        for i in range(self.rowCount()):
            item = self.item(i, 0)
            if item:
                new_order.append(item.text())
        self.stock_reordered.emit(new_order)
