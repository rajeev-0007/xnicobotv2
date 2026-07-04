const jsonStore = require('./jsonStore');

const EXTRA_OWNERS = ['699163868269641789'];

function isOwner(userId) {
    if (userId === process.env.OWNER_ID) return true;
    if (EXTRA_OWNERS.includes(userId)) return true;
    // Check co-owners from datas/owners.json
    try {
        const owners = jsonStore.read('owners');
        if (Array.isArray(owners) && owners.includes(userId)) return true;
    } catch {}
    return false;
}

function formatTime(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function parseTime(timeString) {
    if (timeString == null) return null;
    const s = String(timeString).trim();
    if (!s) return null;

    // Plain numeric — interpret as seconds.
    if (/^\d+$/.test(s)) return Number(s) * 1000;

    if (s.includes(':')) {
        const parts = s.split(':').map(Number);
        if (parts.some(isNaN)) return null;
        if (parts.length === 2) {
            const [minutes, seconds] = parts;
            return (minutes * 60 + seconds) * 1000;
        } else if (parts.length === 3) {
            const [hours, minutes, seconds] = parts;
            return (hours * 3600 + minutes * 60 + seconds) * 1000;
        }
        return null;
    }

    // Suffix form: 1h2m3s
    const re = /(\d+(?:\.\d+)?)([hms])/gi;
    let total = 0;
    let matched = false;
    let m;
    while ((m = re.exec(s)) !== null) {
        matched = true;
        const value = Number(m[1]);
        const unit = m[2].toLowerCase();
        if (unit === 'h') total += value * 3600;
        else if (unit === 'm') total += value * 60;
        else if (unit === 's') total += value;
    }
    if (matched) return Math.round(total * 1000);
    return null;
}

/**
 * Wait for a Lavalink node to become available (up to ~5 seconds).
 * Returns true if useable, false if still unavailable.
 */
async function waitForLavalink(lavalinkManager, maxWaitMs = 5000) {
    if (lavalinkManager.useable) return true;
    const interval = 1000;
    const attempts = Math.ceil(maxWaitMs / interval);
    for (let i = 0; i < attempts && !lavalinkManager.useable; i++) {
        await new Promise(r => setTimeout(r, interval));
    }
    return lavalinkManager.useable;
}

module.exports = { formatTime, parseTime, isOwner, waitForLavalink };
