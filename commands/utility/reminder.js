const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');
const { buildSafeListText } = require('../../utils/componentHelpers');

const jsonStore = require('../../utils/jsonStore');

function loadReminders() {
    if (!jsonStore.has('reminders')) {
        jsonStore.write('reminders', []);
        return [];
    }
    return jsonStore.read('reminders');
}

function saveReminders(reminders) {
    jsonStore.write('reminders', reminders);
}

function parseTime(str) {
    const match = str.match(/^(\d+)([smhd])$/);
    if (!match) return null;

    const value = parseInt(match[1]);
    const unit = match[2];

    const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return value * units[unit];
}

async function sendReminder(reminder, client) {
    try {
        const channel = await client.channels.fetch(reminder.channelId);
        
        let content = `# <:Alarm:1521227869047750689> Reminder!\n\n`;
        content += `> ${reminder.message}`;
        
        const container = new ContainerBuilder()
            .setAccentColor(COLORS.WARNING)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<@${reminder.userId}>`))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });

        const reminders = loadReminders().filter(r => r.id !== reminder.id);
        saveReminders(reminders);
    } catch (error) {
        console.error('Reminder error:', error);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reminder')
        .setDescription('Set a reminder')
        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('Set a new reminder')
                .addStringOption(opt =>
                    opt.setName('time')
                        .setDescription('Time until reminder (e.g., 10m, 1h, 1d)')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('message')
                        .setDescription('Reminder message')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List your active reminders'))
        .addSubcommand(sub =>
            sub.setName('delete')
                .setDescription('Delete a reminder')
                .addIntegerOption(opt =>
                    opt.setName('id')
                        .setDescription('Reminder ID to delete')
                        .setRequired(true))),
    prefix: 'reminder',
    description: 'Set, list, or delete reminders',
    usage: 'reminder <set/list> [time] [message]',
    category: 'utility',
    aliases: ['remind', 'remindme'],

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'set') {
            const timeStr = interaction.options.getString('time');
            const message = interaction.options.getString('message');

            const timeMs = parseTime(timeStr);
            if (!timeMs) {
                const container = buildErrorResponse('Invalid Time', 'Use format: 10s, 10m, 1h, 1d');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const reminders = loadReminders();
            const reminder = {
                id: Date.now(),
                userId: interaction.user.id,
                channelId: interaction.channel.id,
                message: message,
                time: Date.now() + timeMs,
                guildId: interaction.guild?.id
            };

            reminders.push(reminder);
            saveReminders(reminders);

            setTimeout(() => sendReminder(reminder, interaction.client), timeMs);

            let content = `# <:Alarm:1521227869047750689> Reminder Set\n\n`;
            content += `I'll remind you in **${timeStr}**\n\n`;
            content += `### Message\n> ${message}`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.SUCCESS)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

        } else if (subcommand === 'list') {
            const reminders = loadReminders().filter(r => r.userId === interaction.user.id);

            if (reminders.length === 0) {
                const container = buildErrorResponse('No Reminders', 'You have no active reminders.');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Trim to fit Discord's 4 000-char per-TextDisplay cap.
            const lineEntries = reminders.map((r, i) =>
                `**${i + 1}.** ${r.message}\n> <:Alarm:1521227869047750689> <t:${Math.floor(r.time / 1000)}:R>`
            );
            const { content } = buildSafeListText({
                header: '# <:Document:1521227875016114266> Your Reminders',
                lines: lineEntries,
                separator: '\n\n',
                overflowHint: '\n\n-# +${n} more not shown — delete some reminders to see them all',
            });

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

        } else if (subcommand === 'delete') {
            const id = interaction.options.getInteger('id');
            let reminders = loadReminders();
            const index = reminders.findIndex(r => r.id === id && r.userId === interaction.user.id);

            if (index === -1) {
                const container = buildErrorResponse('Not Found', 'Reminder not found or you don\'t own it.');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            reminders.splice(index, 1);
            saveReminders(reminders);

            await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Reminder deleted!', flags: MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message, args) {
        const action = args[0]?.toLowerCase();

        if (action === 'set' && args.length >= 3) {
            const timeStr = args[1];
            const msg = args.slice(2).join(' ');
            const timeMs = parseTime(timeStr);

            if (!timeMs) {
                const container = buildErrorResponse('Invalid Time', 'Use format: 10s, 10m, 1h, 1d');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const reminders = loadReminders();
            const reminder = {
                id: Date.now(),
                userId: message.author.id,
                channelId: message.channel.id,
                message: msg,
                time: Date.now() + timeMs,
                guildId: message.guild?.id
            };

            reminders.push(reminder);
            saveReminders(reminders);

            setTimeout(() => sendReminder(reminder, message.client), timeMs);

            let content = `# <:Alarm:1521227869047750689> Reminder Set\n\n`;
            content += `I'll remind you in **${timeStr}**\n\n`;
            content += `### Message\n> ${msg}`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.SUCCESS)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

        } else if (action === 'list') {
            const reminders = loadReminders().filter(r => r.userId === message.author.id);

            if (reminders.length === 0) {
                const container = buildErrorResponse('No Reminders', 'You have no active reminders.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Trim to fit Discord's 4 000-char per-TextDisplay cap.
            const lineEntries = reminders.map((r, i) =>
                `**${i + 1}.** ${r.message}\n> <:Alarm:1521227869047750689> <t:${Math.floor(r.time / 1000)}:R>`
            );
            const { content } = buildSafeListText({
                header: '# <:Document:1521227875016114266> Your Reminders',
                lines: lineEntries,
                separator: '\n\n',
                overflowHint: '\n\n-# +${n} more not shown — delete some reminders to see them all',
            });

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

        } else {
            let content = `# <:Alarm:1521227869047750689> Reminder Command\n\n`;
            content += `### Usage\n`;
            content += `> \`reminder set <time> <message>\` - Set a reminder\n`;
            content += `> \`reminder list\` - View your reminders\n\n`;
            content += `### Time Formats\n`;
            content += `> \`10s\` - seconds\n`;
            content += `> \`10m\` - minutes\n`;
            content += `> \`1h\` - hours\n`;
            content += `> \`1d\` - days`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
