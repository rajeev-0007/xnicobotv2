const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags,
    ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
    ChannelType, ContainerBuilder, TextDisplayBuilder,
    ChannelSelectMenuBuilder, RoleSelectMenuBuilder
} = require('discord.js');
const { getGuildConfig, buildAutomodPanel, loadConfig, saveConfig, getDefaultConfig } = require('../../utils/panels/automodPanel');
const { buildPermissionDenied } = require('../../utils/responseBuilder');
const { registerPanel, updatePanel } = require('../../utils/panelRegistry');

// ── Shared constants ──
const VALID_ACTIONS = ['delete', 'timeout', 'kick', 'ban', 'warn'];
const E = {
    ok: '<:Checkedbox:1521227734943269077>',
    on: '<:Toggleon:1521227758011809964>',
    off: '<:Toggleoff:1521227763816595559>',
    no: '<:Cancel:1521227723916181644>',
    warn: '<:Infotriangle:1521227710381428926>',
    shield: '<:Shield:1521227694677692467>',
    doc: '<:Document:1521227875016114266>',
    gear: '<:Settings:1521227767780343879>',
    mute: '<:Volumeoff:1521228297864745193>',
    ai: '<:Sketch:1521228025365004471>',
    img: '<:Picture:1521227954191995024>'
};

// All 11 toggleable filters (used by the toggle select menu)
const ALL_FILTERS = ['badWords', 'spam', 'links', 'invites', 'massMention', 'caps', 'profanity', 'sexualContent', 'slurs', 'aiText', 'aiImage'];

// ── Small helpers (keep the handlers minimal + consistent) ──
function persist(guildId, config) {
    saveConfig(config, guildId);
    if (global.updateAutomodCache) global.updateAutomodCache(guildId, config[guildId]);
}

async function refreshPanel(interaction, guildId) {
    await updatePanel(interaction.client, guildId, 'automod', async (message) => {
        // Editing a Components V2 message REQUIRES the IsComponentsV2 flag —
        // omitting it makes discord.js throw "Received one or more errors".
        await message.edit({ components: [buildAutomodPanel(getGuildConfig(guildId))], flags: MessageFlags.IsComponentsV2 });
    });
}

function ephem(interaction, content) {
    return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

function input(id, label, { style = TextInputStyle.Short, placeholder, value, required = true } = {}) {
    const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
    if (placeholder !== undefined) t.setPlaceholder(placeholder);
    if (value !== undefined && value !== null) t.setValue(String(value));
    return new ActionRowBuilder().addComponents(t);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('automod')
        .setDescription('Configure automatic moderation system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const container = buildAutomodPanel(getGuildConfig(guildId));
        const reply = await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, fetchReply: true });
        registerPanel(guildId, 'automod', interaction.channel.id, reply.id);
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply({ components: [buildPermissionDenied('Manage Guild')], flags: MessageFlags.IsComponentsV2 });
        }
        const guildId = message.guild.id;
        const container = buildAutomodPanel(getGuildConfig(guildId));
        const reply = await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        registerPanel(guildId, 'automod', message.channel.id, reply.id);
    },

    // ═══════════════════ Buttons + Select menus ═══════════════════
    async handleInteraction(interaction) {
        if (!interaction.guild || !interaction.member) return;

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return ephem(interaction, `${E.no} You need **Manage Guild** permission to configure AutoMod!`);
        }

        const guildId = interaction.guild.id;
        const id = interaction.customId;

        try {
            // ── Filter toggle select ──
            if (interaction.isStringSelectMenu() && id === 'automod_toggle_filters') {
                await interaction.deferUpdate();
                const config = loadConfig();
                if (!config[guildId]) config[guildId] = {};
                const defaults = getDefaultConfig();
                const selected = interaction.values || [];
                for (const f of ALL_FILTERS) {
                    if (!config[guildId][f]) config[guildId][f] = { ...defaults[f] };
                    config[guildId][f].enabled = selected.includes(f);
                }
                persist(guildId, config);
                await refreshPanel(interaction, guildId);
                return interaction.followUp({ content: `${E.ok} **${selected.length}/11** filters updated and synced.`, flags: MessageFlags.Ephemeral }).catch(() => {});
            }

            // ── Configure-filter select → open the matching modal ──
            if (interaction.isStringSelectMenu() && id === 'automod_configure_filter') {
                return this.openFilterModal(interaction, interaction.values[0]);
            }

            // ── Channel / Role select menus ──
            if (interaction.isChannelSelectMenu() && id === 'automod_select_log_channel') {
                const channel = interaction.guild.channels.cache.get(interaction.values[0]);
                if (!channel) return ephem(interaction, `${E.no} Selected channel not found!`);
                const config = loadConfig();
                if (!config[guildId]) config[guildId] = { enabled: false };
                config[guildId].logChannel = channel.id;
                persist(guildId, config);
                await ephem(interaction, `${E.ok} Log channel set to ${channel}!`);
                return refreshPanel(interaction, guildId);
            }

            if (interaction.isChannelSelectMenu() && id === 'automod_select_ignore_channels') {
                const ids = interaction.values || [];
                const config = loadConfig();
                if (!config[guildId]) config[guildId] = { enabled: false };
                config[guildId].ignoredChannels = ids;
                persist(guildId, config);
                const display = ids.length ? ids.map(i => `<#${i}>`).join(', ') : '*None*';
                await ephem(interaction, `${E.ok} Ignored channels updated (${ids.length}).\n**Channels:** ${display}`);
                return refreshPanel(interaction, guildId);
            }

            if (interaction.isRoleSelectMenu() && id === 'automod_select_bypass_role') {
                const role = interaction.guild.roles.cache.get(interaction.values[0]);
                if (!role) return ephem(interaction, `${E.no} Selected role not found!`);
                const config = loadConfig();
                if (!config[guildId]) config[guildId] = { enabled: false };
                config[guildId].bypassRoleId = role.id;
                persist(guildId, config);
                await ephem(interaction, `${E.ok} AutoMod bypass role set to ${role}!`);
                return refreshPanel(interaction, guildId);
            }

            if (interaction.isRoleSelectMenu() && id === 'automod_select_ignore_roles') {
                const ids = interaction.values || [];
                const config = loadConfig();
                if (!config[guildId]) config[guildId] = { enabled: false };
                config[guildId].ignoredRoles = ids;
                persist(guildId, config);
                const display = ids.length ? ids.map(i => `<@&${i}>`).join(', ') : '*None*';
                await ephem(interaction, `${E.ok} Ignored roles updated.\n**Roles:** ${display}`);
                return refreshPanel(interaction, guildId);
            }

            // ── Buttons ──
            switch (id) {
                case 'automod_toggle': {
                    await interaction.deferUpdate();
                    const config = loadConfig();
                    if (!config[guildId]) config[guildId] = { ...getDefaultConfig() };
                    config[guildId].enabled = !config[guildId].enabled;
                    persist(guildId, config);
                    return refreshPanel(interaction, guildId);
                }

                case 'automod_enable_all': {
                    await interaction.deferUpdate();
                    const config = loadConfig();
                    const existing = config[guildId] || {};
                    const defaults = getDefaultConfig();
                    const words = Array.isArray(existing.badWords?.words) && existing.badWords.words.length ? [...existing.badWords.words] : ['spam', 'scam', 'phish'];
                    const whitelist = Array.isArray(existing.links?.whitelist) && existing.links.whitelist.length ? [...existing.links.whitelist] : [];
                    config[guildId] = {
                        ...defaults, ...existing, enabled: true,
                        badWords: { ...defaults.badWords, ...existing.badWords, enabled: true, words },
                        spam: { ...defaults.spam, ...existing.spam, enabled: true },
                        links: { ...defaults.links, ...existing.links, enabled: true, whitelist },
                        invites: { ...defaults.invites, ...existing.invites, enabled: true },
                        massMention: { ...defaults.massMention, ...existing.massMention, enabled: true },
                        caps: { ...defaults.caps, ...existing.caps, enabled: true },
                        profanity: { ...defaults.profanity, ...existing.profanity, enabled: true },
                        sexualContent: { ...defaults.sexualContent, ...existing.sexualContent, enabled: true },
                        slurs: { ...defaults.slurs, ...existing.slurs, enabled: true }
                    };
                    persist(guildId, config);
                    await refreshPanel(interaction, guildId);
                    return interaction.followUp({ content: `${E.ok} **All filters deployed!** Your custom words and settings were preserved.`, flags: MessageFlags.Ephemeral }).catch(() => {});
                }

                case 'automod_default': {
                    await interaction.deferUpdate();
                    const config = loadConfig();
                    const prev = config[guildId] || {};
                    const d = getDefaultConfig();
                    d.enabled = true;
                    d.badWords = { ...d.badWords, enabled: true, words: ['spam', 'scam', 'hack', 'free nitro', 'discord nitro free'] };
                    d.spam.enabled = true;
                    d.links = { ...d.links, enabled: true, whitelist: ['youtube.com', 'discord.com', 'twitter.com', 'github.com', 'twitch.tv'] };
                    d.invites.enabled = true;
                    d.massMention.enabled = true;
                    d.caps.enabled = true;
                    d.profanity.enabled = true;
                    d.sexualContent.enabled = true;
                    d.slurs.enabled = true;
                    // Preserve non-filter settings
                    d.logChannel = prev.logChannel || null;
                    d.ignoredRoles = prev.ignoredRoles || [];
                    d.ignoredChannels = prev.ignoredChannels || [];
                    d.bypassRoleId = prev.bypassRoleId || null;
                    config[guildId] = d;
                    persist(guildId, config);
                    await refreshPanel(interaction, guildId);
                    return interaction.followUp({ content: `${E.ok} **AutoMod reset to defaults!** Core filters deployed.`, flags: MessageFlags.Ephemeral }).catch(() => {});
                }

                case 'automod_status': {
                    const c = getGuildConfig(guildId);
                    const chk = v => v ? E.on : E.off;
                    const active = ALL_FILTERS.filter(f => c[f]?.enabled).length;
                    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# ${E.shield} AutoMod Status\n\n` +
                        `**System:** ${c.enabled ? `${E.on} Enabled` : `${E.off} Disabled`}\n` +
                        `**Active Filters:** ${active}/11\n` +
                        `**Log Channel:** ${c.logChannel ? `<#${c.logChannel}>` : '`Not set`'}\n\n` +
                        `### Custom Filters\n` +
                        `${chk(c.badWords?.enabled)} Bad Words\n${chk(c.spam?.enabled)} Anti-Spam\n${chk(c.links?.enabled)} Link Filter\n${chk(c.invites?.enabled)} Invite Blocker\n${chk(c.massMention?.enabled)} Mass Mentions\n${chk(c.caps?.enabled)} Caps Lock\n\n` +
                        `### Discord Presets\n${chk(c.profanity?.enabled)} Profanity\n${chk(c.sexualContent?.enabled)} Sexual Content\n${chk(c.slurs?.enabled)} Slurs\n\n` +
                        `### AI Protection\n${chk(c.aiText?.enabled)} AI Text Scan\n${chk(c.aiImage?.enabled)} AI Image Scan`
                    ));
                    return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                }

                case 'automod_logs': {
                    const c = getGuildConfig(guildId);
                    const row = new ActionRowBuilder().addComponents(
                        new ChannelSelectMenuBuilder().setCustomId('automod_select_log_channel')
                            .setPlaceholder('Select the AutoMod log channel')
                            .addChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)
                    );
                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${E.doc} Set AutoMod Log Channel\nCurrent: ${c.logChannel ? `<#${c.logChannel}>` : '`None`'}\n\nSelect the channel where AutoMod events will be logged.`))
                        .addActionRowComponents(row);
                    return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                }

                case 'automod_bypass_role': {
                    const c = getGuildConfig(guildId);
                    const row = new ActionRowBuilder().addComponents(
                        new RoleSelectMenuBuilder().setCustomId('automod_select_bypass_role')
                            .setPlaceholder('Select the bypass role').setMinValues(1).setMaxValues(1)
                    );
                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${E.shield} Set AutoMod Bypass Role\nCurrent: ${c.bypassRoleId ? `<@&${c.bypassRoleId}>` : '`None`'}\n\nMembers with this role will bypass AutoMod filters.`))
                        .addActionRowComponents(row);
                    return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                }

                case 'automod_ignore_channels': {
                    const c = getGuildConfig(guildId);
                    const row = new ActionRowBuilder().addComponents(
                        new ChannelSelectMenuBuilder().setCustomId('automod_select_ignore_channels')
                            .setPlaceholder('Select channels to ignore (up to 10)')
                            .addChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(10)
                    );
                    const display = c.ignoredChannels?.length ? c.ignoredChannels.map(i => `<#${i}>`).join(', ') : '`None`';
                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${E.mute} Ignore Channels\nCurrent: ${display}\n\nSelect channels where AutoMod will not apply. Leave empty to clear.`))
                        .addActionRowComponents(row);
                    return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                }

                case 'automod_settings': {
                    const c = getGuildConfig(guildId);
                    const rolesRow = new ActionRowBuilder().addComponents(
                        new RoleSelectMenuBuilder().setCustomId('automod_select_ignore_roles')
                            .setPlaceholder('Select roles to ignore (up to 10)').setMinValues(0).setMaxValues(10)
                    );
                    const channelsRow = new ActionRowBuilder().addComponents(
                        new ChannelSelectMenuBuilder().setCustomId('automod_select_ignore_channels')
                            .setPlaceholder('Select channels to ignore (up to 10)')
                            .addChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(10)
                    );
                    const roles = c.ignoredRoles?.length ? c.ignoredRoles.map(i => `<@&${i}>`).join(', ') : '`None`';
                    const chans = c.ignoredChannels?.length ? c.ignoredChannels.map(i => `<#${i}>`).join(', ') : '`None`';
                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${E.gear} Advanced AutoMod Settings\n**Ignored Roles:** ${roles}\n**Ignored Channels:** ${chans}\n\nSelect roles and/or channels to exclude from AutoMod. Submit each dropdown separately.`))
                        .addActionRowComponents(rolesRow)
                        .addActionRowComponents(channelsRow);
                    return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                }
            }
        } catch (error) {
            console.error('[AutoMod] Interaction error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await ephem(interaction, `${E.no} An error occurred while processing that action.`).catch(() => {});
            }
        }
    },

    // Build + show the configuration modal for a given filter value.
    async openFilterModal(interaction, filterName) {
        const c = getGuildConfig(interaction.guild.id);
        let modal;
        switch (filterName) {
            case 'badwords':
                modal = new ModalBuilder().setCustomId('automod_modal_badwords').setTitle('Bad Words Filter').addComponents(
                    input('words', 'Bad words (comma separated)', { style: TextInputStyle.Paragraph, placeholder: 'word1, word2, word3', value: c.badWords?.words?.join(', ') || '', required: false }),
                    input('action', 'Action (delete, warn, timeout, kick, ban)', { placeholder: 'delete', value: c.badWords?.action || 'delete' }),
                    input('enabled', 'Enable? (yes/no)', { placeholder: 'yes', value: c.badWords?.enabled ? 'yes' : 'no' })
                );
                break;
            case 'spam':
                modal = new ModalBuilder().setCustomId('automod_modal_spam').setTitle('Anti-Spam Configuration').addComponents(
                    input('limit', 'Message limit (1-100)', { placeholder: '5', value: c.spam?.messageLimit || 5 }),
                    input('time', 'Time window in seconds (1-300)', { placeholder: '5', value: Math.round((c.spam?.timeWindow || 5000) / 1000) }),
                    input('action', 'Action (delete, warn, timeout, kick, ban)', { placeholder: 'timeout', value: c.spam?.action || 'timeout' }),
                    input('enabled', 'Enable? (yes/no)', { placeholder: 'yes', value: c.spam?.enabled ? 'yes' : 'no' })
                );
                break;
            case 'links':
                modal = new ModalBuilder().setCustomId('automod_modal_links').setTitle('Link Filter Configuration').addComponents(
                    input('whitelist', 'Whitelisted domains (comma separated)', { style: TextInputStyle.Paragraph, placeholder: 'youtube.com, discord.com', value: c.links?.whitelist?.join(', ') || '', required: false }),
                    input('action', 'Action (delete, warn, timeout, kick, ban)', { placeholder: 'delete', value: c.links?.action || 'delete' }),
                    input('enabled', 'Enable? (yes/no)', { placeholder: 'yes', value: c.links?.enabled ? 'yes' : 'no' })
                );
                break;
            case 'invites':
                modal = new ModalBuilder().setCustomId('automod_modal_invites').setTitle('Invite Blocker Configuration').addComponents(
                    input('action', 'Action (delete, warn, timeout, kick, ban)', { placeholder: 'delete', value: c.invites?.action || 'delete' }),
                    input('enabled', 'Enable? (yes/no)', { placeholder: 'yes', value: c.invites?.enabled ? 'yes' : 'no' })
                );
                break;
            case 'mentions':
                modal = new ModalBuilder().setCustomId('automod_modal_mentions').setTitle('Mass Mention Configuration').addComponents(
                    input('limit', 'Mention limit (1-50)', { placeholder: '5', value: c.massMention?.limit || 5 }),
                    input('action', 'Action (delete, warn, timeout, kick, ban)', { placeholder: 'delete', value: c.massMention?.action || 'delete' }),
                    input('enabled', 'Enable? (yes/no)', { placeholder: 'yes', value: c.massMention?.enabled ? 'yes' : 'no' })
                );
                break;
            case 'caps':
                modal = new ModalBuilder().setCustomId('automod_modal_caps').setTitle('Caps Lock Filter Configuration').addComponents(
                    input('percentage', 'Caps percentage threshold (1-100)', { placeholder: '70', value: c.caps?.percentage || 70 }),
                    input('minlength', 'Minimum message length (1-1000)', { placeholder: '10', value: c.caps?.minLength || 10 }),
                    input('action', 'Action (delete, warn, timeout, kick, ban)', { placeholder: 'delete', value: c.caps?.action || 'delete' }),
                    input('enabled', 'Enable? (yes/no)', { placeholder: 'yes', value: c.caps?.enabled ? 'yes' : 'no' })
                );
                break;
            case 'aitext':
                modal = new ModalBuilder().setCustomId('automod_modal_aitext').setTitle('AI Text Scan Configuration').addComponents(
                    input('action', 'Action (delete, warn, timeout, kick, ban)', { placeholder: 'delete', value: c.aiText?.action || 'delete' }),
                    input('minseverity', 'Min severity to act (low/medium/high)', { placeholder: 'medium', value: c.aiText?.minSeverity || 'medium' }),
                    input('enabled', 'Enable? (yes/no)', { placeholder: 'yes', value: c.aiText?.enabled ? 'yes' : 'no' })
                );
                break;
            case 'aiimage':
                modal = new ModalBuilder().setCustomId('automod_modal_aiimage').setTitle('AI Image Scan Configuration').addComponents(
                    input('action', 'Action (delete, warn, timeout, kick, ban)', { placeholder: 'delete', value: c.aiImage?.action || 'delete' }),
                    input('enabled', 'Enable? (yes/no)', { placeholder: 'yes', value: c.aiImage?.enabled ? 'yes' : 'no' })
                );
                break;
            default:
                return ephem(interaction, `${E.no} Unknown filter.`);
        }
        return interaction.showModal(modal);
    },

    // ═══════════════════ Modal submissions ═══════════════════
    async handleModal(interaction) {
        if (!interaction.isModalSubmit() || !interaction.guild) return;
        const guildId = interaction.guild.id;
        const id = interaction.customId;
        const field = (k) => interaction.fields.getTextInputValue(k);
        const config = loadConfig();
        if (!config[guildId]) config[guildId] = { enabled: false };

        const badAction = (a) => !VALID_ACTIONS.includes(a);
        const invalidActionMsg = `${E.no} Invalid action! Must be one of: ${VALID_ACTIONS.join(', ')}`;

        try {
            if (id === 'automod_modal_badwords') {
                const action = field('action').toLowerCase().trim();
                if (badAction(action)) return ephem(interaction, invalidActionMsg);
                const enabled = field('enabled').toLowerCase().trim() === 'yes';
                const words = field('words') ? field('words').split(',').map(w => w.trim().toLowerCase()).filter(Boolean) : [];
                config[guildId].badWords = { enabled, words, action };
                persist(guildId, config);
                await ephem(interaction, `${E.on} Bad words filter ${enabled ? 'enabled' : 'disabled'}!\nWords: ${words.length} • Action: ${action}`);
                return refreshPanel(interaction, guildId);
            }

            if (id === 'automod_modal_spam') {
                const limit = parseInt(field('limit'));
                const time = parseInt(field('time'));
                const action = field('action').toLowerCase().trim();
                const enabled = field('enabled').toLowerCase().trim() === 'yes';
                if (isNaN(limit) || limit < 1 || limit > 100) return ephem(interaction, `${E.no} Invalid message limit! Must be 1-100.`);
                if (isNaN(time) || time < 1 || time > 300) return ephem(interaction, `${E.no} Invalid time window! Must be 1-300 seconds.`);
                if (badAction(action)) return ephem(interaction, invalidActionMsg);
                config[guildId].spam = { enabled, messageLimit: limit, timeWindow: time * 1000, action };
                persist(guildId, config);
                await ephem(interaction, `${E.on} Anti-spam ${enabled ? 'enabled' : 'disabled'}!\nLimit: ${limit} msgs/${time}s • Action: ${action}`);
                return refreshPanel(interaction, guildId);
            }

            if (id === 'automod_modal_links') {
                const action = field('action').toLowerCase().trim();
                if (badAction(action)) return ephem(interaction, invalidActionMsg);
                const enabled = field('enabled').toLowerCase().trim() === 'yes';
                const whitelist = field('whitelist') ? field('whitelist').split(',').map(d => d.trim().toLowerCase()).filter(Boolean) : [];
                config[guildId].links = { enabled, whitelist, action };
                persist(guildId, config);
                await ephem(interaction, `${E.on} Link filter ${enabled ? 'enabled' : 'disabled'}!\nWhitelisted: ${whitelist.length} • Action: ${action}`);
                return refreshPanel(interaction, guildId);
            }

            if (id === 'automod_modal_invites') {
                const action = field('action').toLowerCase().trim();
                if (badAction(action)) return ephem(interaction, invalidActionMsg);
                const enabled = field('enabled').toLowerCase().trim() === 'yes';
                config[guildId].invites = { enabled, action };
                persist(guildId, config);
                await ephem(interaction, `${E.on} Invite blocker ${enabled ? 'enabled' : 'disabled'}!\nAction: ${action}`);
                return refreshPanel(interaction, guildId);
            }

            if (id === 'automod_modal_mentions') {
                const limit = parseInt(field('limit'));
                const action = field('action').toLowerCase().trim();
                const enabled = field('enabled').toLowerCase().trim() === 'yes';
                if (isNaN(limit) || limit < 1 || limit > 50) return ephem(interaction, `${E.no} Invalid mention limit! Must be 1-50.`);
                if (badAction(action)) return ephem(interaction, invalidActionMsg);
                config[guildId].massMention = { enabled, limit, action };
                persist(guildId, config);
                await ephem(interaction, `${E.on} Mass mention filter ${enabled ? 'enabled' : 'disabled'}!\nLimit: ${limit} • Action: ${action}`);
                return refreshPanel(interaction, guildId);
            }

            if (id === 'automod_modal_caps') {
                const percentage = parseInt(field('percentage'));
                const minLength = parseInt(field('minlength'));
                const action = field('action').toLowerCase().trim();
                const enabled = field('enabled').toLowerCase().trim() === 'yes';
                if (isNaN(percentage) || percentage < 1 || percentage > 100) return ephem(interaction, `${E.no} Invalid percentage! Must be 1-100.`);
                if (isNaN(minLength) || minLength < 1 || minLength > 1000) return ephem(interaction, `${E.no} Invalid minimum length! Must be 1-1000.`);
                if (badAction(action)) return ephem(interaction, invalidActionMsg);
                config[guildId].caps = { enabled, percentage, minLength, action };
                persist(guildId, config);
                await ephem(interaction, `${E.on} Caps lock filter ${enabled ? 'enabled' : 'disabled'}!\nThreshold: ${percentage}% on >${minLength} chars • Action: ${action}`);
                return refreshPanel(interaction, guildId);
            }

            if (id === 'automod_modal_aitext') {
                const action = field('action').toLowerCase().trim();
                const minSeverity = field('minseverity').toLowerCase().trim();
                const enabled = field('enabled').toLowerCase().trim() === 'yes';
                if (badAction(action)) return ephem(interaction, invalidActionMsg);
                if (!['low', 'medium', 'high'].includes(minSeverity)) return ephem(interaction, `${E.no} Invalid severity! Must be: low, medium, high.`);
                const keyNote = require('../../utils/aiModeration').hasApiKey() ? '' : `\n${E.warn} **Note:** No AI key configured — this filter stays inactive until the bot owner sets \`GROQ_API_KEY\`.`;
                config[guildId].aiText = { enabled, action, minSeverity };
                persist(guildId, config);
                await ephem(interaction, `${E.ai} AI Text Scan ${enabled ? 'enabled' : 'disabled'}!\nMin severity: \`${minSeverity}\` • Action: \`${action}\`\nDetects NSFW, slurs, hate & harassment in **any language**.${keyNote}`);
                return refreshPanel(interaction, guildId);
            }

            if (id === 'automod_modal_aiimage') {
                const action = field('action').toLowerCase().trim();
                const enabled = field('enabled').toLowerCase().trim() === 'yes';
                if (badAction(action)) return ephem(interaction, invalidActionMsg);
                const keyNote = require('../../utils/aiModeration').hasApiKey() ? '' : `\n${E.warn} **Note:** No AI key configured — this filter stays inactive until the bot owner sets \`GROQ_API_KEY\`.`;
                config[guildId].aiImage = { enabled, action };
                persist(guildId, config);
                await ephem(interaction, `${E.img} AI Image Scan ${enabled ? 'enabled' : 'disabled'}!\nAction: \`${action}\`\nScans uploaded images for **NSFW / explicit / gore** content.${keyNote}`);
                return refreshPanel(interaction, guildId);
            }
        } catch (error) {
            console.error('[AutoMod] Modal error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await ephem(interaction, `${E.no} An error occurred while saving that filter.`).catch(() => {});
            }
        }
    }
};
