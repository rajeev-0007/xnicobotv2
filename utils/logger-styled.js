'use strict';

const util = require('util');

/* ═══════════════════════════════════════════════════════════════════════
   NicoBot – Professional Console Logger
   ═══════════════════════════════════════════════════════════════════════
   Clean, minimal single-line output for normal operations.
   Errors & critical issues get a distinct bordered box style.
   ═══════════════════════════════════════════════════════════════════════ */

const c = {
    reset:   '\x1b[0m',
    bold:    '\x1b[1m',
    dim:     '\x1b[2m',
    italic:  '\x1b[3m',

    red:     '\x1b[31m',
    green:   '\x1b[32m',
    yellow:  '\x1b[33m',
    blue:    '\x1b[34m',
    magenta: '\x1b[35m',
    cyan:    '\x1b[36m',
    white:   '\x1b[37m',
    gray:    '\x1b[90m',
};

/* ── Log Levels ── */
const LOG_LEVELS = { NONE: 0, ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4 };
let currentLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] || LOG_LEVELS.INFO;

/* ── In-memory log store (accessible via client.systemLogs) ── */
const MAX_LOG_ENTRIES = 2000;
const logStore = [];

function pushLog(type, message) {
    logStore.push({
        type,
        message: typeof message === 'string' ? message : String(message),
        timestamp: new Date().toISOString()
    });
    if (logStore.length > MAX_LOG_ENTRIES) logStore.splice(0, logStore.length - MAX_LOG_ENTRIES);
}

/** Strip Discord custom emoji syntax like <:name:id> to keep console clean */
function strip(text) {
    return String(text).replace(/<a?:\w+:\d+>/g, '').replace(/\s{2,}/g, ' ').trim();
}

/** Formatted HH:MM:SS timestamp */
function ts() {
    return `${c.dim}${new Date().toTimeString().slice(0, 8)}${c.reset}`;
}

function writeStdout(message = '') {
    process.stdout.write(`${message}\n`);
}

function writeStderr(message = '') {
    process.stderr.write(`${message}\n`);
}

function formatValue(value) {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    return util.inspect(value, { depth: 4, colors: false, breakLength: 120 });
}

function formatConsoleArgs(args) {
    return args.map(formatValue).join(' ');
}

/* ═══════════════════════════════════════════════════════════════════════
   ERROR / CRITICAL BOX BUILDER
   Creates a distinct bordered block so errors never blend into output.
   ═══════════════════════════════════════════════════════════════════════ */
function errorBox(label, message, stack) {
    const width = 62;
    const top    = `${c.red}┌${'─'.repeat(width)}┐${c.reset}`;
    const bottom = `${c.red}└${'─'.repeat(width)}┘${c.reset}`;

    const pad = (text, w) => {
        const visible = text.replace(/\x1b\[[0-9;]*m/g, '');
        return text + ' '.repeat(Math.max(0, w - visible.length));
    };
    const line = (text) => `${c.red}│${c.reset} ${pad(text, width - 2)} ${c.red}│${c.reset}`;

    const lines = ['', top, line(`${c.bold}${c.red}${label}${c.reset}`), line(`${c.red}${'─'.repeat(width - 2)}${c.reset}`)];

    // Wrap long messages
    const msgChunks = message.match(new RegExp(`.{1,${width - 4}}`, 'g')) || [message];
    for (const chunk of msgChunks) lines.push(line(chunk));

    if (stack) {
        lines.push(line(''));
        const stackLines = stack.split('\n').slice(0, 6);
        for (const sl of stackLines) {
            const trimmed = sl.trim().substring(0, width - 4);
            lines.push(line(`${c.dim}${trimmed}${c.reset}`));
        }
    }

    lines.push(bottom, '');
    return lines.join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════ */

let consoleInterceptInstalled = false;

class StyledLogger {
    /** Access the in-memory log array */
    static get store() { return logStore; }
    static get LEVELS() { return LOG_LEVELS; }

    /** Change log level at runtime */
    static setLevel(level) {
        if (typeof level === 'string') level = LOG_LEVELS[level.toUpperCase()] ?? LOG_LEVELS.INFO;
        currentLevel = level;
    }

    /* ── Normal operations (clean, single-line) ── */

    static success(message) {
        pushLog('success', message);
        if (currentLevel >= LOG_LEVELS.INFO)
            writeStdout(`${ts()}  ${c.green}✔${c.reset}  ${strip(message)}`);
    }

    static info(message) {
        pushLog('info', message);
        if (currentLevel >= LOG_LEVELS.INFO)
            writeStdout(`${ts()}  ${c.cyan}•${c.reset}  ${strip(message)}`);
    }

    static bot(message) {
        pushLog('info', message);
        if (currentLevel >= LOG_LEVELS.INFO)
            writeStdout(`${ts()}  ${c.bold}${c.blue}★${c.reset}  ${c.bold}${strip(message)}${c.reset}`);
    }

    static debug(message) {
        pushLog('debug', message);
        if (currentLevel >= LOG_LEVELS.DEBUG)
            writeStdout(`${ts()}  ${c.gray}…  ${strip(message)}${c.reset}`);
    }

    static music(message) {
        pushLog('music', message);
        if (currentLevel >= LOG_LEVELS.DEBUG)
            writeStdout(`${ts()}  ${c.magenta}♪${c.reset}  ${c.dim}${strip(message)}${c.reset}`);
    }

    /* ── Errors & warnings (distinct boxed style) ── */

    static error(message, error = null) {
        const clean = strip(message);
        const errMsg = error?.message ? `${clean} — ${error.message}` : clean;
        pushLog('error', errMsg);
        if (currentLevel >= LOG_LEVELS.ERROR) {
            const stack = (error?.stack && currentLevel >= LOG_LEVELS.DEBUG) ? error.stack : null;
            writeStderr(errorBox('✖  ERROR', errMsg, stack));
        }
    }

    static warning(message) {
        const clean = strip(message);
        pushLog('warn', clean);
        if (currentLevel >= LOG_LEVELS.WARN)
            writeStdout(`${ts()}  ${c.yellow}!${c.reset}  ${clean}`);
    }

    static critical(message, error = null) {
        const clean = strip(message);
        const errMsg = error?.message ? `${clean} — ${error.message}` : clean;
        pushLog('error', `[CRITICAL] ${errMsg}`);
        // Critical always prints regardless of level
        const stack = error?.stack || null;
        writeStderr(errorBox('CRITICAL', errMsg, stack));
    }

    static installConsoleInterceptors() {
        if (consoleInterceptInstalled) return;
        consoleInterceptInstalled = true;

        console.log = (...args) => {
            StyledLogger.info(formatConsoleArgs(args));
        };

        console.info = (...args) => {
            StyledLogger.info(formatConsoleArgs(args));
        };

        console.debug = (...args) => {
            StyledLogger.debug(formatConsoleArgs(args));
        };

        console.warn = (...args) => {
            StyledLogger.warning(formatConsoleArgs(args));
        };

        console.error = (...args) => {
            const allText = args.map(a => String(a?.message || a || '')).join(' ');
            if (
                allText.includes('ON-OPEN-FETCH') ||
                (allText.includes('<!DOCTYPE') && allText.includes('not valid JSON')) ||
                allText.includes('does not provide any /v4/info')
            ) {
                return;
            }
            const errorArg = args.find(arg => arg instanceof Error) || null;
            if (errorArg) {
                const messageArgs = args.filter(arg => arg !== errorArg);
                const message = formatConsoleArgs(messageArgs) || errorArg.message || 'Unknown error';
                StyledLogger.error(message, errorArg);
                return;
            }

            StyledLogger.error(formatConsoleArgs(args) || 'Unknown error');
        };
    }

    /* ── Sections & structure ── */

    static section(title, compact = false) {
        if (currentLevel < LOG_LEVELS.INFO) return;
        if (compact) {
            writeStdout(`\n  ${c.cyan}<:Caretright:1521227704953864202>${c.reset} ${c.bold}${title}${c.reset}`);
        } else {
            writeStdout(`\n  ${c.cyan}━━━${c.reset} ${c.bold}${title}${c.reset} ${c.cyan}━━━${c.reset}`);
        }
    }

    static header(message) {
        pushLog('info', message);
        if (currentLevel >= LOG_LEVELS.INFO)
            writeStdout(`\n  ${c.bold}${c.cyan}<:Caretright:1521227704953864202> ${message}${c.reset}`);
    }

    static divider() {
        if (currentLevel >= LOG_LEVELS.INFO)
            writeStdout(`  ${c.dim}${'─'.repeat(44)}${c.reset}`);
    }

    static command(category, count) {
        if (currentLevel >= LOG_LEVELS.INFO) {
            const pad = category.padEnd(12);
            writeStdout(`     ${c.dim}${pad}${c.reset} ${c.bold}${count}${c.reset}`);
        }
    }

    static compact(items) {
        if (currentLevel < LOG_LEVELS.INFO) return;
        const perRow = 4;
        for (let i = 0; i < items.length; i += perRow) {
            const row = items.slice(i, i + perRow);
            const formatted = row.map(([name, cnt]) =>
                `${c.dim}${name}${c.reset} ${c.bold}${cnt}${c.reset}`
            ).join('  │  ');
            writeStdout(`     ${formatted}`);
        }
    }

    static banner(text) {
        if (currentLevel < LOG_LEVELS.INFO) return;
        const width = 44;
        const padding = Math.floor((width - text.length - 2) / 2);
        const leftPad = ' '.repeat(Math.max(0, padding));
        const rightPad = ' '.repeat(Math.max(0, width - text.length - padding - 2));
        writeStdout(`\n  ${c.bold}${c.blue}╔${'═'.repeat(width)}╗${c.reset}`);
        writeStdout(`  ${c.bold}${c.blue}║${leftPad}${text}${rightPad}║${c.reset}`);
        writeStdout(`  ${c.bold}${c.blue}╚${'═'.repeat(width)}╝${c.reset}`);
    }

    static startup() {
        if (currentLevel < LOG_LEVELS.INFO) return;
        writeStdout(`\n  ${c.bold}${c.cyan}███╗░░██╗██╗░█████╗░░█████╗░${c.reset}`);
        writeStdout(`  ${c.bold}${c.cyan}████╗░██║██║██╔══██╗██╔══██╗${c.reset}`);
        writeStdout(`  ${c.bold}${c.cyan}██╔██╗██║██║██║░░╚═╝██║░░██║${c.reset}`);
        writeStdout(`  ${c.bold}${c.cyan}██║╚████║██║██║░░██╗██║░░██║${c.reset}`);
        writeStdout(`  ${c.bold}${c.cyan}██║░╚███║██║╚█████╔╝╚█████╔╝${c.reset}`);
        writeStdout(`  ${c.bold}${c.cyan}╚═╝░░╚══╝╚═╝░╚════╝░░╚════╝░${c.reset}`);
        writeStdout('');
    }
}

module.exports = StyledLogger;
