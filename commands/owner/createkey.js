const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse, COLORS } = require('../../utils/responseBuilder');
const premiumManager = require('../../utils/premiumManager');

module.exports = {
    prefix: 'createkey',
    name: 'createkey',
    description: 'Create a premium key (user or server tier)',
    usage: 'createkey [duration_in_days] [user|server]',
    category: 'owner',
    aliases: ['genkey', 'generatekey', 'createserverkey', 'genserverkey'],
    ownerOnly: true,

    async executePrefix(message, args, _lava, _client) {
        if (!isOwner(message.author.id)) {
            const container = buildErrorResponse('Owner Only', 'This command is restricted to the bot owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

      try {
        // ── Parse args order-independently ───────────────────────────────
        // Accepts `createkey 30 server`, `createkey server 30`, `createkey`,
        // `createkey server`, … so the tier can't be silently dropped by
        // getting the argument order wrong. Also honours the command alias:
        // invoking `createserverkey`/`genserverkey` defaults to a server key.
        const invokedAs = String(message.content || '')
            .trim().split(/\s+/)[0].replace(/^\S*?([a-z-]+)$/i, '$1').toLowerCase();
        let type = /server/.test(invokedAs) ? 'server' : 'user';
        let duration = null;
        let badArg = null;

        for (const raw of args) {
            const arg = String(raw).toLowerCase().trim();
            if (!arg) continue;
            if (arg === 'server' || arg === 'guild' || arg === 's') { type = 'server'; continue; }
            if (arg === 'user' || arg === 'u') { type = 'user'; continue; }
            if (arg === 'permanent' || arg === 'lifetime' || arg === 'perm') { duration = null; continue; }
            const parsed = parseInt(arg, 10);
            if (!isNaN(parsed) && parsed > 0 && String(parsed) === arg) { duration = parsed; continue; }
            badArg = raw;
            break;
        }

        if (badArg !== null) {
            let content = `# <:Key:1521228000467878111> Create Premium Key\n\n`;
            content += `<:Cancel:1521227723916181644> Unrecognised argument: \`${String(badArg).slice(0, 40)}\`\n\n`;
            content += `**Usage:** \`createkey [duration_in_days] [user|server]\`\n\n`;
            content += `### Description\n`;
            content += `> **user** — grants premium to whoever redeems it (\`redeemkey\`)\n`;
            content += `> **server** — grants premium to **everyone** in the server where it is redeemed (\`redeemserverkey\`)\n`;
            content += `> Omit the duration for a permanent key. Tier defaults to **user**.\n\n`;
            content += `**Examples:**\n`;
            content += `\`createkey\` — permanent **user** key\n`;
            content += `\`createkey 30\` — 30-day **user** key\n`;
            content += `\`createkey 30 server\` — 30-day **server** key\n`;
            content += `\`createkey server\` — permanent **server** key\n`;
            content += `\`createserverkey 90\` — 90-day **server** key`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Create the key
        const keyData = premiumManager.createKey(duration, type);

        const createdTs = Math.floor(new Date(keyData.createdAt).getTime() / 1000);
        const expiresTs = Math.floor(new Date(keyData.expiresAt).getTime() / 1000);
        const isServer = keyData.type === 'server';

        let content = `# <:Checkedbox:1521227734943269077> ${isServer ? 'Server' : 'User'} Premium Key Created\n\n`;
        content += `<:Key:1521228000467878111> **Key:** \`${keyData.key}\`\n`;
        content += `${isServer ? '<:Server:1521228371051413546>' : '<:User:1521227714227343380>'} **Tier:** ${isServer ? '**Server** — unlocks premium for every member' : '**User** — unlocks premium for one person'}\n`;
        content += `<:Bookopen:1521227911137595605> **Created:** <t:${createdTs}:R>\n`;
        content += `<:Alarm:1521227869047750689> **Key Expires:** <t:${expiresTs}:R> (must be redeemed within 24h)\n`;
        content += `<:Timer:1521227971590095070> **Premium Duration:** ${duration ? `${duration} day${duration === 1 ? '' : 's'}` : 'Permanent'}\n`;
        content += `<:Invoice:1521227903956811836> **Status:** Unused\n\n`;
        content += isServer
            ? `> A user with **Manage Server** redeems this with \`redeemserverkey ${keyData.key}\`.`
            : `> Users can redeem this key using the \`redeemkey\` command.`;

        const container = new ContainerBuilder()
            .setAccentColor(COLORS.SUCCESS)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      } catch (error) {
        console.error('[CreateKey] Error:', error);
        const container = buildErrorResponse('Error', 'An error occurred while creating the key.');
        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      }
    }
};
