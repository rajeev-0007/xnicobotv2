/**
 * API Key Manager — Single-file configuration for all API keys.
 *
 * Data file: datas/apikeys.json
 *
 * Usage:
 *   const apiKeys = require('../utils/apiKeyManager');
 *   const ytKey   = apiKeys.get('youtube', 'apiKey');
 *   const enabled = apiKeys.isEnabled('youtube');
 *   apiKeys.set('youtube', 'apiKey', 'MY_KEY');
 *   apiKeys.toggle('youtube', true);
 */

const jsonStore = require('./jsonStore');

const DEFAULT_CONFIG = {
    youtube:    { apiKey: null, enabled: false },
    twitch:     { clientId: null, clientSecret: null, enabled: false },
    instagram:  { accessToken: null, enabled: false },
    twitter:    { bearerToken: null, enabled: false },
    tiktok:     { enabled: false },
    openai:     { apiKey: null, enabled: false },
    google_tts: { apiKey: null, enabled: false },
    azure_tts:  { apiKey: null, region: null, enabled: false },
    tenor:      { apiKey: null, enabled: false },
    topgg:      { webhookSecret: null, enabled: false },
    image_api:  { url: null, enabled: false }
};

/* ─── I/O ─── */

function load() {
    try {
        const data = jsonStore.read('apikeys');
        if (!data || Object.keys(data).length === 0) {
            save(DEFAULT_CONFIG);
            return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        }
        for (const [key, val] of Object.entries(DEFAULT_CONFIG)) {
            if (!data[key]) data[key] = JSON.parse(JSON.stringify(val));
        }
        return data;
    } catch {
        return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
}

function save(config) {
    jsonStore.write('apikeys', config);
}

/* ─── Public API ─── */

/**
 * Get a specific field for a platform.
 * @param {string} platform  e.g. 'youtube', 'twitch', 'openai'
 * @param {string} field     e.g. 'apiKey', 'clientId'
 * @returns {string|null}
 */
function get(platform, field) {
    const config = load();
    return config[platform]?.[field] ?? null;
}

/**
 * Get the full config object for a platform.
 */
function getPlatform(platform) {
    const config = load();
    return config[platform] ?? null;
}

/**
 * Get the entire config.
 */
function getAll() {
    return load();
}

/**
 * Set a specific field for a platform.
 */
function set(platform, field, value) {
    const config = load();
    if (!config[platform]) config[platform] = {};
    config[platform][field] = value;
    save(config);
}

/**
 * Toggle a platform's enabled state.
 */
function toggle(platform, enabled) {
    const config = load();
    if (!config[platform]) config[platform] = {};
    config[platform].enabled = !!enabled;
    save(config);
}

/**
 * Check if a platform is enabled.
 */
function isEnabled(platform) {
    const config = load();
    return config[platform]?.enabled === true;
}

/**
 * Get a usable API key, falling back to env vars.
 * Checks apikeys.json first, then process.env.
 */
function resolve(platform, field = 'apiKey') {
    const fromConfig = get(platform, field);
    if (fromConfig) return fromConfig;

    // Fallback to common env var patterns
    const envMap = {
        'youtube.apiKey': 'YOUTUBE_API_KEY',
        'twitch.clientId': 'TWITCH_CLIENT_ID',
        'twitch.clientSecret': 'TWITCH_CLIENT_SECRET',
        'openai.apiKey': 'OPENAI_API_KEY',
        'tenor.apiKey': 'TENOR_API_KEY',
        'topgg.webhookSecret': 'TOPGG_WEBHOOK_SECRET',
        'image_api.url': 'IMAGE_API_URL'
    };

    const envKey = envMap[`${platform}.${field}`];
    return envKey ? (process.env[envKey] || null) : null;
}

module.exports = {
    get,
    getPlatform,
    getAll,
    set,
    toggle,
    isEnabled,
    resolve,
    load,
    save,
    DEFAULT_CONFIG
};
