const apiKeyManager = require('./apiKeyManager');

function getConfiguredImageApiBaseUrl() {
    // Support multiple image API providers
    const configuredUrl = (apiKeyManager.resolve('image_api', 'url') || process.env.IMAGE_API_URL || '').trim();

    // If it looks like a URL, use it directly
    if (configuredUrl.startsWith('http')) {
        try {
            const parsed = new URL(configuredUrl);
            return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
        } catch { /* fall through */ }
    }

    // Default: use some-random-api.com (free, no key required)
    return 'https://some-random-api.com/canvas/misc';
}

function isImageApiConfigured() {
    return true; // Always available with the free fallback
}

function buildImageApiRequestUrl(endpoint, params = {}) {
    const imageApiBaseUrl = getConfiguredImageApiBaseUrl();
    if (!imageApiBaseUrl) {
        return null;
    }

    const safeEndpoint = String(endpoint || '').replace(/^\/+/, '');
    if (!safeEndpoint) return null;

    const searchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            searchParams.set(key, String(value));
        }
    }

    const query = searchParams.toString();
    return query ? `${imageApiBaseUrl}/${safeEndpoint}?${query}` : `${imageApiBaseUrl}/${safeEndpoint}`;
}

function getImageApiUrl(endpoint, imageUrl, extraParams = {}) {
    if (!imageUrl) {
        return null;
    }

    return buildImageApiRequestUrl(endpoint, {
        image: imageUrl,
        ...extraParams
    });
}

function getUnavailableMessage() {
    return '<:Cancel:1521227723916181644> Image manipulation commands require an IMAGE_API_URL to be configured. Please contact the bot administrator.';
}

module.exports = {
    buildImageApiRequestUrl,
    isImageApiConfigured,
    getImageApiUrl,
    getUnavailableMessage
};
