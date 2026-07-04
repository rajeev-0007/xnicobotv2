const { isOwner } = require('../../utils/helpers');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, SeparatorBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const { checkAndExpire } = require('../../utils/panelExpiration');

function loadConfig() {
    try {
        if (!jsonStore.has('apikeys')) {
            jsonStore.write('apikeys', getDefaultConfig());
            return getDefaultConfig();
        }
        return jsonStore.read('apikeys');
    } catch (e) {
        return getDefaultConfig();
    }
}

function saveConfig(config) {
    jsonStore.write('apikeys', config);
}

function getDefaultConfig() {
    return {
        youtube: { apiKey: null, enabled: false },
        twitch: { clientId: null, clientSecret: null, enabled: false },
        instagram: { accessToken: null, enabled: false },
        twitter: { bearerToken: null, enabled: false },
        tiktok: { enabled: false },
        openai: { apiKey: null, enabled: false },
        google_tts: { apiKey: null, enabled: false },
        azure_tts: { apiKey: null, region: null, enabled: false },
        image_api: { url: null, enabled: false }
    };
}

function maskKey(key) {
    if (!key) return 'Not Set';
    if (key.length <= 8) return '****';
    return key.substring(0, 4) + '****' + key.substring(key.length - 4);
}

const PLATFORM_INFO = {
    youtube: { emoji: '1⃣', name: 'YouTube', description: 'YouTube Data API v3 Key' },
    twitch: { emoji: '2⃣', name: 'Twitch', description: 'Twitch Client ID & Secret' },
    instagram: { emoji: '3⃣', name: 'Instagram', description: 'Instagram Graph API Token' },
    twitter: { emoji: '4⃣', name: 'Twitter/X', description: 'Twitter API Bearer Token' },
    tiktok: { emoji: '5⃣', name: 'TikTok', description: 'TikTok API (Limited)' },
    openai: { emoji: '6⃣', name: 'OpenAI', description: 'OpenAI API Key for AI features' },
    google_tts: { emoji: '7⃣', name: 'Google Cloud TTS', description: 'Natural Hindi/multilingual voice (Neural2)' },
    azure_tts: { emoji: '8⃣', name: 'Azure Speech', description: 'Natural Hindi/multilingual voice (Neural)' },
    image_api: { emoji: '9⃣', name: 'Image API', description: 'Image manipulation API URL for image commands' }
};

function buildMainPanel(config) {
    const container = new ContainerBuilder().setAccentColor(0xED4245);

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('# <:Key:1521228000467878111> API Keys Configuration\n-# Configure API keys for social media notifications and other features\n-# <:Infotriangle:1521227710381428926> **Owner Only** - These settings affect the entire bot')
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    let statusText = '```ansi\n\u001b[1;37m Platform        Status      Key Status\n';
    statusText += '─────────────────────────────────────────\n';

    for (const [platform, info] of Object.entries(PLATFORM_INFO)) {
        const pConfig = config[platform] || {};
        const status = pConfig.enabled ? '\u001b[1;32m✓ ON ' : '\u001b[1;31m✗ OFF';
        let keyStatus = '\u001b[1;31mNot Set';
        
        if (platform === 'twitch') {
            keyStatus = pConfig.clientId && pConfig.clientSecret ? '\u001b[1;32mConfigured' : '\u001b[1;31mNot Set';
        } else if (platform === 'tiktok') {
            keyStatus = '\u001b[1;33mNo Key Needed';
        } else if (platform === 'azure_tts') {
            keyStatus = pConfig.apiKey && pConfig.region ? '\u001b[1;32mConfigured' : '\u001b[1;31mNot Set';
        } else if (platform === 'image_api') {
            keyStatus = pConfig.url ? '\u001b[1;32mConfigured' : '\u001b[1;31mNot Set';
        } else {
            keyStatus = pConfig.apiKey || pConfig.accessToken || pConfig.bearerToken ? '\u001b[1;32mConfigured' : '\u001b[1;31mNot Set';
        }
        
        const paddedName = info.name.padEnd(14);
        statusText += ` ${info.emoji} ${paddedName} ${status}   ${keyStatus}\u001b[0m\n`;
    }
    statusText += '```';

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText));

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('apikeys_platform_select')
        .setPlaceholder('Select a platform to configure...')
        .addOptions(
            Object.entries(PLATFORM_INFO).map(([key, info]) => ({
                label: info.name,
                description: info.description,
                value: key,
                emoji: info.emoji
            }))
        );

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(selectMenu)
    );

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('apikeys_refresh')
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Success)
            .setEmoji('<:History:1521227863079256278>'),
        new ButtonBuilder()
            .setCustomId('apikeys_help')
            .setLabel('Help')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Lightbulbalt:1521227880703463675>'),
        new ButtonBuilder()
            .setCustomId('apikeys_test_all')
            .setLabel('Test All')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🧪')
    );

    container.addActionRowComponents(buttons);

    return container;
}

function buildPlatformPanel(config, platform) {
    const info = PLATFORM_INFO[platform];
    const pConfig = config[platform] || {};
    const container = new ContainerBuilder().setAccentColor(0xED4245);

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# ${info.emoji} ${info.name} API Configuration\n-# ${info.description}`)
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    let keyInfo = '';
    if (platform === 'youtube') {
        keyInfo = `**API Key:** \`${maskKey(pConfig.apiKey)}\`\n\n` +
            `**How to get:**\n` +
            `1. Go to [Google Cloud Console](https://console.cloud.google.com)\n` +
            `2. Create a project and enable YouTube Data API v3\n` +
            `3. Create credentials (API Key)\n` +
            `4. Copy and paste the key here`;
    } else if (platform === 'twitch') {
        keyInfo = `**Client ID:** \`${maskKey(pConfig.clientId)}\`\n` +
            `**Client Secret:** \`${maskKey(pConfig.clientSecret)}\`\n\n` +
            `**How to get:**\n` +
            `1. Go to [Twitch Developers](https://dev.twitch.tv/console)\n` +
            `2. Register a new application\n` +
            `3. Copy Client ID and generate Client Secret`;
    } else if (platform === 'instagram') {
        keyInfo = `**Access Token:** \`${maskKey(pConfig.accessToken)}\`\n\n` +
            `**How to get:**\n` +
            `1. Create a Facebook Developer account\n` +
            `2. Set up Instagram Basic Display API\n` +
            `3. Generate a long-lived access token`;
    } else if (platform === 'twitter') {
        keyInfo = `**Bearer Token:** \`${maskKey(pConfig.bearerToken)}\`\n\n` +
            `**How to get:**\n` +
            `1. Go to [Twitter Developer Portal](https://developer.twitter.com)\n` +
            `2. Create a project and app\n` +
            `3. Generate Bearer Token from Keys & Tokens`;
    } else if (platform === 'tiktok') {
        keyInfo = `TikTok's API is limited. The bot uses web scraping for TikTok notifications which doesn't require an API key.\n\n` +
            `**Note:** This feature may be less reliable than API-based platforms.`;
    } else if (platform === 'openai') {
        keyInfo = `**API Key:** \`${maskKey(pConfig.apiKey)}\`\n\n` +
            `**How to get:**\n` +
            `1. Go to [OpenAI Platform](https://platform.openai.com)\n` +
            `2. Navigate to API Keys section\n` +
            `3. Create a new secret key`;
    } else if (platform === 'google_tts') {
        keyInfo = `**API Key:** \`${maskKey(pConfig.apiKey)}\`\n\n` +
            `**Voice:** Hindi Neural2 (hi-IN-Neural2-A/B) — sounds like a real person\n\n` +
            `**How to get:**\n` +
            `1. Go to [Google Cloud Console](https://console.cloud.google.com)\n` +
            `2. Enable **Cloud Text-to-Speech API**\n` +
            `3. Create credentials → API Key\n` +
            `4. Free tier: **1M chars/month** (Neural2), **4M chars/month** (Standard)\n\n` +
            `-# Once enabled, \`-speak नमस्ते दोस्तों\` will use natural Hindi voice`;
    } else if (platform === 'azure_tts') {
        keyInfo = `**API Key:** \`${maskKey(pConfig.apiKey)}\`\n` +
            `**Region:** \`${pConfig.region || 'Not Set'}\`\n\n` +
            `**Voice:** Hindi Neural (SwaraNeural ♀ / MadhurNeural ♂)\n\n` +
            `**How to get:**\n` +
            `1. Go to [Azure Portal](https://portal.azure.com)\n` +
            `2. Create a **Speech** resource (Cognitive Services)\n` +
            `3. Copy the Key and Region (e.g. \`centralindia\`)\n` +
            `4. Free tier: **500K chars/month**\n\n` +
            `-# Best regions for Hindi: \`centralindia\`, \`eastus\`, \`southeastasia\``;
    } else if (platform === 'image_api') {
        keyInfo = `**API URL:** \`${pConfig.url || 'Not Set'}\`\n\n` +
            `**About:**\nThe Image API URL is used for image manipulation commands (blur, pixelate, invert, etc).\n\n` +
            `**Setup:**\n` +
            `1. Deploy your own image API server or use a hosted one\n` +
            `2. Paste the base URL here (e.g. \`https://your-api.com\`)\n` +
            `3. The bot appends endpoints like \`/blur?imageUrl=...\`\n\n` +
            `-# Used by all image manipulation commands`;
    }

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(keyInfo)
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    const buttons = [];
    
    if (platform !== 'tiktok') {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`apikeys_set_${platform}`)
                .setLabel('Set Key')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Settings:1521227767780343879>')
        );
    }
    
    buttons.push(
        new ButtonBuilder()
            .setCustomId(`apikeys_toggle_${platform}`)
            .setLabel(pConfig.enabled ? 'Disable' : 'Enable')
            .setStyle(pConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji(pConfig.enabled ? '<:offline:1521228263177977897>' : '<:online:1521228065752088576>')
    );
    
    if (platform !== 'tiktok') {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`apikeys_test_${platform}`)
                .setLabel('Test')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🧪')
        );
        
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`apikeys_clear_${platform}`)
                .setLabel('Clear')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Trash:1521227750420254820>')
        );
    }

    container.addActionRowComponents(new ActionRowBuilder().addComponents(buttons));

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('apikeys_back')
                .setLabel('Back')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('⬅️')
        )
    );

    return container;
}

module.exports = {
    name: 'apikeys',
    prefix: 'apikeys',
    aliases: ['keys', 'api'],
    description: 'Configure API keys for bot features (Owner only)',
    usage: 'apikeys',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }
        const config = loadConfig();
        const container = buildMainPanel(config);
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async handleInteraction(interaction) {
        if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return false;

        const customId = interaction.customId;
        if (!customId.startsWith('apikeys_')) return false;

        // Check if config session has expired
        if (await checkAndExpire(interaction, 'config')) return true;

        if (!isOwner(interaction.user.id)) {
            await interaction.reply(require('../../utils/ownerUI').ownerOnly({ ephemeral: true }));
            return true;
        }

        const config = loadConfig();

        if (customId === 'apikeys_platform_select') {
            const platform = interaction.values[0];
            const container = buildPlatformPanel(config, platform);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'apikeys_back') {
            const container = buildMainPanel(config);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'apikeys_refresh') {
            const container = buildMainPanel(config);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'apikeys_help') {
            const helpText = `# <:Key:1521228000467878111> API Keys Help

**What are API Keys?**
API keys allow the bot to connect to external services like YouTube, Twitch, Twitter, etc. to fetch data and send notifications.

**Why do I need them?**
- **YouTube**: To check for new videos from channels
- **Twitch**: To detect when streamers go live
- **Twitter**: To monitor tweets from accounts
- **Instagram**: To track new posts
- **OpenAI**: For AI-powered features
- **Google Cloud TTS**: Natural Hindi voice (Neural2) for speak command
- **Azure Speech**: Natural Hindi voice (SwaraNeural/MadhurNeural) for speak command

**Security:**
- Keys are stored locally on the bot's server
- Only bot owners can view/modify keys
- Keys are masked when displayed

**TTS Setup:**
For natural Devanagari Hindi voice, configure either Google Cloud TTS or Azure Speech.
Both have free tiers — use \`-speak-config status\` to check TTS status.

**Rate Limits:**
Each platform has its own rate limits. The bot handles these automatically but excessive usage may require higher tier API access.`;
            
            await interaction.reply({ content: helpText, flags: MessageFlags.Ephemeral });
            return true;
        }

        // Set key modals
        const setMatch = customId.match(/^apikeys_set_(\w+)$/);
        if (setMatch) {
            const platform = setMatch[1];
            
            if (platform === 'twitch') {
                const modal = new ModalBuilder()
                    .setCustomId(`apikeys_modal_${platform}`)
                    .setTitle('Configure Twitch API');
                
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('client_id')
                            .setLabel('Client ID')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('Your Twitch Client ID')
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('client_secret')
                            .setLabel('Client Secret')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('Your Twitch Client Secret')
                            .setRequired(true)
                    )
                );
                
                await interaction.showModal(modal);
            } else if (platform === 'azure_tts') {
                const modal = new ModalBuilder()
                    .setCustomId(`apikeys_modal_${platform}`)
                    .setTitle('Configure Azure Speech TTS');
                
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('api_key')
                            .setLabel('Azure Speech API Key')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('Your Azure Speech subscription key')
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('region')
                            .setLabel('Azure Region (e.g. eastus, centralindia)')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('centralindia')
                            .setValue(config.azure_tts?.region || '')
                            .setRequired(true)
                    )
                );
                
                await interaction.showModal(modal);
            } else if (platform === 'image_api') {
                const modal = new ModalBuilder()
                    .setCustomId(`apikeys_modal_${platform}`)
                    .setTitle('Configure Image API');
                
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('api_url')
                            .setLabel('Image API Base URL')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('https://your-image-api.com')
                            .setValue(config.image_api?.url || '')
                            .setRequired(true)
                    )
                );
                
                await interaction.showModal(modal);
            } else {
                const labels = {
                    youtube: 'YouTube API Key',
                    instagram: 'Instagram Access Token',
                    twitter: 'Twitter Bearer Token',
                    openai: 'OpenAI API Key',
                    google_tts: 'Google Cloud TTS API Key'
                };
                
                const modal = new ModalBuilder()
                    .setCustomId(`apikeys_modal_${platform}`)
                    .setTitle(`Configure ${PLATFORM_INFO[platform].name}`);
                
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('api_key')
                            .setLabel(labels[platform] || 'API Key')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('Paste your API key here')
                            .setRequired(true)
                    )
                );
                
                await interaction.showModal(modal);
            }
            return true;
        }

        // Modal submissions
        const modalMatch = customId.match(/^apikeys_modal_(\w+)$/);
        if (modalMatch && interaction.isModalSubmit()) {
            const platform = modalMatch[1];
            
            if (platform === 'twitch') {
                config.twitch.clientId = interaction.fields.getTextInputValue('client_id');
                config.twitch.clientSecret = interaction.fields.getTextInputValue('client_secret');
            } else if (platform === 'youtube') {
                config.youtube.apiKey = interaction.fields.getTextInputValue('api_key');
            } else if (platform === 'instagram') {
                config.instagram.accessToken = interaction.fields.getTextInputValue('api_key');
            } else if (platform === 'twitter') {
                config.twitter.bearerToken = interaction.fields.getTextInputValue('api_key');
            } else if (platform === 'openai') {
                config.openai.apiKey = interaction.fields.getTextInputValue('api_key');
            } else if (platform === 'google_tts') {
                if (!config.google_tts) config.google_tts = { enabled: false };
                config.google_tts.apiKey = interaction.fields.getTextInputValue('api_key');
            } else if (platform === 'azure_tts') {
                if (!config.azure_tts) config.azure_tts = { enabled: false };
                config.azure_tts.apiKey = interaction.fields.getTextInputValue('api_key');
                config.azure_tts.region = interaction.fields.getTextInputValue('region');
            } else if (platform === 'image_api') {
                if (!config.image_api) config.image_api = { enabled: false };
                config.image_api.url = interaction.fields.getTextInputValue('api_url');
            }
            
            saveConfig(config);
            await interaction.reply({ content: `<:Checkedbox:1521227734943269077> ${PLATFORM_INFO[platform].name} API credentials saved!`, flags: MessageFlags.Ephemeral });
            return true;
        }

        // Toggle
        const toggleMatch = customId.match(/^apikeys_toggle_(\w+)$/);
        if (toggleMatch) {
            const platform = toggleMatch[1];
            if (!config[platform]) config[platform] = {};
            config[platform].enabled = !config[platform].enabled;
            saveConfig(config);
            
            const container = buildPlatformPanel(config, platform);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        // Clear
        const clearMatch = customId.match(/^apikeys_clear_(\w+)$/);
        if (clearMatch) {
            const platform = clearMatch[1];
            
            if (platform === 'twitch') {
                config.twitch.clientId = null;
                config.twitch.clientSecret = null;
            } else if (platform === 'youtube') {
                config.youtube.apiKey = null;
            } else if (platform === 'instagram') {
                config.instagram.accessToken = null;
            } else if (platform === 'twitter') {
                config.twitter.bearerToken = null;
            } else if (platform === 'openai') {
                config.openai.apiKey = null;
            } else if (platform === 'google_tts') {
                if (config.google_tts) config.google_tts.apiKey = null;
            } else if (platform === 'azure_tts') {
                if (config.azure_tts) { config.azure_tts.apiKey = null; config.azure_tts.region = null; }
            } else if (platform === 'image_api') {
                if (config.image_api) config.image_api.url = null;
            }
            
            saveConfig(config);
            const container = buildPlatformPanel(config, platform);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        // Test
        const testMatch = customId.match(/^apikeys_test_(\w+)$/);
        if (testMatch) {
            const platform = testMatch[1];
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            const result = await testPlatformApi(config, platform);
            await interaction.editReply({ content: result.success ? `<:Checkedbox:1521227734943269077> ${result.message}` : `<:Cancel:1521227723916181644> ${result.message}` });
            return true;
        }

        if (customId === 'apikeys_test_all') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            const platforms = ['youtube', 'twitch', 'instagram', 'twitter', 'openai', 'google_tts', 'azure_tts', 'image_api'];
            const results = [];
            
            for (const platform of platforms) {
                const result = await testPlatformApi(config, platform);
                const emoji = result.success ? '<:Checkedbox:1521227734943269077>' : (result.noKey ? '⚪' : '<:Cancel:1521227723916181644>');
                results.push(`${emoji} **${PLATFORM_INFO[platform].name}**: ${result.message}`);
            }
            
            await interaction.editReply({ content: `# 🧪 API Test Results\n\n${results.join('\n')}` });
            return true;
        }

        return false;
    },

    loadConfig,
    saveConfig
};

async function testPlatformApi(config, platform) {
    const axios = require('axios');
    
    try {
        if (platform === 'youtube') {
            if (!config.youtube?.apiKey) return { success: false, noKey: true, message: 'Not configured' };
            const res = await axios.get(`https://www.googleapis.com/youtube/v3/channels?part=snippet&id=UC_x5XG1OV2P6uZZ5FSM9Ttw&key=${config.youtube.apiKey}`, { timeout: 10000 });
            return { success: res.status === 200, message: 'YouTube API key is valid!' };
        }
        
        if (platform === 'twitch') {
            if (!config.twitch?.clientId || !config.twitch?.clientSecret) return { success: false, noKey: true, message: 'Not configured' };
            const res = await axios.post('https://id.twitch.tv/oauth2/token', null, {
                params: { client_id: config.twitch.clientId, client_secret: config.twitch.clientSecret, grant_type: 'client_credentials' },
                timeout: 10000
            });
            return { success: !!res.data.access_token, message: 'Twitch credentials are valid!' };
        }
        
        if (platform === 'instagram') {
            if (!config.instagram?.accessToken) return { success: false, noKey: true, message: 'Not configured' };
            const res = await axios.get(`https://graph.instagram.com/me?access_token=${config.instagram.accessToken}`, { timeout: 10000 });
            return { success: res.status === 200, message: 'Instagram token is valid!' };
        }
        
        if (platform === 'twitter') {
            if (!config.twitter?.bearerToken) return { success: false, noKey: true, message: 'Not configured' };
            const res = await axios.get('https://api.twitter.com/2/users/me', {
                headers: { 'Authorization': `Bearer ${config.twitter.bearerToken}` },
                timeout: 10000
            });
            return { success: res.status === 200, message: 'Twitter token is valid!' };
        }
        
        if (platform === 'openai') {
            if (!config.openai?.apiKey) return { success: false, noKey: true, message: 'Not configured' };
            const res = await axios.get('https://api.openai.com/v1/models', {
                headers: { 'Authorization': `Bearer ${config.openai.apiKey}` },
                timeout: 10000
            });
            return { success: res.status === 200, message: 'OpenAI API key is valid!' };
        }
        
        if (platform === 'google_tts') {
            if (!config.google_tts?.apiKey) return { success: false, noKey: true, message: 'Not configured' };
            const res = await axios.post(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${config.google_tts.apiKey}`, {
                input: { text: 'test' },
                voice: { languageCode: 'hi-IN', name: 'hi-IN-Neural2-A' },
                audioConfig: { audioEncoding: 'MP3' }
            }, { timeout: 10000 });
            return { success: !!res.data.audioContent, message: 'Google Cloud TTS key is valid! Neural Hindi voice ready.' };
        }
        
        if (platform === 'azure_tts') {
            if (!config.azure_tts?.apiKey || !config.azure_tts?.region) return { success: false, noKey: true, message: 'Not configured (need key + region)' };
            const tokenRes = await axios.post(`https://${config.azure_tts.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, null, {
                headers: { 'Ocp-Apim-Subscription-Key': config.azure_tts.apiKey },
                timeout: 5000
            });
            return { success: !!tokenRes.data, message: `Azure Speech key is valid! Region: ${config.azure_tts.region}` };
        }
        
        if (platform === 'image_api') {
            if (!config.image_api?.url) return { success: false, noKey: true, message: 'Not configured' };
            const res = await axios.get(config.image_api.url, { timeout: 10000 });
            return { success: res.status === 200, message: `Image API is reachable! URL: ${config.image_api.url}` };
        }
        
        return { success: false, message: 'Unknown platform' };
    } catch (error) {
        const errMsg = error.response?.data?.error?.message || error.response?.data?.message || error.message;
        return { success: false, message: `Test failed: ${errMsg}` };
    }
}
