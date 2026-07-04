'use strict';

/**
 * Custom Shop System — Server admins create custom items with automated actions.
 *
 * Integrates with the per-guild custom currency system (economy-settings).
 * Items execute actions on purchase: give_role, remove_role, send_dm, add_coins, custom_reply.
 */

const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags,
    ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
    SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const jsonStore = require('../../utils/jsonStore');
const economyManager = require('../../utils/economyManager');
const { getEconomySettings, getCurrency, getCurrencyName, formatCoinsShort, formatCoins, coinIcon } = require('../../utils/currencyHelper');
const { buildSafeListText } = require('../../utils/componentHelpers');

const STORE = 'custom-shop';

// ── Emojis ───────────────────────────────────────────────────────────────
const E = {
    shop:     '<:Folder:1521228095225331765>',
    coin:     '<:Money:1521228266957045900>',
    check:    '<:Checkedbox:1521227734943269077>',
    cancel:   '<:Cancel:1521227723916181644>',
    add:      '<:Add:1521227828199293152>',
    trash:    '<:Trash:1521227750420254820>',
    edit:     '<:Editalt:1521227921673556019>',
    star:     '<:Star:1521227981685526568>',
    cart:     '<:Attach:1521228039135170722>',
    info:     '<:Inforect:1521228008285929532>',
    role:     '<:Shield:1521227694677692467>',
    dm:       '<:Envelope:1521228013910626426>',
    fire:     '<:Fire:1521227907647668374>',
    settings: '<:Settings:1521227767780343879>',
    lightning:'<:Lightning:1521227915537285150>',
    document: '<:Document:1521227875016114266>',
    user:     '<:User:1521227714227343380>',
    clock:    '<:Clock:1521228110408847623>',
};

const ACTION_LABELS = {
    give_role:    { emoji: E.role, label: 'Give Role' },
    remove_role:  { emoji: E.role, label: 'Remove Role' },
    send_dm:      { emoji: E.dm, label: 'Send DM' },
    add_coins:    { emoji: E.coin, label: 'Bonus Coins' },
    custom_reply: { emoji: E.fire, label: 'Custom Reply' },
};

// ── Storage ──────────────────────────────────────────────────────────────

function getShop(guildId) {
    const all = jsonStore.peek(STORE) || {};
    return all[guildId] || { items: [] };
}

function saveShop(guildId, shop) {
    const all = jsonStore.read(STORE) || {};
    all[guildId] = shop;
    jsonStore.write(STORE, all);
}

// ── Card Builders ────────────────────────────────────────────────────────

function buildShopPanel(guild, shop, guildId) {
    const items = shop.items || [];
    const currency = getCurrency(guildId);
    const currencyName = getCurrencyName(guildId);

    const container = new ContainerBuilder().setAccentColor(0xFBBF24);

    // Header
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ${E.shop} ${guild.name} Custom Shop\n` +
        `-# ${items.length} item${items.length !== 1 ? 's' : ''} · Currency: ${currency} ${currencyName}`
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    if (items.length === 0) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `${E.info} **No items in the shop yet.**\n\n` +
            `### ${E.settings} Admin Setup\n` +
            `> \`/customshop add\` — Add a new item\n` +
            `> \`-customshop add <name> <price> <action> <data>\`\n\n` +
            `### ${E.document} Available Actions\n` +
            `> ${E.role} **give_role** — Assign a role on purchase\n` +
            `> ${E.role} **remove_role** — Remove a role on purchase\n` +
            `> ${E.dm} **send_dm** — DM buyer with custom text\n` +
            `> ${E.coin} **add_coins** — Give bonus coins\n` +
            `> ${E.fire} **custom_reply** — Send custom message in channel`
        ));
    } else {
        // Build the items list as separate lines, then trim to fit Discord's
        // 4 000-char per-TextDisplay limit. With 25 items × ~250 chars each,
        // the naive concat would exceed the cap and Discord would reject the
        // whole panel — buildSafeListText drops overflow with a "+N more" hint.
        const lineEntries = items.map((item, i) => {
            const actionInfo = ACTION_LABELS[item.action] || { emoji: E.star, label: item.action };
            let line = `**${i + 1}.** ${E.star} **${item.name}**\n`;
            line += `> ${currency} \`${item.price.toLocaleString()}\` ${currencyName} · ${actionInfo.emoji} ${actionInfo.label}`;
            if (item.description) line += `\n> -# ${item.description}`;
            return line;
        });
        const { content: itemList } = buildSafeListText({
            header: `### ${E.cart} Available Items`,
            lines: lineEntries,
            separator: '\n\n',
            overflowHint: '\n\n-# +${n} more not shown — use the Buy menu to purchase any item',
        });
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(itemList));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# ${E.cart} \`/customshop buy <item>\` to purchase · ${E.settings} Admins: \`/customshop add\` · \`/customshop remove\``
    ));

    // Add buy select menu if items exist
    if (items.length > 0 && items.length <= 25) {
        const select = new StringSelectMenuBuilder()
            .setCustomId('cshop_buy_select')
            .setPlaceholder(`${items.length} items available — select to buy`)
            .addOptions(items.map((item, i) => ({
                label: `${item.name} — ${item.price.toLocaleString()} ${currencyName}`,
                value: String(i),
                emoji: E.star,
                description: (ACTION_LABELS[item.action]?.label || item.action).slice(0, 50)
            })));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
    }

    return container;
}

function buildPurchaseResult(item, userData, results, guildId) {
    const currency = getCurrency(guildId);
    const currencyName = getCurrencyName(guildId);

    return new ContainerBuilder().setAccentColor(0x57F287)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## ${E.check} Purchase Successful!\n\n` +
            `${E.star} **Item:** ${item.name}\n` +
            `${coinIcon(guildId)} **Cost:** ${currency} ${item.price.toLocaleString()} ${currencyName}\n` +
            `${E.lightning} **Balance:** ${currency} ${userData.coins.toLocaleString()} ${currencyName}`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### ${E.fire} Effects\n${results.map(r => `> ${r}`).join('\n')}`
        ));
}

// ── Action Executor ──────────────────────────────────────────────────────

async function executeAction(member, item, guild, guildId) {
    const results = [];

    switch (item.action) {
        case 'give_role': {
            const role = guild.roles.cache.get(item.actionData);
            if (role) {
                await member.roles.add(role).catch(() => results.push(`${E.cancel} Failed to add role`));
                if (!results.length) results.push(`${E.role} Received role **${role.name}**`);
            } else results.push(`${E.cancel} Role not found`);
            break;
        }
        case 'remove_role': {
            const role = guild.roles.cache.get(item.actionData);
            if (role) {
                await member.roles.remove(role).catch(() => results.push(`${E.cancel} Failed to remove role`));
                if (!results.length) results.push(`${E.role} Removed role **${role.name}**`);
            } else results.push(`${E.cancel} Role not found`);
            break;
        }
        case 'send_dm': {
            try {
                await member.user.send(item.actionData || 'Thank you for your purchase!');
                results.push(`${E.dm} DM sent successfully`);
            } catch { results.push(`${E.cancel} Could not DM (DMs disabled)`); }
            break;
        }
        case 'add_coins': {
            const bonus = parseInt(item.actionData) || 0;
            if (bonus > 0) {
                const economy = economyManager.loadEconomy();
                const { userData } = economyManager.getUser(economy, member.id);
                userData.coins += bonus;
                economyManager.saveEconomy(economy);
                results.push(`${coinIcon(guildId)} Received **${bonus.toLocaleString()}** bonus ${getCurrencyName(guildId)}`);
            }
            break;
        }
        case 'custom_reply': {
            results.push(item.actionData || `${E.check} Item purchased!`);
            break;
        }
        default:
            results.push(`${E.check} Item purchased`);
    }

    return results;
}

// ── Buy logic (shared between slash, prefix, and select menu) ────────────

async function processBuy(userId, guildId, guild, itemIndex, reply) {
    const shop = getShop(guildId);
    const item = shop.items[itemIndex];
    if (!item) return reply({ content: `${E.cancel} Item not found.`, flags: MessageFlags.Ephemeral });

    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, userId);
    const currency = getCurrency(guildId);
    const currencyName = getCurrencyName(guildId);

    if (userData.coins < item.price) {
        return reply({
            content: `${E.cancel} You need ${currency} **${item.price.toLocaleString()}** ${currencyName} but only have ${currency} **${userData.coins.toLocaleString()}**.`,
            flags: MessageFlags.Ephemeral
        });
    }

    /* ── Pre-flight: validate the action BEFORE deducting coins ──
     * Without this, a deleted role or malformed action data would
     * still charge the user. We do the cheap, side-effect-free
     * checks up front and refuse the sale if the configured action
     * cannot complete cleanly. */
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
        return reply({
            content: `${E.cancel} Could not resolve your member record. Try again in a moment.`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (item.action === 'give_role' || item.action === 'remove_role') {
        const role = guild.roles.cache.get(item.actionData);
        if (!role) {
            return reply({
                content: `${E.cancel} This shop item references a role that no longer exists. Ask an admin to remove or fix it before purchasing.`,
                flags: MessageFlags.Ephemeral
            });
        }
        // Bot must be able to manage roles below its highest role.
        const me = guild.members.me;
        if (!me || !me.permissions.has('ManageRoles') || role.position >= me.roles.highest.position) {
            return reply({
                content: `${E.cancel} I don't have permission to manage **${role.name}**. The role must be below my highest role and I need Manage Roles.`,
                flags: MessageFlags.Ephemeral
            });
        }
    }
    if (item.action === 'add_coins') {
        const bonus = parseInt(item.actionData);
        if (!Number.isFinite(bonus) || bonus <= 0) {
            return reply({
                content: `${E.cancel} This shop item is misconfigured (the bonus payout is invalid). Ask an admin to fix it before purchasing.`,
                flags: MessageFlags.Ephemeral
            });
        }
    }

    userData.coins -= item.price;
    economyManager.saveEconomy(economy);

    let results;
    try {
        results = await executeAction(member, item, guild, guildId);
    } catch (err) {
        // Reverse the charge if the action throws unexpectedly so
        // the user isn't left paying for nothing.
        userData.coins += item.price;
        economyManager.saveEconomy(economy);
        console.error('[CUSTOMSHOP] executeAction failed, refunding:', err);
        return reply({
            content: `${E.cancel} The purchase action failed and your coins were refunded. Please contact an admin if this persists.`,
            flags: MessageFlags.Ephemeral
        });
    }

    const container = buildPurchaseResult(item, userData, results, guildId);
    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

// ── Command Module ───────────────────────────────────────────────────────

module.exports = {
    /**
     * Premium-gated feature. `premiumOnly` is read by the
     * command dispatcher in index.js — non-premium users get a
     * polite message instead of execution.
     */
    premiumOnly: true,

    data: new SlashCommandBuilder()
        .setName('customshop')
        .setDescription('Custom server shop with configurable items and actions')
        .addSubcommand(sub => sub.setName('list').setDescription('View the custom shop'))
        .addSubcommand(sub => sub
            .setName('buy')
            .setDescription('Buy an item from the custom shop')
            .addStringOption(o => o.setName('item').setDescription('Item name or number').setRequired(true)))
        .addSubcommand(sub => sub
            .setName('add')
            .setDescription('Add an item to the shop (Admin)')
            .addStringOption(o => o.setName('name').setDescription('Item name').setRequired(true).setMaxLength(50))
            .addIntegerOption(o => o.setName('price').setDescription('Price').setRequired(true).setMinValue(1))
            .addStringOption(o => o.setName('action').setDescription('Action on purchase').setRequired(true)
                .addChoices(
                    { name: '🛡️ Give Role', value: 'give_role' },
                    { name: '🛡️ Remove Role', value: 'remove_role' },
                    { name: '📩 Send DM', value: 'send_dm' },
                    { name: '<:Money:1521228266957045900> Add Coins', value: 'add_coins' },
                    { name: '💬 Custom Reply', value: 'custom_reply' }
                ))
            .addStringOption(o => o.setName('data').setDescription('Role ID, DM text, coin amount, or reply text').setRequired(true))
            .addStringOption(o => o.setName('description').setDescription('Short description shown in shop').setRequired(false).setMaxLength(100)))
        .addSubcommand(sub => sub
            .setName('remove')
            .setDescription('Remove an item from the shop (Admin)')
            .addStringOption(o => o.setName('item').setDescription('Item name or number').setRequired(true))),

    prefix: 'customshop',
    description: 'Custom server shop with configurable items',
    usage: 'customshop [list|buy|add|remove]',
    category: 'economy',
    aliases: ['cshop', 'servershop', 'guildshop'],

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        const shop = getShop(guildId);

        if (sub === 'list') {
            const panel = buildShopPanel(interaction.guild, shop, guildId);
            return interaction.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'buy') {
            const input = interaction.options.getString('item');
            const idx = parseInt(input) - 1;
            const itemIdx = (idx >= 0 && idx < shop.items.length) ? idx : shop.items.findIndex(i => i.name.toLowerCase() === input.toLowerCase());
            if (itemIdx < 0) return interaction.reply({ content: `${E.cancel} Item not found. Use \`/customshop list\`.`, flags: MessageFlags.Ephemeral });
            return processBuy(interaction.user.id, guildId, interaction.guild, itemIdx, (opts) => interaction.reply(opts));
        }

        if (sub === 'add') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.reply({ content: `${E.cancel} You need **Manage Server** permission.`, flags: MessageFlags.Ephemeral });
            }
            if (shop.items.length >= 25) return interaction.reply({ content: `${E.cancel} Maximum 25 items per shop.`, flags: MessageFlags.Ephemeral });

            const name = interaction.options.getString('name');
            const price = interaction.options.getInteger('price');
            const action = interaction.options.getString('action');
            const data = interaction.options.getString('data');
            const description = interaction.options.getString('description') || '';

            if (shop.items.some(i => i.name.toLowerCase() === name.toLowerCase())) {
                return interaction.reply({ content: `${E.cancel} An item named **${name}** already exists.`, flags: MessageFlags.Ephemeral });
            }

            shop.items.push({ name, price, action, actionData: data, description, createdBy: interaction.user.id, createdAt: Date.now() });
            saveShop(guildId, shop);

            const actionInfo = ACTION_LABELS[action] || { emoji: E.star, label: action };
            return interaction.reply({
                content: `${E.check} Added **${name}** to the shop!\n> ${getCurrency(guildId)} ${price.toLocaleString()} · ${actionInfo.emoji} ${actionInfo.label}`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (sub === 'remove') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.reply({ content: `${E.cancel} You need **Manage Server** permission.`, flags: MessageFlags.Ephemeral });
            }
            const input = interaction.options.getString('item');
            const idx = parseInt(input) - 1;
            const itemIdx = (idx >= 0 && idx < shop.items.length) ? idx : shop.items.findIndex(i => i.name.toLowerCase() === input.toLowerCase());
            if (itemIdx < 0) return interaction.reply({ content: `${E.cancel} Item not found.`, flags: MessageFlags.Ephemeral });

            const removed = shop.items.splice(itemIdx, 1)[0];
            saveShop(guildId, shop);
            return interaction.reply({ content: `${E.trash} Removed **${removed.name}** from the shop.`, flags: MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message, args) {
        const sub = args[0]?.toLowerCase();
        const guildId = message.guild.id;
        const shop = getShop(guildId);

        if (!sub || sub === 'list' || sub === 'view') {
            const panel = buildShopPanel(message.guild, shop, guildId);
            return message.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'buy') {
            const input = args.slice(1).join(' ');
            if (!input) return message.reply(`${E.cancel} Usage: \`-customshop buy <item name or number>\``);
            const idx = parseInt(input) - 1;
            const itemIdx = (idx >= 0 && shop.items[idx]) ? idx : shop.items.findIndex(i => i.name.toLowerCase() === input.toLowerCase());
            if (itemIdx < 0) return message.reply(`${E.cancel} Item not found. Use \`-customshop list\`.`);
            return processBuy(message.author.id, guildId, message.guild, itemIdx, (opts) => message.reply(opts));
        }

        if (sub === 'add') {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return message.reply(`${E.cancel} You need **Manage Server** permission.`);
            }
            // -customshop add <name> <price> <action> [data...]
            const name = args[1];
            const price = parseInt(args[2]);
            const action = args[3];
            const data = args.slice(4).join(' ');

            if (!name || !price || !action) {
                return message.reply(
                    `${E.cancel} **Usage:** \`-customshop add <name> <price> <action> <data>\`\n\n` +
                    `**Actions:** \`give_role\`, \`remove_role\`, \`send_dm\`, \`add_coins\`, \`custom_reply\`\n` +
                    `**Example:** \`-customshop add VIP 5000 give_role 123456789\``
                );
            }
            if (shop.items.length >= 25) return message.reply(`${E.cancel} Maximum 25 items.`);
            if (shop.items.some(i => i.name.toLowerCase() === name.toLowerCase())) {
                return message.reply(`${E.cancel} Item **${name}** already exists.`);
            }

            shop.items.push({ name, price, action, actionData: data || '', description: '', createdBy: message.author.id, createdAt: Date.now() });
            saveShop(guildId, shop);
            return message.reply(`${E.check} Added **${name}** for ${getCurrency(guildId)} ${price.toLocaleString()} (${action})`);
        }

        if (sub === 'remove' || sub === 'delete') {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return message.reply(`${E.cancel} You need **Manage Server** permission.`);
            }
            const input = args.slice(1).join(' ');
            const idx = parseInt(input) - 1;
            const itemIdx = (idx >= 0 && idx < shop.items.length) ? idx : shop.items.findIndex(i => i.name.toLowerCase() === input.toLowerCase());
            if (itemIdx < 0) return message.reply(`${E.cancel} Item not found.`);
            const removed = shop.items.splice(itemIdx, 1)[0];
            saveShop(guildId, shop);
            return message.reply(`${E.trash} Removed **${removed.name}**.`);
        }

        // Unknown — show shop
        const panel = buildShopPanel(message.guild, shop, guildId);
        return message.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
    },

    // ── Select Menu Handler (buy from dropdown) ──────────────────────────

    async handleSelectMenu(interaction) {
        if (interaction.customId !== 'cshop_buy_select') return false;

        // Re-validate premium on every panel interaction. The dispatcher
        // only enforces `premiumOnly` at COMMAND ENTRY, not on stray
        // component interactions, so without this check anyone could
        // press the "Buy" dropdown on an old panel after the server's
        // premium expired.
        const { requirePremium } = require('../../utils/interactionGuards');
        if (await requirePremium(interaction, { commandName: '/customshop buy' })) return true;

        const idx = parseInt(interaction.values[0]);
        if (isNaN(idx)) return false;
        return processBuy(interaction.user.id, interaction.guild.id, interaction.guild, idx, (opts) => interaction.reply(opts), interaction.guild?.id);
    }
};
