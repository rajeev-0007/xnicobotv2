'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const jsonStore = require('../../utils/jsonStore');

const STORE = 'user-timezones';

// Common timezone shortcuts
const TZ_ALIASES = {
    'ist': 'Asia/Kolkata', 'india': 'Asia/Kolkata',
    'est': 'America/New_York', 'edt': 'America/New_York',
    'cst': 'America/Chicago', 'cdt': 'America/Chicago',
    'mst': 'America/Denver', 'mdt': 'America/Denver',
    'pst': 'America/Los_Angeles', 'pdt': 'America/Los_Angeles',
    'gmt': 'Europe/London', 'bst': 'Europe/London', 'utc': 'UTC',
    'cet': 'Europe/Berlin', 'cest': 'Europe/Berlin',
    'jst': 'Asia/Tokyo', 'japan': 'Asia/Tokyo',
    'kst': 'Asia/Seoul', 'korea': 'Asia/Seoul',
    'aest': 'Australia/Sydney', 'aedt': 'Australia/Sydney',
    'nzst': 'Pacific/Auckland', 'nzdt': 'Pacific/Auckland',
    'pht': 'Asia/Manila', 'philippines': 'Asia/Manila',
    'sgt': 'Asia/Singapore', 'singapore': 'Asia/Singapore',
    'hkt': 'Asia/Hong_Kong', 'hongkong': 'Asia/Hong_Kong',
    'brt': 'America/Sao_Paulo', 'brazil': 'America/Sao_Paulo',
    'msk': 'Europe/Moscow', 'russia': 'Europe/Moscow',
    'dubai': 'Asia/Dubai', 'gst': 'Asia/Dubai',
    'pkt': 'Asia/Karachi', 'pakistan': 'Asia/Karachi',
    'bdt': 'Asia/Dhaka', 'bangladesh': 'Asia/Dhaka',
    'ict': 'Asia/Bangkok', 'thailand': 'Asia/Bangkok',
    'wib': 'Asia/Jakarta', 'indonesia': 'Asia/Jakarta',
};

function resolveTimezone(input) {
    if (!input) return null;
    const lower = input.toLowerCase().trim();
    if (TZ_ALIASES[lower]) return TZ_ALIASES[lower];
    // Try as IANA timezone directly
    try {
        Intl.DateTimeFormat(undefined, { timeZone: input });
        return input;
    } catch {
        return null;
    }
}

function formatTime(tz) {
    try {
        return new Date().toLocaleString('en-US', {
            timeZone: tz,
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
        });
    } catch { return 'Invalid timezone'; }
}

function loadTimezones() {
    return jsonStore.peek(STORE) || {};
}

function saveTimezone(userId, tz) {
    const data = jsonStore.read(STORE) || {};
    if (tz === null) delete data[userId];
    else data[userId] = tz;
    jsonStore.write(STORE, data);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('timezone')
        .setDescription('Set or view your timezone')
        .addSubcommand(sub => sub
            .setName('set')
            .setDescription('Set your timezone')
            .addStringOption(o => o.setName('zone').setDescription('Timezone (e.g. IST, EST, Asia/Kolkata, America/New_York)').setRequired(true)))
        .addSubcommand(sub => sub
            .setName('view')
            .setDescription('View your or another user\'s timezone')
            .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(false)))
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('View common timezone abbreviations'))
        .addSubcommand(sub => sub
            .setName('remove')
            .setDescription('Remove your saved timezone')),

    prefix: 'timezone',
    aliases: ['tz', 'settz'],
    description: 'Set or view your timezone',
    usage: 'timezone set <zone> | timezone view [@user] | timezone list | timezone remove',
    category: 'utility',

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'set') {
            const input = interaction.options.getString('zone');
            const tz = resolveTimezone(input);
            if (!tz) {
                return interaction.reply({
                    components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Invalid Timezone\n\n\`${input}\` is not a valid timezone.\n\n**Examples:** \`IST\`, \`EST\`, \`Asia/Kolkata\`, \`America/New_York\`\n\n-# Use \`/timezone list\` to see common abbreviations`)
                    )],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            }
            saveTimezone(interaction.user.id, tz);
            const now = formatTime(tz);
            return interaction.reply({
                components: [new ContainerBuilder().setAccentColor(0x57F287).addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> Timezone Set\n\n**Zone:** \`${tz}\`\n**Current Time:** \`${now}\``)
                )],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }

        if (sub === 'view') {
            const target = interaction.options.getUser('user') || interaction.user;
            const data = loadTimezones();
            const tz = data[target.id];
            if (!tz) {
                return interaction.reply({
                    components: [new ContainerBuilder().addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# <:Clock:1521228110408847623> No Timezone Set\n\n${target.id === interaction.user.id ? 'You haven\'t' : `**${target.username}** hasn't`} set a timezone yet.\n\n-# Use \`/timezone set <zone>\` to set one`)
                    )],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            }
            const now = formatTime(tz);
            return interaction.reply({
                components: [new ContainerBuilder().addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# <:Clock:1521228110408847623> ${target.username}'s Time\n\n**Zone:** \`${tz}\`\n**Current Time:** \`${now}\``)
                )],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }

        if (sub === 'list') {
            const zones = [
                '`IST` — India (Asia/Kolkata)',
                '`EST` — US Eastern (America/New_York)',
                '`CST` — US Central (America/Chicago)',
                '`PST` — US Pacific (America/Los_Angeles)',
                '`GMT` — UK (Europe/London)',
                '`CET` — Central Europe (Europe/Berlin)',
                '`JST` — Japan (Asia/Tokyo)',
                '`KST` — Korea (Asia/Seoul)',
                '`AEST` — Australia (Australia/Sydney)',
                '`SGT` — Singapore (Asia/Singapore)',
                '`BRT` — Brazil (America/Sao_Paulo)',
                '`MSK` — Russia (Europe/Moscow)',
                '`PKT` — Pakistan (Asia/Karachi)',
                '`ICT` — Thailand (Asia/Bangkok)',
                '`UTC` — Universal Coordinated Time',
            ].join('\n');
            return interaction.reply({
                components: [new ContainerBuilder().addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# <:Clock:1521228110408847623> Common Timezones\n\n${zones}\n\n-# You can also use full IANA names like \`Asia/Kolkata\``)
                )],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }

        if (sub === 'remove') {
            saveTimezone(interaction.user.id, null);
            return interaction.reply({
                components: [new ContainerBuilder().setAccentColor(0x57F287).addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> Timezone Removed\n\nYour timezone has been cleared.`)
                )],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }
    },

    async executePrefix(message, args) {
        const sub = args[0]?.toLowerCase();

        if (!sub || sub === 'view') {
            const { resolveUser } = require('../../utils/resolveUser');
            const target = (await resolveUser(message, args.slice(1))) || message.author;
            const data = loadTimezones();
            const tz = data[target.id];
            if (!tz) {
                const container = new ContainerBuilder().addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# <:Clock:1521228110408847623> No Timezone Set\n\n${target.id === message.author.id ? 'You haven\'t' : `**${target.username}** hasn't`} set a timezone.\n\n-# Use \`-timezone set <zone>\``)
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            const now = formatTime(tz);
            const container = new ContainerBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# <:Clock:1521228110408847623> ${target.username}'s Time\n\n**Zone:** \`${tz}\`\n**Current Time:** \`${now}\``)
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'set') {
            const input = args.slice(1).join(' ');
            if (!input) {
                const container = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Missing Timezone\n\n**Usage:** \`-timezone set <zone>\`\n**Examples:** \`IST\`, \`EST\`, \`Asia/Kolkata\``)
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            const tz = resolveTimezone(input);
            if (!tz) {
                const container = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Invalid Timezone\n\n\`${input}\` is not recognized.\n\n-# Use \`-timezone list\` to see options`)
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            saveTimezone(message.author.id, tz);
            const now = formatTime(tz);
            const container = new ContainerBuilder().setAccentColor(0x57F287).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> Timezone Set\n\n**Zone:** \`${tz}\`\n**Current Time:** \`${now}\``)
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'list') {
            const zones = '`IST` India · `EST` US East · `CST` US Central · `PST` US West · `GMT` UK · `CET` Europe · `JST` Japan · `KST` Korea · `AEST` Australia · `SGT` Singapore · `UTC` Universal';
            const container = new ContainerBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# <:Clock:1521228110408847623> Timezones\n\n${zones}\n\n-# Full IANA names also work: \`Asia/Kolkata\`, \`America/New_York\``)
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'remove') {
            saveTimezone(message.author.id, null);
            const container = new ContainerBuilder().setAccentColor(0x57F287).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> Timezone Removed`)
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Unknown subcommand — show help
        const container = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# <:Clock:1521228110408847623> Timezone\n\n**Commands:**\n> \`-timezone set <zone>\` — Set your timezone\n> \`-timezone view [@user]\` — View time\n> \`-timezone list\` — Common zones\n> \`-timezone remove\` — Clear saved zone`)
        );
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
