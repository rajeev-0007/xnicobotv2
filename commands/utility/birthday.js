'use strict';

/**
 * /birthday  (slash + prefix)
 * ───────────────────────────
 * User-facing birthday commands:
 *   /birthday set <date>            Save / update your birthday for this server
 *   /birthday view [user]           View someone's birthday + days until next
 *   /birthday remove                Delete your birthday from this server
 *   /birthday upcoming              Show the next 10 upcoming birthdays
 *
 * Also exports `handlePanelButton` and `handlePanelModal` so index.js can
 * route the public Set-Birthday panel buttons (`bdaypanel_*`) to this file.
 */

const {
    SlashCommandBuilder,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const birthdayManager = require('../../utils/birthdayManager');

const PANEL_MODAL_ID = 'bdaypanel_modal_set';
const SLASH_MODAL_ID = 'bdaycmd_modal_set';

// ── Helpers ────────────────────────────────────────────────────────────

function daysUntil(entry) {
    if (!entry) return null;
    const now = new Date();
    const target = birthdayManager.getNextBirthday(entry, now);
    if (!target) return null;
    const ms = target.getTime() - now.getTime();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function buildBirthdayModal(customId, existing) {
    const input = new TextInputBuilder()
        .setCustomId('bday_date')
        .setLabel('Birthday (DD-MM or DD-MM-YYYY)')
        .setStyle(TextInputStyle.Short)
        .setMinLength(3)
        .setMaxLength(10)
        .setPlaceholder('e.g. 14-08-2003')
        .setRequired(true);

    // Only prefill when we have a valid stored value. Calling setValue('')
    // while minLength is 3 makes Discord reject the modal with
    // BASE_TYPE_MIN_LENGTH because the prefilled string is too short.
    if (existing && Number.isInteger(existing.day) && Number.isInteger(existing.month)) {
        const dd = String(existing.day).padStart(2, '0');
        const mm = String(existing.month).padStart(2, '0');
        const prefill = existing.year ? `${dd}-${mm}-${existing.year}` : `${dd}-${mm}`;
        input.setValue(prefill);
    }

    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle('Set Your Birthday')
        .addComponents(new ActionRowBuilder().addComponents(input));
}

function buildViewCard(member, entry) {
    const days = daysUntil(entry);
    const age = birthdayManager.calculateAge(entry);
    const pretty = birthdayManager.formatBirthday(entry);

    const container = new ContainerBuilder()
        .setAccentColor(0xFF6FA3)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# 🎂  ${member.displayName}'s Birthday`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `**Date:** \`${pretty}\`\n` +
            (age !== null ? `**Current Age:** \`${age}\`\n` : '') +
            (days !== null
                ? (days === 0
                    ? '**Status:** 🎉 Today is the day!'
                    : `**Next Birthday:** in \`${days}\` ${days === 1 ? 'day' : 'days'}`)
                : '')
        ));
    return container;
}

function buildUpcomingCard(guild, list) {
    let body = '';
    if (!list.length) {
        body = '_Nobody has set a birthday yet. Be the first!_';
    } else {
        body = list.map((row, i) => {
            const tag = row.member ? `<@${row.userId}>` : `\`${row.userId}\``;
            const pretty = birthdayManager.formatBirthday(row.entry);
            const dleft = row.days === 0
                ? '🎉 **Today!**'
                : `in \`${row.days}\` day${row.days === 1 ? '' : 's'}`;
            return `**${i + 1}.** ${tag} — ${pretty} · ${dleft}`;
        }).join('\n');
    }

    return new ContainerBuilder()
        .setAccentColor(0xFF6FA3)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# 📅  Upcoming Birthdays\n` +
            `-# Next celebrations in **${guild.name}**`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

async function getUpcoming(guild, limit = 10) {
    const cfg = birthdayManager.getGuildConfig(guild.id);
    const rows = [];
    for (const [userId, entry] of Object.entries(cfg.users || {})) {
        const days = daysUntil(entry);
        if (days === null) continue;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue; // user left
        rows.push({ userId, entry, days, member });
    }
    rows.sort((a, b) => a.days - b.days);
    return rows.slice(0, limit);
}

async function setBirthdayFromInput(interaction, raw) {
    const parsed = birthdayManager.parseBirthdayInput(raw);
    if (parsed.error) {
        return interaction.reply({
            content: `<:Cancel:1521227723916181644> ${parsed.error}`,
            flags: MessageFlags.Ephemeral
        });
    }
    birthdayManager.setUserBirthday(
        interaction.guild.id, interaction.user.id,
        parsed.month, parsed.day, parsed.year
    );
    const entry = birthdayManager.getUserBirthday(interaction.guild.id, interaction.user.id);
    const days = daysUntil(entry);
    const dayLine = days === 0
        ? '🎉 That\'s **today** — happy birthday!'
        : days !== null
            ? `📅 Your next birthday is in \`${days}\` day${days === 1 ? '' : 's'}.`
            : '';
    return interaction.reply({
        content:
            `<:Checkedbox:1521227734943269077> Birthday saved as **${birthdayManager.formatBirthday(entry)}**.${dayLine ? '\n' + dayLine : ''}`,
        flags: MessageFlags.Ephemeral
    });
}

// ── Command export ─────────────────────────────────────────────────────

module.exports = {
    data: new SlashCommandBuilder()
        .setName('birthday')
        .setDescription('Manage your birthday for this server')
        .addSubcommand(s => s
            .setName('set')
            .setDescription('Save your birthday for this server')
            .addStringOption(o => o
                .setName('date')
                .setDescription('Birthday as DD-MM or DD-MM-YYYY')
                .setRequired(true)))
        .addSubcommand(s => s
            .setName('view')
            .setDescription('View a saved birthday')
            .addUserOption(o => o
                .setName('user')
                .setDescription('User to look up (defaults to you)')
                .setRequired(false)))
        .addSubcommand(s => s
            .setName('remove')
            .setDescription('Remove your birthday from this server'))
        .addSubcommand(s => s
            .setName('upcoming')
            .setDescription('Show the next 10 upcoming birthdays')),

    prefix: 'birthday',
    description: 'Manage your birthday in this server',
    usage: 'birthday <set|view|remove|upcoming> [args]',
    category: 'utility',
    aliases: ['bday', 'bdays'],

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'set') {
            const raw = interaction.options.getString('date');
            return setBirthdayFromInput(interaction, raw);
        }
        if (sub === 'view') {
            const user = interaction.options.getUser('user') || interaction.user;
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!member) {
                return interaction.reply({
                    content: '<:Cancel:1521227723916181644> Could not find that member in this server.',
                    flags: MessageFlags.Ephemeral
                });
            }
            const entry = birthdayManager.getUserBirthday(interaction.guild.id, user.id);
            if (!entry) {
                return interaction.reply({
                    content: user.id === interaction.user.id
                        ? `<:Lightbulbalt:1521227880703463675> You haven't set a birthday yet — use \`/birthday set\`.`
                        : `<:Lightbulbalt:1521227880703463675> ${user} hasn't set a birthday in this server yet.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            return interaction.reply({
                components: [buildViewCard(member, entry)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }
        if (sub === 'remove') {
            const ok = birthdayManager.removeUserBirthday(interaction.guild.id, interaction.user.id);
            return interaction.reply({
                content: ok
                    ? '<:Checkedbox:1521227734943269077> Your birthday has been removed from this server.'
                    : '<:Lightbulbalt:1521227880703463675> You don\'t have a birthday saved here.',
                flags: MessageFlags.Ephemeral
            });
        }
        if (sub === 'upcoming') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const list = await getUpcoming(interaction.guild, 10);
            const card = buildUpcomingCard(interaction.guild, list);
            return interaction.editReply({
                components: [card],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }
    },

    async executePrefix(message, args) {
        const sub = (args[0] || '').toLowerCase();
        if (sub === 'set') {
            const raw = args.slice(1).join(' ');
            if (!raw) {
                return message.reply('<:Cancel:1521227723916181644> Usage: `birthday set <DD-MM[-YYYY]>`');
            }
            const parsed = birthdayManager.parseBirthdayInput(raw);
            if (parsed.error) {
                return message.reply(`<:Cancel:1521227723916181644> ${parsed.error}`);
            }
            birthdayManager.setUserBirthday(
                message.guild.id, message.author.id,
                parsed.month, parsed.day, parsed.year
            );
            const entry = birthdayManager.getUserBirthday(message.guild.id, message.author.id);
            const days = daysUntil(entry);
            const dayLine = days === 0
                ? '🎉 That\'s **today** — happy birthday!'
                : days !== null
                    ? `📅 Your next birthday is in \`${days}\` day${days === 1 ? '' : 's'}.`
                    : '';
            return message.reply(
                `<:Checkedbox:1521227734943269077> Birthday saved as **${birthdayManager.formatBirthday(entry)}**.${dayLine ? '\n' + dayLine : ''}`
            );
        }
        if (sub === 'remove' || sub === 'delete') {
            const ok = birthdayManager.removeUserBirthday(message.guild.id, message.author.id);
            return message.reply(ok
                ? '<:Checkedbox:1521227734943269077> Your birthday has been removed.'
                : '<:Lightbulbalt:1521227880703463675> You don\'t have a birthday saved here.');
        }
        if (sub === 'upcoming') {
            const list = await getUpcoming(message.guild, 10);
            const card = buildUpcomingCard(message.guild, list);
            return message.reply({ components: [card], flags: MessageFlags.IsComponentsV2 });
        }
        // 'view' subcommand or bare command with optional @mention → view
        const target = (sub === 'view' ? (message.mentions.users.first() || message.author) : null)
            || message.mentions.users.first() || message.author;
        const member = await message.guild.members.fetch(target.id).catch(() => null);
        if (!member) {
            return message.reply('<:Cancel:1521227723916181644> Could not find that member.');
        }
        const entry = birthdayManager.getUserBirthday(message.guild.id, target.id);
        if (!entry) {
            return message.reply(target.id === message.author.id
                ? '<:Lightbulbalt:1521227880703463675> You haven\'t set a birthday yet — use `birthday set <DD-MM[-YYYY]>`.'
                : `<:Lightbulbalt:1521227880703463675> ${target} hasn't set a birthday here yet.`);
        }
        return message.reply({
            components: [buildViewCard(member, entry)],
            flags: MessageFlags.IsComponentsV2
        });
    },

    /**
     * Routes button clicks from the public Set-Birthday panel.
     * Called from index.js on `bdaypanel_*` customIds.
     */
    async handlePanelButton(interaction) {
        const id = interaction.customId;
        if (!id.startsWith('bdaypanel_')) return false;
        const guildId = interaction.guild.id;

        if (id === 'bdaypanel_set') {
            const existing = birthdayManager.getUserBirthday(guildId, interaction.user.id);
            await interaction.showModal(buildBirthdayModal(PANEL_MODAL_ID, existing));
            return true;
        }
        if (id === 'bdaypanel_view') {
            const entry = birthdayManager.getUserBirthday(guildId, interaction.user.id);
            if (!entry) {
                await interaction.reply({
                    content: '<:Lightbulbalt:1521227880703463675> You haven\'t set a birthday yet. Click **Set Birthday** above.',
                    flags: MessageFlags.Ephemeral
                });
                return true;
            }
            await interaction.reply({
                components: [buildViewCard(interaction.member, entry)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            return true;
        }
        if (id === 'bdaypanel_remove') {
            const ok = birthdayManager.removeUserBirthday(guildId, interaction.user.id);
            await interaction.reply({
                content: ok
                    ? '<:Checkedbox:1521227734943269077> Your birthday has been removed.'
                    : '<:Lightbulbalt:1521227880703463675> You don\'t have a birthday saved here.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
        if (id === 'bdaypanel_upcoming') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const list = await getUpcoming(interaction.guild, 10);
            const card = buildUpcomingCard(interaction.guild, list);
            await interaction.editReply({
                components: [card],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            return true;
        }
        return false;
    },

    /**
     * Handles modal submits from the Set-Birthday panel and slash modal flows.
     */
    async handlePanelModal(interaction) {
        const id = interaction.customId;
        if (id !== PANEL_MODAL_ID && id !== SLASH_MODAL_ID) return false;

        const raw = interaction.fields.getTextInputValue('bday_date');
        const parsed = birthdayManager.parseBirthdayInput(raw);
        if (parsed.error) {
            await interaction.reply({
                content: `<:Cancel:1521227723916181644> ${parsed.error}`,
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
        birthdayManager.setUserBirthday(
            interaction.guild.id, interaction.user.id,
            parsed.month, parsed.day, parsed.year
        );
        const entry = birthdayManager.getUserBirthday(interaction.guild.id, interaction.user.id);
        const days = daysUntil(entry);
        const dayLine = days === 0
            ? '🎉 That\'s **today** — happy birthday!'
            : `📅 Your next birthday is in \`${days}\` day${days === 1 ? '' : 's'}.`;
        await interaction.reply({
            content: `<:Checkedbox:1521227734943269077> Birthday saved as **${birthdayManager.formatBirthday(entry)}**.\n${dayLine}`,
            flags: MessageFlags.Ephemeral
        });
        return true;
    },

    PANEL_MODAL_ID,
    SLASH_MODAL_ID
};
