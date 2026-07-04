'use strict';

const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags,
    ContainerBuilder, TextDisplayBuilder,
} = require('discord.js');
const { buildErrorResponse, buildPermissionDenied, COLORS } = require('../../utils/responseBuilder');
const mc = require('../../utils/minecraftMonitor');
const bridge = require('../../utils/minecraftBridge');

const E = {
    ok: '<:Checkedbox:1521227734943269077>',
    arrow: '<:Caretright:1521227704953864202>',
    load: '<a:Loading:1521227993995940032>',
    info: '<:Inforect:1521228008285929532>',
    trash: '<:Trash:1521227750420254820>',
};

function infoContainer(title, body, color = COLORS.SUCCESS) {
    return new ContainerBuilder().setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}\n\n${body}`));
}

/* Shared handlers (ctx-agnostic) */

async function doStatus(host, edition, reply) {
    let status;
    try { status = await mc.fetchStatus(host, edition); }
    catch (e) {
        return reply({ components: [buildErrorResponse('Lookup Failed', `Could not reach **${host}**.`, e.message)], flags: MessageFlags.IsComponentsV2 });
    }
    const { components, files } = mc.buildStatusPanel(status, { edition });
    return reply({ components, files, flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('minecraft')
        .setDescription('Minecraft server status & live monitoring')
        .addSubcommand(s => s.setName('status').setDescription('Check a Minecraft server status')
            .addStringOption(o => o.setName('host').setDescription('Server address (e.g. play.hypixel.net)').setRequired(true))
            .addStringOption(o => o.setName('edition').setDescription('Java or Bedrock')
                .addChoices({ name: 'Java', value: 'java' }, { name: 'Bedrock', value: 'bedrock' })))
        .addSubcommand(s => s.setName('monitor').setDescription('Set up a live auto-updating status panel')
            .addStringOption(o => o.setName('host').setDescription('Server address').setRequired(true))
            .addChannelOption(o => o.setName('channel').setDescription('Channel for the live panel (defaults to here)'))
            .addStringOption(o => o.setName('edition').setDescription('Java or Bedrock')
                .addChoices({ name: 'Java', value: 'java' }, { name: 'Bedrock', value: 'bedrock' }))
            .addIntegerOption(o => o.setName('interval').setDescription(`Update interval in minutes (min ${mc.MIN_INTERVAL_MIN})`).setMinValue(mc.MIN_INTERVAL_MIN).setMaxValue(60)))
        .addSubcommand(s => s.setName('config').setDescription('Customize the monitor panel')
            .addBooleanOption(o => o.setName('show_players').setDescription('Show the online player list'))
            .addStringOption(o => o.setName('color').setDescription('Accent color hex (e.g. #5865F2, or "auto")')))
        .addSubcommand(s => s.setName('remove').setDescription('Stop monitoring and remove the panel'))
        .addSubcommandGroup(g => g.setName('bridge').setDescription('Two-way Discord ↔ Minecraft chat bridge')
            .addSubcommand(s => s.setName('setup').setDescription('Link a channel to the server chat (read + send)')
                .addStringOption(o => o.setName('host').setDescription('Server address').setRequired(true))
                .addChannelOption(o => o.setName('channel').setDescription('Bridge channel (defaults to here)'))
                .addIntegerOption(o => o.setName('port').setDescription('Server port (default 25565)'))
                .addStringOption(o => o.setName('auth').setDescription('offline (cracked) or microsoft (premium)')
                    .addChoices({ name: 'Offline / cracked', value: 'offline' }, { name: 'Microsoft / premium', value: 'microsoft' }))
                .addStringOption(o => o.setName('username').setDescription('Bot username (offline) or account email (microsoft)'))
                .addBooleanOption(o => o.setName('join_leave').setDescription('Also relay join/leave messages')))
            .addSubcommand(s => s.setName('stop').setDescription('Stop and unlink the chat bridge'))
            .addSubcommand(s => s.setName('status').setDescription('Show the bridge connection status')))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    prefix: 'minecraft',
    description: 'Minecraft server status & live monitoring (status/monitor/config/remove)',
    usage: 'minecraft <status|monitor|config|remove> [host] [#channel]',
    category: 'admin',
    aliases: ['mc', 'mcstatus'],

    async execute(interaction) {
        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand();
        const reply = (payload) => interaction.editReply(payload);
        await interaction.deferReply();

        // ── Chat bridge group ──
        if (group === 'bridge') {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return reply({ components: [buildPermissionDenied('Manage Server')], flags: MessageFlags.IsComponentsV2 });
            }
            if (sub === 'setup') {
                const host = interaction.options.getString('host');
                const channel = interaction.options.getChannel('channel') || interaction.channel;
                const port = interaction.options.getInteger('port') || 25565;
                const auth = interaction.options.getString('auth') || 'offline';
                const username = interaction.options.getString('username') || 'DiscordBridge';
                const relayJoinLeave = interaction.options.getBoolean('join_leave') || false;
                bridge.saveBridgeConfig(interaction.guild.id, { enabled: true, host, port, auth, username, channelId: channel.id, relayJoinLeave });
                const res = await bridge.startBridge(interaction.client, interaction.guild.id);
                if (!res.ok) {
                    return reply({ components: [buildErrorResponse('Bridge Failed to Start', res.error)], flags: MessageFlags.IsComponentsV2 });
                }
                const note = auth === 'microsoft'
                    ? '\n\n-# Microsoft auth: check the **bot console** for a one-time login code on first connect.'
                    : '';
                return reply({ components: [infoContainer(`${E.ok} Chat Bridge Linked`, `${channel} is now bridged to **${host}:${port}** (${auth}).\n${E.arrow} Server chat appears here; messages you send here go in-game.${note}`)], flags: MessageFlags.IsComponentsV2 });
            }
            if (sub === 'stop') {
                bridge.stopBridge(interaction.guild.id);
                return reply({ components: [infoContainer(`${E.trash} Bridge Stopped`, 'The chat bridge has been unlinked.', COLORS.ERROR)], flags: MessageFlags.IsComponentsV2 });
            }
            if (sub === 'status') {
                const cfg = bridge.getBridgeConfig(interaction.guild.id);
                const st = bridge.getStatus(interaction.guild.id);
                if (!cfg?.enabled) return reply({ components: [infoContainer(`${E.info} Bridge Off`, 'No chat bridge is configured. Use `/minecraft bridge setup`.', COLORS.WARNING)], flags: MessageFlags.IsComponentsV2 });
                return reply({ components: [infoContainer(`${E.arrow} Bridge Status`, `${E.arrow} **Server:** ${cfg.host}:${cfg.port || 25565}\n${E.arrow} **Channel:** <#${cfg.channelId}>\n${E.arrow} **Auth:** ${cfg.auth}\n${E.arrow} **State:** \`${st}\``)], flags: MessageFlags.IsComponentsV2 });
            }
            return;
        }

        if (sub === 'status') {
            return doStatus(interaction.options.getString('host'), interaction.options.getString('edition') || 'java', reply);
        }

        // Mutating subcommands require Manage Server.
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return reply({ components: [buildPermissionDenied('Manage Server')], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'monitor') {
            const host = interaction.options.getString('host');
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            const edition = interaction.options.getString('edition') || 'java';
            const intervalMin = interaction.options.getInteger('interval') || mc.DEFAULT_INTERVAL_MIN;
            mc.saveConfig(interaction.guild.id, { enabled: true, host, channelId: channel.id, edition, intervalMin, messageId: null, setBy: interaction.user.id });
            await mc.updateGuildMonitor(interaction.client, interaction.guild.id, mc.getConfig(interaction.guild.id));
            return reply({ components: [infoContainer(`${E.ok} Monitoring Enabled`, `Live status for **${host}** (${edition}) will update in ${channel} every **${intervalMin}m**.`)], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'config') {
            const cfg = mc.getConfig(interaction.guild.id);
            if (!cfg) return reply({ components: [buildErrorResponse('Not Monitoring', 'Set up monitoring first with `/minecraft monitor`.')], flags: MessageFlags.IsComponentsV2 });
            const patch = {};
            const showPlayers = interaction.options.getBoolean('show_players');
            if (showPlayers !== null) patch.showPlayers = showPlayers;
            const color = interaction.options.getString('color');
            if (color !== null) {
                if (/^auto$/i.test(color)) patch.color = null;
                else { const m = /^#?([0-9a-f]{6})$/i.exec(color.trim()); if (m) patch.color = parseInt(m[1], 16); }
            }
            mc.saveConfig(interaction.guild.id, patch);
            await mc.updateGuildMonitor(interaction.client, interaction.guild.id, mc.getConfig(interaction.guild.id));
            return reply({ components: [infoContainer(`${E.ok} Monitor Updated`, 'Panel customization saved.')], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'remove') {
            const ok = mc.removeConfig(interaction.guild.id);
            return reply({ components: [infoContainer(ok ? `${E.trash} Monitoring Removed` : `${E.info} Nothing to Remove`, ok ? 'The live status panel will no longer update.' : 'No Minecraft monitor was configured.', ok ? COLORS.ERROR : COLORS.WARNING)], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        const sub = (args[0] || 'status').toLowerCase();
        const reply = (payload) => message.reply(payload);

        if (sub === 'status' || /^[\w.\-:]+\.[\w]{2,}/.test(sub)) {
            // `mc status <host>` or `mc <host>`
            const host = (sub === 'status') ? args[1] : args[0];
            if (!host) return reply({ components: [buildErrorResponse('Missing Host', 'Provide a server address.', 'Usage: `mc status play.hypixel.net`')], flags: MessageFlags.IsComponentsV2 });
            const edition = (args.includes('bedrock')) ? 'bedrock' : 'java';
            return doStatus(host, edition, reply);
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return reply({ components: [buildPermissionDenied('Manage Server')], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'bridge') {
            const action = (args[1] || 'status').toLowerCase();
            if (action === 'setup' || action === 'link') {
                const host = args[2];
                if (!host) return reply({ components: [buildErrorResponse('Missing Host', 'Provide a server address.', 'Usage: `mc bridge setup play.example.com [#channel] [offline|microsoft] [username]`')], flags: MessageFlags.IsComponentsV2 });
                const channel = message.mentions.channels.first() || message.channel;
                const auth = args.includes('microsoft') ? 'microsoft' : 'offline';
                const username = args.find(a => /^[A-Za-z0-9_@.\-]{3,}$/.test(a) && a !== host && a !== 'offline' && a !== 'microsoft' && !/^<#/.test(a)) || 'DiscordBridge';
                bridge.saveBridgeConfig(message.guild.id, { enabled: true, host, port: 25565, auth, username, channelId: channel.id });
                const res = await bridge.startBridge(message.client, message.guild.id);
                if (!res.ok) return reply({ components: [buildErrorResponse('Bridge Failed to Start', res.error)], flags: MessageFlags.IsComponentsV2 });
                return reply({ components: [infoContainer(`${E.ok} Chat Bridge Linked`, `${channel} is now bridged to **${host}** (${auth}). Server chat appears here; messages here go in-game.`)], flags: MessageFlags.IsComponentsV2 });
            }
            if (action === 'stop' || action === 'unlink') {
                bridge.stopBridge(message.guild.id);
                return reply({ components: [infoContainer(`${E.trash} Bridge Stopped`, 'The chat bridge has been unlinked.', COLORS.ERROR)], flags: MessageFlags.IsComponentsV2 });
            }
            const cfg = bridge.getBridgeConfig(message.guild.id);
            const st = bridge.getStatus(message.guild.id);
            if (!cfg?.enabled) return reply({ components: [infoContainer(`${E.info} Bridge Off`, 'No chat bridge configured. Use `mc bridge setup <host>`.', COLORS.WARNING)], flags: MessageFlags.IsComponentsV2 });
            return reply({ components: [infoContainer(`${E.arrow} Bridge Status`, `${E.arrow} **Server:** ${cfg.host}:${cfg.port || 25565}\n${E.arrow} **Channel:** <#${cfg.channelId}>\n${E.arrow} **State:** \`${st}\``)], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'monitor') {
            const host = args[1];
            if (!host) return reply({ components: [buildErrorResponse('Missing Host', 'Provide a server address.', 'Usage: `mc monitor play.hypixel.net [#channel] [java|bedrock]`')], flags: MessageFlags.IsComponentsV2 });
            const channel = message.mentions.channels.first() || message.channel;
            const edition = args.includes('bedrock') ? 'bedrock' : 'java';
            const intervalArg = args.find(a => /^\d+$/.test(a));
            const intervalMin = intervalArg ? Math.min(60, Math.max(mc.MIN_INTERVAL_MIN, parseInt(intervalArg, 10))) : mc.DEFAULT_INTERVAL_MIN;
            mc.saveConfig(message.guild.id, { enabled: true, host, channelId: channel.id, edition, intervalMin, messageId: null, setBy: message.author.id });
            await mc.updateGuildMonitor(message.client, message.guild.id, mc.getConfig(message.guild.id));
            return reply({ components: [infoContainer(`${E.ok} Monitoring Enabled`, `Live status for **${host}** (${edition}) will update in ${channel} every **${intervalMin}m**.`)], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'remove' || sub === 'stop') {
            const ok = mc.removeConfig(message.guild.id);
            return reply({ components: [infoContainer(ok ? `${E.trash} Monitoring Removed` : `${E.info} Nothing to Remove`, ok ? 'The live status panel will no longer update.' : 'No Minecraft monitor was configured.', ok ? COLORS.ERROR : COLORS.WARNING)], flags: MessageFlags.IsComponentsV2 });
        }

        return reply({ components: [buildErrorResponse('Unknown Option', `\`${sub}\` is not valid.`, 'Use: `status`, `monitor`, `remove`')], flags: MessageFlags.IsComponentsV2 });
    },
};
