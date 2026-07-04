'use strict';

const { GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const FONTS_DIR = path.join(__dirname, '../assets/fonts');
const CUSTOM_FONTS_DIR = path.join(__dirname, '../assets/fonts/custom');
const CUSTOM_FONTS_CACHE = path.join(__dirname, '../assets/fonts/custom/registry.json');

/* ═══════════════════════════════════════════════════════
   AVAILABLE FONT FAMILIES
   ═══════════════════════════════════════════════════════ */

const FONT_FAMILIES = {
    'Inter': {
        name: 'Inter',
        description: 'Clean & modern sans-serif',
        emoji: '<:Edit:1521227886634205298>',
        category: 'Sans-Serif',
        files: {
            regular: 'Inter-Regular.ttf',
            medium: 'Inter-Medium.ttf',
            semibold: 'Inter-SemiBold.ttf',
            bold: 'Inter-Bold.ttf'
        },
        registered: {
            regular: 'Inter-Regular',
            medium: 'Inter-Medium',
            semibold: 'Inter-SemiBold',
            bold: 'Inter-Bold'
        }
    },
    'Poppins': {
        name: 'Poppins',
        description: 'Geometric & friendly',
        emoji: '<:Star:1521227981685526568>',
        category: 'Sans-Serif',
        files: {
            regular: 'Poppins-Regular.ttf',
            medium: 'Poppins-Medium.ttf',
            semibold: 'Poppins-SemiBold.ttf',
            bold: 'Poppins-Bold.ttf'
        },
        registered: {
            regular: 'Poppins-Regular',
            medium: 'Poppins-Medium',
            semibold: 'Poppins-SemiBold',
            bold: 'Poppins-Bold'
        }
    },
    'Montserrat': {
        name: 'Montserrat',
        description: 'Elegant & professional',
        emoji: '<:Sketch:1521228025365004471>',
        category: 'Sans-Serif',
        files: {
            regular: 'Montserrat-Variable.ttf',
            medium: 'Montserrat-Variable.ttf',
            semibold: 'Montserrat-Variable.ttf',
            bold: 'Montserrat-Variable.ttf'
        },
        registered: {
            regular: 'Montserrat',
            medium: 'Montserrat',
            semibold: 'Montserrat',
            bold: 'Montserrat'
        }
    },
    'Outfit': {
        name: 'Outfit',
        description: 'Sleek & contemporary',
        emoji: '🔷',
        category: 'Sans-Serif',
        files: {
            regular: 'Outfit-Variable.ttf',
            medium: 'Outfit-Variable.ttf',
            semibold: 'Outfit-Variable.ttf',
            bold: 'Outfit-Variable.ttf'
        },
        registered: {
            regular: 'Outfit',
            medium: 'Outfit',
            semibold: 'Outfit',
            bold: 'Outfit'
        }
    },
    'SpaceGrotesk': {
        name: 'Space Grotesk',
        description: 'Futuristic & techy',
        emoji: '🚀',
        category: 'Sans-Serif',
        files: {
            regular: 'SpaceGrotesk-Variable.ttf',
            medium: 'SpaceGrotesk-Variable.ttf',
            semibold: 'SpaceGrotesk-Variable.ttf',
            bold: 'SpaceGrotesk-Variable.ttf'
        },
        registered: {
            regular: 'SpaceGrotesk',
            medium: 'SpaceGrotesk',
            semibold: 'SpaceGrotesk',
            bold: 'SpaceGrotesk'
        }
    },
    'JetBrainsMono': {
        name: 'JetBrains Mono',
        description: 'Developer monospace',
        emoji: '💻',
        category: 'Monospace',
        files: {
            regular: 'JetBrainsMono-Variable.ttf',
            medium: 'JetBrainsMono-Variable.ttf',
            semibold: 'JetBrainsMono-Variable.ttf',
            bold: 'JetBrainsMono-Variable.ttf'
        },
        registered: {
            regular: 'JetBrainsMono',
            medium: 'JetBrainsMono',
            semibold: 'JetBrainsMono',
            bold: 'JetBrainsMono'
        }
    },
    'Comfortaa': {
        name: 'Comfortaa',
        description: 'Soft & rounded',
        emoji: '🌸',
        category: 'Display',
        files: {
            regular: 'Comfortaa-Variable.ttf',
            medium: 'Comfortaa-Variable.ttf',
            semibold: 'Comfortaa-Variable.ttf',
            bold: 'Comfortaa-Variable.ttf'
        },
        registered: {
            regular: 'Comfortaa',
            medium: 'Comfortaa',
            semibold: 'Comfortaa',
            bold: 'Comfortaa'
        }
    },
    'Orbitron': {
        name: 'Orbitron',
        description: 'Sci-fi & gaming',
        emoji: '🎮',
        category: 'Display',
        files: {
            regular: 'Orbitron-Variable.ttf',
            medium: 'Orbitron-Variable.ttf',
            semibold: 'Orbitron-Variable.ttf',
            bold: 'Orbitron-Variable.ttf'
        },
        registered: {
            regular: 'Orbitron',
            medium: 'Orbitron',
            semibold: 'Orbitron',
            bold: 'Orbitron'
        }
    },
    'American Captain': {
        name: 'American Captain',
        description: 'Bold & sporty',
        emoji: '⚡',
        category: 'Display',
        files: {
            regular: 'American Captain.ttf'
        },
        registered: {
            regular: 'American Captain'
        }
    },
    'Cheri': {
        name: 'Cheri',
        description: 'Cute & rounded',
        emoji: '💖',
        category: 'Display',
        files: {
            regular: 'Cheri.ttf'
        },
        registered: {
            regular: 'Cheri'
        }
    },
    'Heyam': {
        name: 'Heyam',
        description: 'Elegant & stylish',
        emoji: '💖',
        category: 'Display',
        files: {
            regular: 'Heyam.ttf'
        },
        registered: {
            regular: 'Heyam'
        }
    },
    'Mitshuka': {
        name: 'Mitshuka',
        description: 'Cute & rounded',
        emoji: '💖',
        category: 'Display',
        files: {
            regular: 'Mitshuka.otf'
        },
        registered: {
            regular: 'Mitshuka.otf'
        }
    },
    'Road Rage': {
        name: 'Road Rage',
        description: 'Bold & sporty',
        emoji: '⚡',
        category: 'Display',
        files: {
            regular: 'Road_Rage.otf'
        },
        registered: {
            regular: 'Road_Rage.otf'
        }
    },
    'Shivaraj': {
        name: 'Shivaraj',
        description: 'Bold & sporty',
        emoji: '⚡',
        category: 'Display',
        files: {
            regular: 'Shivaraj.ttf'
        },
        registered: {
            regular: 'Shivaraj.ttf'
        }
    },
    'waltographUI': {
        name: 'waltographUI',
        description: 'Bold & sporty',
        emoji: '⚡',
        category: 'Display',
        files: {
            regular: 'waltographUI.ttf'
        },
        registered: {
            regular: 'waltographUI.ttf'
        }
    },
    'Rajdhani': {
        name: 'Rajdhani',
        description: 'Bold & sporty',
        emoji: '⚡',
        category: 'Display',
        files: {
            regular: 'Rajdhani-Regular.ttf',
            medium: 'Rajdhani-Medium.ttf',
            semibold: 'Rajdhani-SemiBold.ttf',
            bold: 'Rajdhani-Bold.ttf'
        },
        registered: {
            regular: 'Rajdhani-Regular',
            medium: 'Rajdhani-Medium',
            semibold: 'Rajdhani-SemiBold',
            bold: 'Rajdhani-Bold'
        }
    }
};

/* ═══════════════════════════════════════════════════════
   CUSTOM FONT REGISTRY (URL-based fonts)
   ═══════════════════════════════════════════════════════ */

const customFontRegistry = new Map();

/**
 * Ensure the custom fonts directory exists.
 */
function ensureCustomFontsDir() {
    if (!fs.existsSync(CUSTOM_FONTS_DIR)) {
        fs.mkdirSync(CUSTOM_FONTS_DIR, { recursive: true });
    }
}

/**
 * Load previously cached custom fonts from disk and re-register them with GlobalFonts.
 */
function loadCustomFontsFromCache() {
    ensureCustomFontsDir();
    if (!fs.existsSync(CUSTOM_FONTS_CACHE)) return;
    try {
        const data = JSON.parse(fs.readFileSync(CUSTOM_FONTS_CACHE, 'utf8'));
        for (const [key, entry] of Object.entries(data)) {
            if (fs.existsSync(entry.filePath)) {
                try {
                    GlobalFonts.registerFromPath(entry.filePath, entry.registeredName);
                    customFontRegistry.set(key, entry);
                } catch (e) {
                    // already registered or file corrupted
                    customFontRegistry.set(key, entry);
                }
            }
        }
    } catch (e) {
        // corrupted cache — ignore
    }
}

/**
 * Persist the custom font registry to disk.
 */
function saveCustomFontsCache() {
    ensureCustomFontsDir();
    const data = {};
    for (const [key, entry] of customFontRegistry.entries()) {
        data[key] = entry;
    }
    fs.writeFileSync(CUSTOM_FONTS_CACHE, JSON.stringify(data, null, 2));
}

/**
 * Download a file from a URL into a buffer.
 * Follows up to 5 redirects. Supports http and https.
 * @param {string} url
 * @param {number} [redirects=0]
 * @returns {Promise<Buffer>}
 */
function downloadBuffer(url, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error('Too many redirects'));
        const lib = url.startsWith('https://') ? https : http;
        const req = lib.get(url, { timeout: 15000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(downloadBuffer(res.headers.location, redirects + 1));
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    });
}

/**
 * Detect the font format from the URL or buffer magic bytes.
 * Returns one of: 'ttf', 'otf', 'woff', 'woff2' or null.
 */
function detectFontFormat(url, buffer) {
    const lower = url.toLowerCase().split('?')[0];
    if (lower.endsWith('.ttf')) return 'ttf';
    if (lower.endsWith('.otf')) return 'otf';
    if (lower.endsWith('.woff2')) return 'woff2';
    if (lower.endsWith('.woff')) return 'woff';
    if (buffer && buffer.length >= 4) {
        const magic = buffer.slice(0, 4).toString('hex');
        if (magic === '774f4646') return 'woff';
        if (magic === '774f4632') return 'woff2';
        if (magic === '00010000' || magic === '4f54544f') return 'ttf';
    }
    return null;
}

/**
 * Extract a human-readable font name from a URL.
 * e.g. "https://example.com/fonts/MyFont-Regular.ttf" → "MyFont Regular"
 */
function extractFontName(url) {
    try {
        const fileName = new URL(url).pathname.split('/').pop().replace(/\.[^.]+$/, '');
        return fileName.replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || 'Custom Font';
    } catch {
        return 'Custom Font';
    }
}

/**
 * Register a custom font from a direct URL (.ttf, .otf, .woff, .woff2).
 * Downloads, caches, registers with GlobalFonts and returns the font key.
 *
 * @param {string} url - Direct URL to the font file
 * @param {string} [displayName] - Optional name override
 * @returns {Promise<{ key: string, name: string, registeredName: string }>}
 */
async function registerCustomFontFromUrl(url, displayName) {
    ensureCustomFontsDir();

    const urlHash = crypto.createHash('md5').update(url).digest('hex').slice(0, 12);
    const fontKey = `custom_${urlHash}`;

    if (customFontRegistry.has(fontKey)) {
        return customFontRegistry.get(fontKey);
    }

    const buffer = await downloadBuffer(url);
    if (buffer.length < 100) throw new Error('Downloaded file is too small to be a valid font');
    if (buffer.length > 20 * 1024 * 1024) throw new Error('Font file exceeds 20 MB limit');

    const format = detectFontFormat(url, buffer);
    if (!format) throw new Error('Unsupported font format. Please use a .ttf, .otf, .woff, or .woff2 URL');

    const fontName = displayName || extractFontName(url);
    const registeredName = `CustomFont_${urlHash}`;
    const fileName = `${urlHash}.${format}`;
    const filePath = path.join(CUSTOM_FONTS_DIR, fileName);

    fs.writeFileSync(filePath, buffer);

    try {
        GlobalFonts.registerFromPath(filePath, registeredName);
    } catch (e) {
        // may already be registered — continue
    }

    const entry = { key: fontKey, name: fontName, registeredName, filePath, url, format };
    customFontRegistry.set(fontKey, entry);
    saveCustomFontsCache();

    return entry;
}

/**
 * Get the registered GlobalFonts name for a custom font key.
 * Returns null if not found.
 * @param {string} fontKey - e.g. "custom_abc123456789"
 */
function getCustomFontRegisteredName(fontKey) {
    const entry = customFontRegistry.get(fontKey);
    return entry ? entry.registeredName : null;
}

/**
 * Get the display name for a custom font key.
 */
function getCustomFontName(fontKey) {
    const entry = customFontRegistry.get(fontKey);
    return entry ? entry.name : 'Custom Font';
}

/* ═══════════════════════════════════════════════════════
   BUILT-IN FONT REGISTRATION
   ═══════════════════════════════════════════════════════ */

let fontsRegistered = false;

/**
 * Register all built-in font files with @napi-rs/canvas GlobalFonts.
 * Safe to call multiple times — registers only once.
 * Also loads any previously cached custom fonts.
 */
function registerAllFonts() {
    if (fontsRegistered) return;
    fontsRegistered = true;

    const registered = new Set();
    for (const family of Object.values(FONT_FAMILIES)) {
        for (const [weight, file] of Object.entries(family.files)) {
            const regName = family.registered[weight];
            if (registered.has(regName)) continue;
            try {
                GlobalFonts.registerFromPath(path.join(FONTS_DIR, file), regName);
                registered.add(regName);
            } catch (e) {
                // Font file missing or already registered
            }
        }
    }

    // Register Unicode-covering fallback fonts (NotoSans covers Latin ext + many scripts;
    // NotoSansJP covers CJK + Korean + more). These must always be registered so any
    // character not in the primary font (Inter/Poppins/etc.) can fall back to them
    // instead of rendering as a tofu box or wrong system font.
    const notoFonts = [
        { file: 'NotoSans-Regular.ttf', name: 'NotoSans' },
        { file: 'NotoSansJP-Regular.ttf', name: 'NotoSansJP' }
    ];
    for (const { file, name } of notoFonts) {
        try {
            GlobalFonts.registerFromPath(path.join(FONTS_DIR, file), name);
        } catch (_) { }
    }

    loadCustomFontsFromCache();
}

/**
 * Get font strings for a given family key.
 * Handles both built-in keys (e.g. 'Inter') and custom keys (e.g. 'custom_abc123').
 * @param {string} familyKey
 * @returns {{ getFont, getMediumFont, getSemiBoldFont, getBoldFont, familyName }}
 */
function getFontHelpers(familyKey) {
    registerAllFonts();
    // NotoSans + NotoSansJP act as Unicode fallbacks for non-Latin scripts
    // (Japanese, Chinese, Korean, Arabic, Cyrillic, etc.) so they must appear
    // in every font CSS string before the generic sans-serif keyword.
    const fallback = 'Arial, NotoSans, NotoSansJP, sans-serif';

    if (familyKey && familyKey.startsWith('custom_')) {
        const regName = getCustomFontRegisteredName(familyKey);
        const displayName = getCustomFontName(familyKey);
        if (regName) {
            return {
                familyName: displayName,
                getFont: (size) => `400 ${size}px ${regName}, ${fallback}`,
                getMediumFont: (size) => `500 ${size}px ${regName}, ${fallback}`,
                getSemiBoldFont: (size) => `600 ${size}px ${regName}, ${fallback}`,
                getBoldFont: (size) => `700 ${size}px ${regName}, ${fallback}`
            };
        }
    }

    const family = FONT_FAMILIES[familyKey] || FONT_FAMILIES['Inter'];
    return {
        familyName: family.name,
        getFont: (size) => `400 ${size}px ${family.registered.regular}, ${fallback}`,
        getMediumFont: (size) => `500 ${size}px ${family.registered.medium}, ${fallback}`,
        getSemiBoldFont: (size) => `600 ${size}px ${family.registered.semibold}, ${fallback}`,
        getBoldFont: (size) => `700 ${size}px ${family.registered.bold}, ${fallback}`
    };
}

/**
 * Get all available built-in font families for select menu options.
 * @returns {Array<{ label: string, value: string, description: string, emoji: string }>}
 */
function getFontOptions() {
    return Object.entries(FONT_FAMILIES).map(([key, family]) => ({
        label: family.name,
        value: key,
        description: `${family.category} • ${family.description}`,
        emoji: family.emoji
    }));
}

/**
 * Check if a font family key is valid (built-in or registered custom).
 */
function isValidFont(familyKey) {
    if (familyKey in FONT_FAMILIES) return true;
    if (familyKey && familyKey.startsWith('custom_') && customFontRegistry.has(familyKey)) return true;
    return false;
}

module.exports = {
    FONT_FAMILIES,
    registerAllFonts,
    loadCustomFontsFromCache,
    registerCustomFontFromUrl,
    getCustomFontRegisteredName,
    getCustomFontName,
    getFontHelpers,
    getFontOptions,
    isValidFont
};
