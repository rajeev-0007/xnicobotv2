const {
    ContainerBuilder,
    TextDisplayBuilder,
    MessageFlags } = require('discord.js');

const badgeManager = require('../../utils/badgeManager');
const { isOwner } = require('../../utils/helpers');
const { COLORS } = require('../../utils/responseBuilder');

const VALID_HEX = /^#?[0-9a-fA-F]{6}$/;
const VALID_URL = /^https?:\/\/\S+\.\S+/;

function err(title, body) {
    return new ContainerBuilder()
        .setAccentColor(COLORS.ERROR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Cancel:1521227723916181644> ${title}\n\n${body}`
        ));
}

function ok(badge) {
    return new ContainerBuilder()
        .setAccentColor(COLORS.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Checkedbox:1521227734943269077> Badge Updated\n\n` +
            `${badge.emoji} **${badge.name}** \`(${badge.badgeId})\`\n` +
            (badge.description ? `> ${badge.description}\n` : '') +
            `\n-# `
        ));
}

function buildPatch(get) {
    const patch = {};
    const name = get('name');         if (name)        patch.name = String(name).slice(0, 50);
    const emoji = get('emoji');       if (emoji)       patch.emoji = String(emoji).slice(0, 80);
    const description = get('description'); if (description) patch.description = String(description).slice(0, 200);
    const color = get('color');
    if (color) {
        if (!VALID_HEX.test(color)) return { invalid: 'color' };
        patch.color = color.startsWith('#') ? color : `#${color}`;
    }
    const image = get('image');
    if (image) {
        if (!VALID_URL.test(image)) return { invalid: 'image' };
        patch.imageUrl = image;
    }
    const position = get('position');
    if (position != null && position !== '') {
        const n = Number(position);
        if (!Number.isFinite(n)) return { invalid: 'position' };
        patch.position = n;
    }
    return { patch };
}

module.exports = {
    name: 'badge-edit',
    prefix: 'badge-edit',
    aliases: ['editbadge', 'badgeedit'],
    description: 'Owner-only: edit a custom badge.',
    usage: 'badge-edit <badgeId> field=value [field=value ...]',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            return message.reply({ components: [err('Owner Only', 'This command is restricted to bot owners.')], flags: MessageFlags.IsComponentsV2 });
        }
        const id = args.shift();
        if (!id) {
            return message.reply({ components: [err('Usage', '`badge-edit <id> field=value [field=value ...]`\n\nFields: `name`, `emoji`, `description`, `color`, `image`, `position`.\nMulti-word values can use quotes.')], flags: MessageFlags.IsComponentsV2 });
        }

        // Parse `field=value` tokens; preserve quoted values.
        const tokens = args.join(' ').match(/\w+=(?:"[^"]*"|\S+)/g) || [];
        const fields = {};
        for (const tok of tokens) {
            const eq = tok.indexOf('=');
            const k = tok.slice(0, eq).toLowerCase();
            let v = tok.slice(eq + 1);
            if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
            fields[k] = v;
        }

        const { patch, invalid } = buildPatch((name) => fields[name]);
        if (invalid) return message.reply({ components: [err('Invalid Field', `\`${invalid}\` value is not valid.`)], flags: MessageFlags.IsComponentsV2 });
        if (!patch || Object.keys(patch).length === 0) {
            return message.reply({ components: [err('Nothing to Edit', 'Specify at least one `field=value` pair.')], flags: MessageFlags.IsComponentsV2 });
        }

        const result = await badgeManager.editBadge(id, patch);
        if (!result.success) return message.reply({ components: [err('Edit Failed', result.message || 'Could not edit the badge.')], flags: MessageFlags.IsComponentsV2 });
        return message.reply({ components: [ok(result.badge)], flags: MessageFlags.IsComponentsV2 });
    } };
