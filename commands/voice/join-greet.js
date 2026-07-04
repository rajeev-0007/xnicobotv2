'use strict';

const {
    MessageFlags, PermissionFlagsBits,
    ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize
} = require('discord.js');
const jsonStore = require('../../utils/jsonStore');
const log = require('../../utils/logger-styled');

const STORE = 'join-greet';

function loadConfig() {
    try {
        if (jsonStore.has(STORE)) return jsonStore.read(STORE);
    } catch {}
    return {};
}

function saveConfig(config) {
    jsonStore.write(STORE, config);
}

function panel(content, color = 0xCAD7E6) {
    return new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;
}

function denied() {
    return panel(
        `# <:Cancel:1521227723916181644> Permission Denied\n\n` +
        `You need **Manage Server** permission to configure join greetings.`,
        0xED4245
    );
}

module.exports = {
    name: 'join-greet',
    prefix: 'join-greet',
    description: 'Configure voice channel join/leave greetings',
    usage: 'join-greet <join|leave|toggle|status> [on|off]',
    category: 'voice',
    aliases: ['joingreet', 'vcgreet', 'vgreet'],

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply({ components: [denied()], flags: MessageFlags.IsComponentsV2 });
        }

        const action = (args[0] || '').toLowerCase();
        const config = loadConfig();
        const guildId = message.guildId;

        // ── join ──────────────────────────────────────────────────
        if (action === 'join') {
            const voiceChannel = message.member.voice.channel;
            if (!voiceChannel) {
                return message.reply({
                    components: [panel(
                        `# <:Cancel:1521227723916181644> Voice Required\n\n` +
                        `Join the voice channel where you want greetings to play, then run this command again.`,
                        0xED4245
                    )],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            config[guildId] = {
                ...config[guildId],
                voiceChannelId: voiceChannel.id,
                textChannelId:  message.channelId,
                enabled:        true
            };
            saveConfig(config);

            try {
                const player = message.client.lavalinkManager.createPlayer({
                    guildId,
                    voiceChannelId: voiceChannel.id,
                    textChannelId:  message.channelId,
                    selfDeaf:       true
                });
                if (!player.connected) await player.connect();
            } catch (err) {
                log.error(`[join-greet] Connect failed: ${err.message}`);
            }

            return message.reply({
                components: [panel(
                    `# <:Checkedbox:1521227734943269077> Join Greet Enabled\n\n` +
                    `**Channel:** ${voiceChannel}\n` +
                    `**Status:** <:Toggleon:1521227758011809964> Enabled\n\n` +
                    `The bot will greet members joining **${voiceChannel.name}**.\n\n` +
                    `-# Use \`-join-greet toggle off\` to disable · \`-join-greet leave\` to disconnect`,
                    0x57F287
                )],
                flags: MessageFlags.IsComponentsV2
            });
        }

        // ── leave / disconnect ────────────────────────────────────
        if (action === 'leave' || action === 'disconnect') {
            if (config[guildId]) {
                config[guildId].enabled = false;
                saveConfig(config);
            }
            try {
                const player = message.client.lavalinkManager.getPlayer(guildId);
                if (player) {
                    if (player.connected) await player.disconnect();
                    await player.destroy();
                }
            } catch {}

            return message.reply({
                components: [panel(
                    `# <:Checkedbox:1521227734943269077> Disconnected\n\n` +
                    `Voice greetings disabled and the bot left the channel.`,
                    0x57F287
                )],
                flags: MessageFlags.IsComponentsV2
            });
        }

        // ── toggle ────────────────────────────────────────────────
        if (action === 'toggle') {
            const state = (args[1] || '').toLowerCase();
            if (state !== 'on' && state !== 'off') {
                return message.reply({
                    components: [panel(
                        `# <:Settings:1521227767780343879> Join Greet Toggle\n\n` +
                        `**Usage:** \`-join-greet toggle <on|off>\``,
                        0x5865F2
                    )],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            const enabled = state === 'on';
            config[guildId] = { ...config[guildId], enabled };
            saveConfig(config);

            if (enabled && config[guildId]?.voiceChannelId) {
                try {
                    const player = message.client.lavalinkManager.createPlayer({
                        guildId,
                        voiceChannelId: config[guildId].voiceChannelId,
                        textChannelId:  config[guildId].textChannelId || message.channelId,
                        selfDeaf:       true
                    });
                    if (!player.connected) await player.connect();
                } catch {}
            }

            return message.reply({
                components: [panel(
                    `# <:Checkedbox:1521227734943269077> Toggle Updated\n\n` +
                    `Voice greetings are now ${enabled
                        ? '<:Toggleon:1521227758011809964> **Enabled**'
                        : '<:Toggleoff:1521227763816595559> **Disabled**'}.`,
                    enabled ? 0x57F287 : 0xCAD7E6
                )],
                flags: MessageFlags.IsComponentsV2
            });
        }

        // ── status ────────────────────────────────────────────────
        if (action === 'status') {
            const guildConfig = config[guildId];
            if (!guildConfig?.voiceChannelId) {
                return message.reply({
                    components: [panel(
                        `# <:Settings:1521227767780343879> Join Greet Status\n\n` +
                        `**Status:** \`Not configured\`\n\n` +
                        `Use \`-join-greet join\` while inside a voice channel to set it up.`,
                        0xCAD7E6
                    )],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            const vc = message.guild.channels.cache.get(guildConfig.voiceChannelId);
            const player = message.client.lavalinkManager.getPlayer(guildId);
            const connected = !!(player && player.connected);

            const lines = [
                `# <:Settings:1521227767780343879> Join Greet Status`,
                ``,
                `**Channel:** ${vc || '`Deleted Channel`'}`,
                `**Enabled:** ${guildConfig.enabled
                    ? '<:Toggleon:1521227758011809964> Yes'
                    : '<:Toggleoff:1521227763816595559> No'}`,
                `**Bot Connected:** ${connected
                    ? '<:Toggleon:1521227758011809964> Yes'
                    : '<:Toggleoff:1521227763816595559> No'}`
            ];
            if (guildConfig.enabled && !connected) {
                lines.push('', `-# Bot is not connected. Run \`-join-greet join\` to reconnect.`);
            }

            return message.reply({
                components: [panel(lines.join('\n'), 0x5865F2)],
                flags: MessageFlags.IsComponentsV2
            });
        }

        // ── default help ──────────────────────────────────────────
        return message.reply({
            components: [panel(
                `# <:Volumeup:1521228004502536272> Join Greet\n\n` +
                `Greet members automatically when they join or leave a voice channel.\n\n` +
                `### <:Document:1521227875016114266> Commands\n` +
                `> \`-join-greet join\` — set the current VC and connect the bot\n` +
                `> \`-join-greet toggle <on|off>\` — enable or disable greetings\n` +
                `> \`-join-greet leave\` — disconnect the bot\n` +
                `> \`-join-greet status\` — show the current configuration\n\n` +
                `-# Greeting language follows your server's \`-speak-config\` setting.`,
                0x5865F2
            )],
            flags: MessageFlags.IsComponentsV2
        });
    }
};
