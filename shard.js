const { ShardingManager } = require('discord.js');
const path = require('path');
const { fork } = require('child_process');
require('dotenv').config();
const log = require('./utils/logger-styled');

log.installConsoleInterceptors();

// ── Dashboard Server ──
let dashboardProcess = null;

function startDashboard() {
    const dashboardPath = path.join(__dirname, 'dashboard', 'server.js');
    try {
        require('fs').accessSync(dashboardPath);
        dashboardProcess = fork(dashboardPath, [], {
            cwd: path.join(__dirname, 'dashboard'),
            env: { ...process.env, DASHBOARD_PORT: process.env.DASHBOARD_PORT || '3500' },
            silent: false
        });
        dashboardProcess.on('error', (err) => {
            log.error(`[Dashboard] Error: ${err.message}`);
        });
        dashboardProcess.on('exit', (code) => {
            if (code !== 0) log.warning(`[Dashboard] Exited with code ${code}`);
        });
        log.success(`[Dashboard] Started on port ${process.env.DASHBOARD_PORT || 3500}`);
    } catch (e) {
        log.warning('[Dashboard] server.js not found, skipping dashboard');
    }
}

startDashboard();

// ── Uptime / Heartbeat Monitor ──
// Runs in this parent process (separate from the bot child) so it can detect
// the bot going offline via a stale heartbeat and post to the owner-configured
// webhook. Fully file-based; no gateway/DB access needed here.
try {
    const uptimeMonitor = require('./utils/uptimeMonitor');
    uptimeMonitor.startMonitor({ log });
} catch (e) {
    log.warning('[UptimeMonitor] Failed to start: ' + (e?.message || e));
}

// ── Shard Manager ──
const manager = new ShardingManager(path.join(__dirname, 'index.js'), {
    token: process.env.TOKEN,
    totalShards: 1,
    respawn: true,
    mode: 'process'
});

manager.on('shardCreate', shard => {
    log.info(`[Shard ${shard.id}] Launched`);
    
    shard.on('spawn', () => {
        log.success(`[Shard ${shard.id}] Spawned and initializing...`);
    });
    
    shard.on('disconnect', () => {
        log.warning(`[Shard ${shard.id}] Disconnected`);
    });
    
    shard.on('reconnecting', () => {
        log.info(`[Shard ${shard.id}] Reconnecting`);
    });
    
    shard.on('death', (process) => {
        log.critical(`[Shard ${shard.id}] Died with exit code ${process.exitCode}`);
    });
    
    shard.on('error', (error) => {
        log.error(`[Shard ${shard.id}] Error`, error);
    });
});

// ── Graceful shutdown ──────────────────────────────────────────────────────
// CRITICAL for data integrity: the bot keeps live state (economy, levels,
// configs, …) in an in-memory jsonStore cache that is debounced before being
// written to PostgreSQL. index.js flushes that cache to the DB in its own
// SIGTERM/SIGINT handler (gracefulShutdown -> jsonStore.flush()).
//
// Previously this manager called process.exit(0) the instant it received a
// signal — it killed the dashboard and exited WITHOUT telling the shard
// child to shut down and WITHOUT waiting for its flush. The OS then tore the
// shard down mid-flush, so every restart silently lost the last batch of
// command data ("data gets erased on restart").
//
// We now forward the signal to each shard child, wait for it to flush and
// exit (bounded by a grace timeout so a stuck shard can't hang the restart),
// then stop the dashboard and exit.
let shuttingDown = false;
async function gracefulManagerShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.warning(`[Manager] Received ${signal} — stopping shards gracefully so the database flushes...`);

    // Post the offline notice NOW while we're still alive (a hard kill/power
    // loss can't be reported — nothing would be running to send it).
    try {
        const uptimeMonitor = require('./utils/uptimeMonitor');
        await Promise.race([
            uptimeMonitor.notifyShutdown(`Manual Shutdown (${signal})`),
            new Promise(r => setTimeout(r, 3000)),
        ]);
    } catch {}

    const GRACE_MS = 15000;
    const waits = [];
    for (const shard of manager.shards.values()) {
        const child = shard.process || shard.worker;
        if (!child) continue;
        waits.push(new Promise((resolve) => {
            let settled = false;
            const finish = () => { if (!settled) { settled = true; resolve(); } };
            child.once('exit', finish);
            // SIGTERM triggers index.js gracefulShutdown -> jsonStore.flush().
            try { child.kill('SIGTERM'); } catch { finish(); }
            // Safety net: never hang the restart if a shard is wedged.
            setTimeout(() => { try { child.kill('SIGKILL'); } catch {} finish(); }, GRACE_MS);
        }));
    }

    try { await Promise.all(waits); } catch {}
    if (dashboardProcess) { try { dashboardProcess.kill('SIGTERM'); } catch {} }
    log.success('[Manager] Shards stopped and data flushed — exiting.');
    process.exit(0);
}

process.on('SIGINT',  () => gracefulManagerShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulManagerShutdown('SIGTERM'));

log.info('Starting Discord bot with 1 shard...');
manager.spawn({ timeout: 120000 }).then(() => {
    log.success('All shards spawned successfully!');
}).catch(error => {
    log.critical('Failed to spawn shards', error);
});
