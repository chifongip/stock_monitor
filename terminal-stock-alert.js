const axios = require('axios');
const Table = require('cli-table3');
const chalk = require('chalk');
const fs = require('fs');
const readline = require('readline');
const notifier = require('node-notifier');

const CONFIG_FILE = './stocks.json';

// 1. Load configuration (Stocks, Preferences, Targets)
let config = {
    stocks: ['00700', '00005', '02800'],  // Default includes your Tracker Fund
    targets: {},
    lastAlerted: {},
    targetSetTime: {},                    // ← NEW: timestamp when target was last set/updated
    lastPrice: {},                        // ← NEW (required by checkAlert)
    showNames: true,
    compactMode: false,
    sortingMode: false,                   // ← NEW for sorting feature
    selectedIndex: 0,                     // ← NEW
    movingIndex: null                     // ← NEW (when dragging a stock)
};

if (fs.existsSync(CONFIG_FILE)) {
    try {
        const fileData = JSON.parse(fs.readFileSync(CONFIG_FILE));
        if (Array.isArray(fileData)) config.stocks = fileData;
        else config = { ...config, ...fileData };
    } catch (e) { saveConfig(); }
}

// ==================== NEW: INPUT HANDLING FOR SORTING MODE ====================
const rl = readline.createInterface({ 
    input: process.stdin, 
    output: process.stdout, 
    terminal: true 
});

let currentRl = rl; // we will replace it when entering sorting mode

function enterSortingMode() {
    currentRl.close();
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', handleSortingKey);
}

function exitSortingMode() {
    process.stdin.removeListener('data', handleSortingKey);
    process.stdin.setRawMode(false);
    currentRl = readline.createInterface({ 
        input: process.stdin, 
        output: process.stdout, 
        terminal: true 
    });
    currentRl.on('line', handleLineInput);
    currentRl.prompt(true);
}

function handleLineInput(line) {
    const input = line.trim().split(/\s+/);
    const cmd = input[0].toLowerCase();
    const code = input[1] ? input[1].padStart(5, '0') : null;
    const val = input[2];

    // === NEW COMMAND: s or sort to toggle sorting mode ===
    if (cmd === 's' || cmd === 'sort') {
        config.sortingMode = !config.sortingMode;
        config.selectedIndex = 0;
        config.movingIndex = null;
        saveConfig();
        if (config.sortingMode) {
            enterSortingMode();
        } else {
            exitSortingMode();
        }
        displayTable();
        return;
    }

    // === ALL YOUR ORIGINAL COMMANDS (unchanged) ===
    if (cmd === 'a' && code) {
        if (!config.stocks.includes(code)) config.stocks.push(code);
    } else if (cmd === 'r' && code) {
        config.stocks = config.stocks.filter(s => s !== code);
        delete config.targets[code];
        delete config.lastAlerted[code];
        delete config.targetSetTime[code];
    } else if (cmd === 't' && code && val) {
        config.targets[code] = parseFloat(val);
        delete config.lastAlerted[code];
        config.targetSetTime[code] = Date.now();
    } else if (cmd === 'ua' && code) {
        delete config.targets[code];
        delete config.lastAlerted[code];
        delete config.targetSetTime[code];
    } else if (cmd === 'name') {
        config.showNames = !config.showNames;
    } else if (cmd === 'compact') {
        config.compactMode = !config.compactMode;
    }

    saveConfig();
    displayTable(); 
}

function handleSortingKey(key) {
    const str = key.toString();

    if (str === '\u001B[A') { // ↑ arrow
        if (config.movingIndex !== null) {
            if (config.movingIndex > 0) {
                [config.stocks[config.movingIndex], config.stocks[config.movingIndex-1]] = 
                [config.stocks[config.movingIndex-1], config.stocks[config.movingIndex]];
                config.movingIndex--;
            }
        } else {
            config.selectedIndex = Math.max(0, config.selectedIndex - 1);
        }
    } 
    else if (str === '\u001B[B') { // ↓ arrow
        if (config.movingIndex !== null) {
            if (config.movingIndex < config.stocks.length - 1) {
                [config.stocks[config.movingIndex], config.stocks[config.movingIndex+1]] = 
                [config.stocks[config.movingIndex+1], config.stocks[config.movingIndex]];
                config.movingIndex++;
            }
        } else {
            config.selectedIndex = Math.min(config.stocks.length - 1, config.selectedIndex + 1);
        }
    } 
    else if (str === ' ') { // Space = select / move
        if (config.movingIndex === null) {
            config.movingIndex = config.selectedIndex;   // pick up the stock
        } else {
            config.movingIndex = null;                   // drop it
            saveConfig();
        }
    } 
    else if (str === '\r' || str === '\n' || str === 's' || str === 'q' || str === '\u001B') {
        // Enter / s / q / Esc = exit sorting mode
        config.sortingMode = false;
        config.movingIndex = null;
        saveConfig();
        exitSortingMode();
    }

    displayTable();
}

// Start in normal mode
currentRl.on('line', handleLineInput);

function saveConfig() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config));
}

// 3. Data Fetching – ENHANCED with more fields for composite signals (UNCHANGED)
async function getHKRealTimePrice(code) {
    const url = `https://realtime-money18-cdn.on.cc/securityQuote/genStockDetailHKJSON.php?stockcode=${code}`;
    try {
        const response = await axios.get(url, { 
            responseType: 'text', 
            headers: { 'Referer': 'https://money18.on.cc/', 'User-Agent': 'Mozilla/5.0' } 
        });
        let rawData = String(response.data);
        let jsonString = rawData.substring(rawData.indexOf('{'), rawData.lastIndexOf('}') + 1)
            .replace(/\r?\n|\r/g, "").replace(/\t/g, "").replace(/\s{2,}/g, " ");
        
        const data = JSON.parse(jsonString);

        return {
            code: code,
            name: data.daily.nameChi || data.daily.name,
            price: parseFloat(data.real.np),
            preClose: parseFloat(data.daily.preCPrice),
            change: data.calculation.change,
            percent: data.calculation.pctChange + "%",
            time: data.real.ltt,
            ma10: data.daily.ma10 ? parseFloat(data.daily.ma10) : null,
            ma20: data.daily.ma20 ? parseFloat(data.daily.ma20) : null,
            ma50: data.daily.ma50 ? parseFloat(data.daily.ma50) : null,
            rsi14: data.daily.rsi14 ? parseFloat(data.daily.rsi14) : null,
            wk52High: data.daily.wk52High ? parseFloat(data.daily.wk52High) : null,
            wk52Low: data.daily.wk52Low ? parseFloat(data.daily.wk52Low) : null,
            tenDayHigh: data.daily.tenDayHigh ? parseFloat(data.daily.tenDayHigh) : null,
            tenDayLow: data.daily.tenDayLow ? parseFloat(data.daily.tenDayLow) : null,
            dayHigh: data.real.dyh ? parseFloat(data.real.dyh) : null,
            dayLow: data.real.dyl ? parseFloat(data.real.dyl) : null,
            volume: data.real.vol ? parseFloat(data.real.vol) : 0
        };
    } catch (e) {
        console.error(chalk.red(`Error fetching ${code}`));
        return null;
    }
}

// 4. COMPOSITE TECHNICAL SIGNAL – Works for ALL stocks (UNCHANGED)
function getTechnicalSignal(stock) {
    if (!stock.ma10 || !stock.ma20 || !stock.ma50 || !stock.rsi14) {
        return chalk.gray('N/A');
    }

    const p = stock.price;
    const rsi = stock.rsi14;
    let score = 0;

    const aboveAllMA = p > stock.ma10 && p > stock.ma20 && p > stock.ma50;
    const belowAllMA = p < stock.ma10 && p < stock.ma20 && p < stock.ma50;
    if (aboveAllMA) score += 40;
    else if (belowAllMA) score -= 40;
    else if (p > stock.ma50) score += 15;
    else score -= 15;

    if (rsi > 70) score -= 30;
    else if (rsi < 30) score += 30;
    else if (rsi > 60) score -= 15;
    else if (rsi < 40) score += 15;
    else if (rsi > 50) score += 5;
    else score -= 5;

    if (stock.wk52High && stock.wk52Low) {
        const rangePct = (p - stock.wk52Low) / (stock.wk52High - stock.wk52Low) * 100;
        if (rangePct < 20) score += 15;
        else if (rangePct > 80) score -= 15;
    }

    if (stock.tenDayHigh && stock.tenDayLow) {
        const tenDayPct = (p - stock.tenDayLow) / (stock.tenDayHigh - stock.tenDayLow) * 100;
        if (tenDayPct < 25) score += 8;
        else if (tenDayPct > 75) score -= 8;
    }
    if (stock.dayHigh && stock.dayLow) {
        const dayPct = (p - stock.dayLow) / (stock.dayHigh - stock.dayLow) * 100;
        if (dayPct < 30 && String(stock.change).startsWith('-')) score -= 10;
        if (dayPct > 70 && !String(stock.change).startsWith('-')) score += 10;
    }

    let text = 'HOLD';
    let colorFn = chalk.yellow;
    if (score >= 60) { text = 'STRONG BUY'; colorFn = chalk.green.bold; }
    else if (score >= 30) { text = 'BUY'; colorFn = chalk.green; }
    else if (score <= -60) { text = 'STRONG SELL'; colorFn = chalk.red.bold; }
    else if (score <= -30) { text = 'SELL'; colorFn = chalk.red; }
    else if (score >= 10) { text = 'MILD BUY'; colorFn = chalk.green; }
    else if (score <= -10) { text = 'MILD SELL'; colorFn = chalk.red; }

    return colorFn(text);
}

// 5. Alert Logic – with grace period after setting target (UNCHANGED)
function checkAlert(stock) {
    const target = config.targets[stock.code];
    if (!target) return chalk.gray("-");

    const current = stock.price;
    const lastPrice = config.lastPrice?.[stock.code] ?? stock.preClose;
    const lastAlertTime = config.lastAlerted[stock.code] || 0;
    const targetSetTimestamp = config.targetSetTime?.[stock.code] || 0;
    const now = Date.now();
    const cooldown = 15 * 60 * 1000;

    const justSet = (now - targetSetTimestamp < 10000);

    let triggered = false;
    let msg = "";

    if (lastPrice < target && current >= target) {
        triggered = true;
        msg = `crossed UP to ${current.toFixed(3)} (target ${target})`;
    }
    else if (lastPrice > target && current <= target) {
        triggered = true;
        msg = `crossed DOWN to ${current.toFixed(3)} (target ${target})`;
    }
    else if (lastPrice !== target && current === target) {
        triggered = true;
        msg = `exactly hit ${target}`;
    }

    if (triggered && !justSet && (now - lastAlertTime > cooldown)) {
        notifier.notify({
            title: `🔔 Price Cross: ${stock.name}`,
            message: `${stock.code} ${msg}`,
            sound: true
        });
        config.lastAlerted[stock.code] = now;
        saveConfig();
        return chalk.bgMagenta.white(` HIT ${target} `);
    }

    if (!config.lastPrice) config.lastPrice = {};
    config.lastPrice[stock.code] = current;

    const arrow = current > target ? "▼" : current < target ? "▲" : "→";
    return chalk.cyan(`${arrow} [T: ${target}]`);
}

// 6. UI Rendering – NOW SUPPORTS SORTING MODE (only small addition)
async function displayTable() {
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);

    const head = config.sortingMode ? [chalk.cyan(' ')] : [];   // ← checkbox column
    head.push(chalk.cyan('Code'));
    if (config.showNames) head.push(chalk.cyan('Name'));
    head.push(
        chalk.cyan('Price'),
        chalk.cyan('Chg'),
        chalk.cyan('%'),
        chalk.cyan('Alert Target'),
        chalk.cyan('Signal'),
        chalk.cyan('Time')
    );

    const tableOptions = { head };
    if (config.compactMode) {
        tableOptions.chars = { 'top': '' , 'top-mid': '' , 'top-left': '' , 'top-right': '', 'bottom': '' , 'bottom-mid': '' , 'bottom-left': '' , 'bottom-right': '', 'left': '' , 'left-mid': '' , 'mid': '' , 'mid-mid': '', 'right': '' , 'right-mid': '' , 'middle': ' ' };
        tableOptions.style = { 'padding-left': 0, 'padding-right': 2, 'head': [] };
    }

    const table = new Table(tableOptions);

    for (let i = 0; i < config.stocks.length; i++) {
        const code = config.stocks[i];
        const stock = await getHKRealTimePrice(code);
        if (!stock) continue;

        const isUp = !String(stock.change).startsWith('-');
        const color = isUp ? chalk.green : chalk.red;

        const row = [];

        // === NEW: Checkbox column when sorting ===
        if (config.sortingMode) {
            const isSelected = (i === config.selectedIndex);
            const isMoving   = (i === config.movingIndex);
            const box = isMoving ? chalk.bgYellow.black('[x]') : 
                        isSelected ? chalk.cyan('[ ]') : '   ';
            row.push(box);
        }

        row.push(stock.code);
        if (config.showNames) row.push(stock.name);
        row.push(
            chalk.bold(stock.price.toFixed(3)),
            color(stock.change),
            color(stock.percent),
            checkAlert(stock),
            getTechnicalSignal(stock),
            chalk.gray(stock.time)
        );
        table.push(row);
    }

    const title = config.sortingMode 
        ? chalk.yellow.bold(`\n   HK REAL-TIME TERMINAL – SORTING MODE (↑↓ Space  s/q/Esc to exit)`)
        : chalk.yellow.bold(`\n   HK REAL-TIME TERMINAL – COMPOSITE TECHNICAL SIGNALS`);

    process.stdout.write(title + "\n");
    process.stdout.write(table.toString() + "\n");

    if (!config.sortingMode) {
        process.stdout.write(chalk.white(`   Commands: `) + 
            chalk.green(`a [code]`) + ` | ` + chalk.red(`r [code]`) + ` | ` + 
            chalk.magenta(`t [code] [price]`) + ` | ` + chalk.yellow(`ua [code]\n`) +
            chalk.blue(`   Options: name | compact | s (sort)\n`));
    }

    const timeStr = new Date().toLocaleTimeString();
    if (!config.sortingMode && currentRl.setPrompt) {
        currentRl.setPrompt(chalk.gray(`   Last Sync: ${timeStr} > `));
        currentRl.prompt(true);
    }
}

// Start monitoring
displayTable();
setInterval(displayTable, 5000);