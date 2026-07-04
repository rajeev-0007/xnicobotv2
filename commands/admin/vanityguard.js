const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { COLORS } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');
const jsonStore = require('../../utils/jsonStore');

function loadConfig() {
    if (!jsonStore.has('vanityguard')) {
        jsonStore.write('vanityguard', {});
        return {};
    }
    return jsonStore.read('vanityguard');
}

function saveConfig(config) {
    jsonStore.write('vanityguard', config);
}

function getDefault() {
    return {
        enabled: false,
        whitelistedUsers: [],
        logChannelId: null,
        action: 'none' // 'none' | 'kick' | 'ban'
    };
}

function buildPanel(guildConfig, guildName) {
    const wlCount = guildConfig.whitelistedUsers?.length || 0;
    const wlDisplay = wlCount > 0
        ? guildConfig.whitelistedUsers.slice(0, 5).map(id => `<@${id}>`).join(', ') + (wlCount > 5 ? ` +${wlCount - 5} more` : '')
        : '*None*';

    const statusEmoji = guildConfig.enabled
        ? '<:Toggleon:1521227758011809964>'
        : '<:Toggleoff:1521227763816595559>';
    const statusText = guildConfig.enabled
        ? '**Active** — Vanity URL is protected'
        : '**Inactive** — Vanity URL is not protected';
    const logChDisplay = guildConfig.logChannelId ? `<#${guildConfig.logChannelId}>` : '*Not set*';
    const actionDisplay = (guildConfig.action || 'none') === 'none'
        ? 'Revert only'
        : (guildConfig.action === 'kick' ? 'Revert + Kick' : 'Revert + Ban');

    const content =
        `# <:Shield:1521227694677692467> Vanity Guard\n` +
        `-# Protect your server's vanity URL for **${guildName}**\n\n` +
        `${statusEmoji} ${statusText}\n` +
        `<:Document:1521227875016114266> **Log channel:** ${logChDisplay}\n` +
        `<:Lightningalt:1521227851796447472> **Action on violation:** ${actionDisplay}\n\n` +
        `### What Vanity Guard Does\n` +
        `<:Caretright:1521227704953864202> Monitors vanity URL changes via guildUpdate + audit log\n` +
        `<:Caretright:1521227704953864202> Reverts unauthorized changes (boost tier 3 required)\n` +
        `<:Caretright:1521227704953864202> Optionally kicks/bans the offender\n` +
        `<:Caretright:1521227704953864202> Sends an alert to your log channel\n\n` +
        `### <:Userplus:1521227719621218477> Whitelisted Users (${wlCount})\n` +
        `${wlDisplay}\n\n` +
        `### Commands\n` +
        `<:Caretright:1521227704953864202> \`vanityguard enable / disable\`\n` +
        `<:Caretright:1521227704953864202> \`vanityguard wl @user\` — Toggle whitelist\n` +
        `<:Caretright:1521227704953864202> \`vanityguard log #channel\` — Set alert channel\n` +
        `<:Caretright:1521227704953864202> \`vanityguard action none|kick|ban\` — Punishment on violation`;

    const container = new ContainerBuilder()
        .setAccentColor(guildConfig.enabled ? 0x57F287 : 0xED4245);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    return container;
}

module.exports = {
    /**
     * Premium-gated feature. `premiumOnly` is read by the
     * command dispatcher in index.js — non-premium users get a
     * polite message instead of execution.
     */
    premiumOnly: true,

    name: 'vanityguard',
    prefix: 'vanityguard',
    description: 'Protect your server vanity URL from unauthorized changes',
    usage: 'vanityguard [enable|disable|wl @user]',
    category: 'admin',
    aliases: ['vguard', 'vanityprotect'],
    prefixOnly: true,

    async executePrefix(message, args) {
        if (!trust.isServerOwner(message.guild, message.author.id)) {
            return message.reply(require('../../utils/adminUI').errReply('Not Allowed', 'Only the **server owner** or **extra owner** can use this command.'));
        }

        const config = loadConfig();
        const guildId = message.guild.id;
        if (!config[guildId]) config[guildId] = getDefault();
        const guildConfig = config[guildId];

        const sub = args[0]?.toLowerCase();

        if (!sub) {
            const panel = buildPanel(guildConfig, message.guild.name);
            return message.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'enable') {
            if (guildConfig.enabled) {
                return message.reply(require('../../utils/adminUI').errReply('Already Enabled', 'Vanity Guard is already **enabled**.'));
            }
            guildConfig.enabled = true;
            saveConfig(config);

            const container = new ContainerBuilder()
                .setAccentColor(0x57F287)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Toggleon:1521227758011809964> Vanity Guard Enabled\n\n` +
                    `Your server's vanity URL is now protected.\n` +
                    `Only whitelisted users can change it.\n\n` +
                    `-# Use \`vanityguard wl @user\` to whitelist users`
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'disable') {
            if (!guildConfig.enabled) {
                return message.reply(require('../../utils/adminUI').errReply('Already Disabled', 'Vanity Guard is already **disabled**.'));
            }
            guildConfig.enabled = false;
            saveConfig(config);

            const container = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Toggleoff:1521227763816595559> Vanity Guard Disabled\n\n` +
                    `Vanity URL protection has been turned off.\n` +
                    `Anyone with \`MANAGE_GUILD\` can now change the vanity.`
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'wl') {
            const user = message.mentions.users.first();
            if (!user) {
                return message.reply(require('../../utils/adminUI').errReply('Missing User', 'Mention a user to toggle their vanity guard whitelist status.', { hint: 'Usage: `vanityguard wl @user`' }));
            }

            if (!guildConfig.whitelistedUsers) guildConfig.whitelistedUsers = [];

            if (guildConfig.whitelistedUsers.includes(user.id)) {
                guildConfig.whitelistedUsers = guildConfig.whitelistedUsers.filter(id => id !== user.id);
                saveConfig(config);

                const container = new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Vanity Whitelist Removed\n\n` +
                        `**User:** ${user} (\`${user.id}\`)\n\n` +
                        `> This user can no longer change the vanity URL.`
                    ));
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } else {
                guildConfig.whitelistedUsers.push(user.id);
                saveConfig(config);

                const container = new ContainerBuilder()
                    .setAccentColor(0x57F287)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Vanity Whitelist Added\n\n` +
                        `**User:** ${user} (\`${user.id}\`)\n\n` +
                        `> This user is now allowed to change the vanity URL.`
                    ));
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
        }

        if (sub === 'log') {
            const channel = message.mentions.channels.first();
            if (!channel) {
                guildConfig.logChannelId = null;
                saveConfig(config);
                return message.reply('<:Checkedbox:1521227734943269077> Vanity Guard log channel cleared.');
            }
            guildConfig.logChannelId = channel.id;
            saveConfig(config);
            return message.reply(`<:Checkedbox:1521227734943269077> Vanity Guard alerts will be sent to ${channel}.`);
        }

        if (sub === 'action') {
            const choice = (args[1] || '').toLowerCase();
            if (!['none', 'kick', 'ban'].includes(choice)) {
                return message.reply(require('../../utils/adminUI').errReply('Invalid Action', 'Action must be one of: `none`, `kick`, `ban`.'));
            }
            guildConfig.action = choice;
            saveConfig(config);
            return message.reply(`<:Checkedbox:1521227734943269077> Action set to **${choice}**.`);
        }

        const panel = buildPanel(guildConfig, message.guild.name);
        return message.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
    }
};
