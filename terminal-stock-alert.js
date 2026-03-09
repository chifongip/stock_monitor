const axios = require('axios');
const Table = require('cli-table3');
const chalk = require('chalk');
const fs = require('fs');
const readline = require('readline');
const notifier = require('node-notifier');

const CONFIG_FILE = './stocks.json';

// 1. Load configuration (Stocks, Preferences, Targets)
let config = {
    stocks: ['00700', '00005'],
    targets: {},      // { "00700": 550.0 }
    lastAlerted: {},  // { "00700": timestamp }
    showNames: true,
    compactMode: false
};

if (fs.existsSync(CONFIG_FILE)) {
    try {
        const fileData = JSON.parse(fs.readFileSync(CONFIG_FILE));
        // Handle array-only legacy files
        if (Array.isArray(fileData)) config.stocks = fileData;
        else config = { ...config, ...fileData };
    } catch (e) { saveConfig(); }
}

// 2. Setup Interface (Using terminal: true for better cursor handling)
const rl = readline.createInterface({ 
    input: process.stdin, 
    output: process.stdout, 
    terminal: true 
});

rl.on('line', (line) => {
    const input = line.trim().split(/\s+/);
    const cmd = input[0].toLowerCase();
    const code = input[1] ? input[1].padStart(5, '0') : null;
    const val = input[2];

    if (cmd === 'a' && code) {
        if (!config.stocks.includes(code)) config.stocks.push(code);
    } else if (cmd === 'r' && code) {
        config.stocks = config.stocks.filter(s => s !== code);
        delete config.targets[code];
        delete config.lastAlerted[code];
    } else if (cmd === 't' && code && val) {
        config.targets[code] = parseFloat(val);
        delete config.lastAlerted[code]; // Reset cooldown when target changes
    } else if (cmd === 'ua' && code) {
        delete config.targets[code];
        delete config.lastAlerted[code];
    } else if (cmd === 'name') {
        config.showNames = !config.showNames;
    } else if (cmd === 'compact') {
        config.compactMode = !config.compactMode;
    }
    saveConfig();
    displayTable(); 
});

function saveConfig() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config));
}

// 3. Data Fetching (Money18 Real-time)
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
            time: data.real.ltt
        };
    } catch (e) { return null; }
}

// 4. Alert Logic (Handles both Crossing UP and Crossing DOWN)
function checkAlert(stock) {
    const target = config.targets[stock.code];
    if (!target) return chalk.gray("-");

    const current = stock.price;
    const preClose = stock.preClose;
    const lastAlertTime = config.lastAlerted[stock.code] || 0;
    const now = Date.now();
    const cooldown = 15 * 60 * 1000; // 15 mins

    let triggered = false;
    let msg = "";

    // Target is a "Ceiling" (Price crossing UP)
    if (target > preClose && current >= target) {
        triggered = true;
        msg = `reached (UP)`;
    } 
    // Target is a "Floor" (Price crossing DOWN)
    else if (target < preClose && current <= target) {
        triggered = true;
        msg = `dropped to (DOWN)`;
    }

    if (triggered && (now - lastAlertTime > cooldown)) {
        notifier.notify({
            title: `🔔 Price Alert: ${stock.name}`,
            message: `${stock.code} ${msg} ${current} (Target: ${target})`,
            sound: true
        });
        config.lastAlerted[stock.code] = now;
        saveConfig();
        return chalk.bgMagenta.white(` HIT ${target} `);
    }

    const arrow = target > current ? "▲" : "▼";
    return chalk.cyan(`${arrow} [T: ${target}]`);
}

// 5. UI Rendering (Repositioning cursor to prevent input flash)
async function displayTable() {
    // Move cursor to top-left and clear downwards
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);

    const head = [chalk.cyan('Code')];
    if (config.showNames) head.push(chalk.cyan('Name'));
    head.push(chalk.cyan('Price'), chalk.cyan('Chg'), chalk.cyan('%'), chalk.cyan('Alert Target'), chalk.cyan('Time'));

    const tableOptions = { head };
    if (config.compactMode) {
        tableOptions.chars = { 'top': '' , 'top-mid': '' , 'top-left': '' , 'top-right': '', 'bottom': '' , 'bottom-mid': '' , 'bottom-left': '' , 'bottom-right': '', 'left': '' , 'left-mid': '' , 'mid': '' , 'mid-mid': '', 'right': '' , 'right-mid': '' , 'middle': ' ' };
        tableOptions.style = { 'padding-left': 0, 'padding-right': 2, 'head': [] };
    }

    const table = new Table(tableOptions);

    for (const code of config.stocks) {
        const stock = await getHKRealTimePrice(code);
        if (stock) {
            const isUp = !String(stock.change).startsWith('-');
            const color = isUp ? chalk.green : chalk.red;
            
            const row = [stock.code];
            if (config.showNames) row.push(stock.name);
            row.push(chalk.bold(stock.price.toFixed(3)), color(stock.change), color(stock.percent), checkAlert(stock), chalk.gray(stock.time));
            table.push(row);
        }
    }

    process.stdout.write(chalk.yellow.bold(`\n   HK REAL-TIME TERMINAL\n`));
    process.stdout.write(table.toString() + "\n");
    process.stdout.write(chalk.white(`   Commands: `) + 
                chalk.green(`a [code]`) + ` | ` + 
                chalk.red(`r [code]`) + ` | ` + 
                chalk.magenta(`t [code] [price]`) + ` | ` + 
                chalk.yellow(`ua [code]\n`));
    
    // Refresh the user's current typing line at the bottom
    const timeStr = new Date().toLocaleTimeString();
    rl.setPrompt(chalk.gray(`   Last Sync: ${timeStr} > `));
    rl.prompt(true); 
}

// Refresh every 5 seconds
displayTable();
setInterval(displayTable, 5000);