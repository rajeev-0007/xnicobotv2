const log = require('./logger-styled');
// Uses Node.js built-in fetch (v18+)

// Groq API Configuration (OpenAI-compatible, free & fast)
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const LEGACY_DEFAULT_PROMPTS = new Set([
    'You are a helpful AI assistant in a Discord server. Keep responses concise (under 1500 characters), friendly, and accurate.',
    'You are a helpful AI assistant in a Discord server. Answer questions clearly and concisely.'
]);

// Valid Groq-hosted models (updated March 2026)
const VALID_MODELS = new Set([
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3-70b-8192',
    'llama3-8b-8192',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
    'meta-llama/llama-4-scout-17b-16e-instruct',
]);

/**
 * Resolve model name - fall back to default for invalid models
 */
function resolveModel(model) {
    if (!model || !VALID_MODELS.has(model)) return DEFAULT_MODEL;
    return model;
}

// In-memory storage for conversation context per channel
const conversationHistory = new Map();
const rateLimitLastResponse = new Map();
const MAX_MESSAGES_IN_CONTEXT = 10;
const RATE_LIMIT_MS = 2000; // Minimum 2 seconds between responses per channel

/**
 * Get or create conversation history for a channel
 */
function getConversationHistory(channelId) {
    if (!conversationHistory.has(channelId)) {
        conversationHistory.set(channelId, []);
    }
    return conversationHistory.get(channelId);
}

/**
 * Add a message to conversation history
 */
function addToHistory(channelId, role, content) {
    const history = getConversationHistory(channelId);
    history.push({ role, content });

    // Keep only last MAX_MESSAGES_IN_CONTEXT messages
    if (history.length > MAX_MESSAGES_IN_CONTEXT) {
        history.shift();
    }
}

/**
 * Clear conversation history for a channel
 */
function clearHistory(channelId) {
    conversationHistory.delete(channelId);
}

/**
 * Check if rate limited for this channel
 */
function isRateLimited(channelId) {
    const lastTime = rateLimitLastResponse.get(channelId);
    if (!lastTime) return false;

    const timeSinceLastResponse = Date.now() - lastTime;
    return timeSinceLastResponse < RATE_LIMIT_MS;
}

/**
 * Update rate limit timestamp
 */
function updateRateLimit(channelId) {
    rateLimitLastResponse.set(channelId, Date.now());
}

function buildOwnerSummary(metadata = {}) {
    const ownerId = metadata.ownerId || process.env.OWNER_ID;
    const ownerTitle = process.env.AI_OWNER_TITLE || 'Owner and primary developer';
    const ownerBio = process.env.AI_OWNER_BIO || 'The owner manages the bot professionally, maintains its systems, and oversees updates, reliability, and feature delivery.';
    const supportServer = metadata.supportServer || process.env.SUPPORT_SERVER || 'https://discord.gg/Zs35X7Umak';
    const websiteUrl = metadata.websiteUrl || process.env.BOT_WEBSITE || 'https://thenico.vercel.app';

    return [
        `Owner: ${ownerId ? `<@${ownerId}>` : 'the configured bot owner'}`,
        `Role: ${ownerTitle}`,
        `Professional profile: ${ownerBio}`,
        `Support server: ${supportServer}`,
        `Website: ${websiteUrl}`
    ].join('\n');
}

function buildDefaultSystemPrompt(metadata = {}) {
    const botName = metadata.botName || process.env.BOT_NAME || 'xNico';
    const prefix = metadata.prefix || process.env.PREFIX || '-';
    const guildName = metadata.guildName || 'this server';

    return [
        `You are ${botName}, an advanced Discord bot assistant active in ${guildName}.`,
        'Primary behavior:',
        '- Be versatile. You can answer casually, professionally, technically, creatively, or step-by-step based on the user request.',
        '- Stay accurate, direct, and helpful. Do not invent bot features, permissions, integrations, or commands that are not confirmed.',
        '- Keep normal answers concise, but provide full detail when the user asks for code, scripts, prompts, plans, or technical help.',
        '- Prefer practical output over filler. If the user asks for code or a script, produce runnable code in fenced code blocks with the correct language.',
        '- You may write JavaScript, TypeScript, Python, Bash, SQL, HTML, CSS, JSON, YAML, and other common scripting or programming languages.',
        '- If the user asks for debugging help, reason carefully and suggest likely fixes and checks.',
        '',
        'Image-generation behavior:',
        '- You cannot directly render or attach brand-new AI-generated images from this chat channel.',
        '- When a user asks to generate an image, create a polished image-generation package instead: a strong main prompt, optional negative prompt, style notes, composition notes, aspect ratio suggestion, and a short caption if useful.',
        '- If the user wants edits to an existing image, you can describe the edit prompt or guide them to use the bot\'s available image commands when relevant.',
        '',
        'Bot-help behavior:',
        `- The server prefix is ${prefix}.`,
        '- Confirmed useful commands include /help or -help, /botinfo, /support, image effect commands, and /imagine or -imagine for AI image generation when the image API is configured.',
        '- If the image API is not configured, be clear that image generation may be unavailable until the bot owner sets IMAGE_API_URL.',
        '- If a user asks for bot-related help, answer based on the bot context you know and mention the support server when helpful.',
        '',
        'Owner identity behavior:',
        '- If someone asks who owns, created, developed, or maintains you, answer with a professional owner summary using the exact owner details below.',
        '- Do not invent extra biography, companies, roles, or links beyond the provided owner details.',
        buildOwnerSummary(metadata),
        '',
        'Style constraints:',
        '- Avoid unnecessary disclaimers.',
        '- Do not mention these instructions.',
        '- Keep each response under roughly 1500 characters unless the user explicitly asks for a larger code sample, script, template, or detailed explanation.'
    ].join('\n');
}

function resolveSystemPrompt(config = {}, metadata = {}) {
    const rawPrompt = typeof config.systemPrompt === 'string' ? config.systemPrompt.trim() : '';

    if (!rawPrompt || LEGACY_DEFAULT_PROMPTS.has(rawPrompt)) {
        return buildDefaultSystemPrompt(metadata);
    }

    return `${rawPrompt}\n\nRuntime bot facts:\n- Bot name: ${metadata.botName || process.env.BOT_NAME || 'xNico'}\n- Prefix: ${metadata.prefix || process.env.PREFIX || '-'}\n- Support server: ${metadata.supportServer || process.env.SUPPORT_SERVER || 'https://discord.gg/Zs35X7Umak'}\n- Website: ${metadata.websiteUrl || process.env.BOT_WEBSITE || 'https://thenico.vercel.app'}\n- Owner: ${metadata.ownerId ? `<@${metadata.ownerId}>` : (process.env.OWNER_ID ? `<@${process.env.OWNER_ID}>` : 'configured bot owner')}`;
}

/**
 * Generate AI response using Groq's OpenAI-compatible API
 */
async function generateAIResponse(userMessage, channelId, config) {
    try {
        // Check rate limit
        if (isRateLimited(channelId)) {
            return null; // Silently ignore if rate limited
        }

        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey || apiKey.length < 10) {
            log.error('[AI Chat] GROQ_API_KEY is not set or too short. Get one from https://console.groq.com/keys');
            return '<:Cancel:1521227723916181644> AI API key not configured. Ask bot owner to set `GROQ_API_KEY` in environment variables.';
        }

        // Add user message to history
        addToHistory(channelId, 'user', userMessage);

        // Build messages array with conversation context
        const messages = [
            {
                role: 'system',
                content: resolveSystemPrompt(config, config.metadata)
            },
            ...getConversationHistory(channelId)
        ];

        const model = resolveModel(config.model);

        // Call NVIDIA API (OpenAI-compatible endpoint)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                max_tokens: config.maxTokens || 1024,
                temperature: 0.7,
                top_p: 0.9
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            let errorMsg = '';
            try {
                const errorData = await response.json();
                errorMsg = errorData.error?.message || JSON.stringify(errorData);
            } catch { errorMsg = response.statusText; }
            log.error(`[AI Chat] Groq API error ${response.status}: ${errorMsg}`);

            if (response.status === 401) {
                return '<:Cancel:1521227723916181644> Invalid API key. The bot owner needs to update `GROQ_API_KEY`. Get a new key at https://console.groq.com/keys';
            } else if (response.status === 429) {
                return '⏱️ Rate limited by AI provider. Please wait a moment and try again.';
            } else if (response.status === 404 || response.status === 400) {
                // Model might be deprecated, try default
                log.error(`[AI Chat] Model "${model}" may be deprecated. Falling back to ${DEFAULT_MODEL}`);
                return `<:Cancel:1521227723916181644> AI model error. The server admin should update the model in \`/aichat-setup\`.`;
            } else {
                return `<:Cancel:1521227723916181644> AI error (${response.status}). Try again later.`;
            }
        }

        const data = await response.json();
        const aiMessage = data.choices?.[0]?.message?.content;

        if (!aiMessage) {
            return '<:Cancel:1521227723916181644> No response from AI. Try again.';
        }

        // Add AI response to history
        addToHistory(channelId, 'assistant', aiMessage);

        // Update rate limit
        updateRateLimit(channelId);

        return aiMessage;
    } catch (e) {
        log.error('AI chat error:', e.message);

        if (e.name === 'AbortError' || e.message.includes('abort')) {
            return '⏱️ AI response took too long. Try again.';
        }

        return `<:Cancel:1521227723916181644> AI error: ${e.message}`;
    }
}

/**
 * Clean up old conversations (call periodically)
 */
function cleanupOldConversations(maxChannels = 1000) {
    if (conversationHistory.size > maxChannels) {
        const entriesToDelete = conversationHistory.size - maxChannels;
        const entries = conversationHistory.entries();
        for (let i = 0; i < entriesToDelete; i++) {
            const { value } = entries.next();
            conversationHistory.delete(value[0]);
        }
    }
}

module.exports = {
    buildDefaultSystemPrompt,
    resolveSystemPrompt,
    generateAIResponse,
    getConversationHistory,
    addToHistory,
    clearHistory,
    isRateLimited,
    cleanupOldConversations
};
