const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags,
} = require('discord.js');

const E = {
    warning  : '<:Infotriangle:1521227710381428926>',
    edit     : '<:Edit:1521227886634205298>',
    user     : '<:User:1521227714227343380>',
    folder   : '<:Folder:1521228095225331765>',
    check    : '<:Checkedbox:1521227734943269077>',
    cancel   : '<:Cancel:1521227723916181644>',
    clock    : '<:Clock:1521228110408847623>',
    fire     : '<:Fire:1521227907647668374>',
    bug      : '<:Infotriangle:1521227710381428926>',
};

const COOLDOWN_MS = 60_000;
const cooldown = new Map(); // userId -> timestamp

function checkCooldown(userId) {
    const last = cooldown.get(userId) || 0;
    const remaining = COOLDOWN_MS - (Date.now() - last);
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

async function sendReport(client, reporter, guild, bug) {
    const ownerId = process.env.OWNER_ID;
    if (!ownerId) return { success: false, error: new Error('OWNER_ID not configured') };

    try {
        const owner = await client.users.fetch(ownerId);

        const guildLine = guild
            ? `${E.folder} **Server:** ${guild.name} (\`${guild.id}\`)`
            : `${E.folder} **Server:** *DM context*`;

        const container = new ContainerBuilder()
            .setAccentColor(0xED4245)
            .addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# ${E.bug} Bug Report\n-# Submitted via \`/report\``
                    ))
                    .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: reporter.displayAvatarURL({ size: 256 }) } }))
            )
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${E.edit} Description\n${bug.length > 1500 ? bug.slice(0, 1500) + '…' : bug}\n\n` +
                `${E.user} **From:** ${reporter.username} (\`${reporter.id}\`)\n` +
                guildLine + `\n` +
                `${E.clock} **Reported:** <t:${Math.floor(Date.now() / 1000)}:R>`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))

        await owner.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return { success: true };
    } catch (error) {
        console.error('Report error:', error);
        return { success: false, error };
    }
}

function buildSuccessContainer(bug) {
    const preview = bug.length > 200 ? bug.slice(0, 200) + '…' : bug;
    return new ContainerBuilder()
        .setAccentColor(0x57F287)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${E.check} Bug Report Sent\n\n` +
            `> ${preview.replace(/\n/g, '\n> ')}\n\n` +
            `Your report has been delivered to the bot owner. Thanks for helping us improve!`
        ));
}

function buildErrorContainer(reason) {
    const body = reason === 'cooldown'
        ? 'You are submitting reports too fast. Please wait a moment and try again.'
        : 'Failed to send your report. Please try again later.';
    return new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${E.cancel} Report Failed\n\n${body}`
        ));
}

module.exports = {
    sendReport,
    prefix: 'report',
    description: 'Report a bug to the bot owner',
    usage: 'report <bug description>',
    category: 'basic',
    aliases: ['bugreport', 'bug'],

    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Report a bug to the bot owner')
        .addStringOption(option =>
            option.setName('bug')
                .setDescription('Describe the bug')
                .setRequired(true)
                .setMaxLength(1500)),

    async execute(interaction) {
        const remaining = checkCooldown(interaction.user.id);
        if (remaining) {
            return interaction.reply({
                components: [new ContainerBuilder()
                    .setAccentColor(0xFEE75C)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# ${E.clock} Slow Down\n\nYou can send another report in **${remaining}s**.`
                    ))],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }

        const bug = interaction.options.getString('bug');
        const result = await sendReport(interaction.client, interaction.user, interaction.guild, bug);
        if (result.success) {
            cooldown.set(interaction.user.id, Date.now());
            return interaction.reply({
                components: [buildSuccessContainer(bug)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }
        return interaction.reply({
            components: [buildErrorContainer(result.reason)],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
    },

    async executePrefix(message, args) {
        const bug = args.join(' ').trim();
        if (!bug) {
            return message.reply({
                components: [new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# ${E.cancel} Missing Input\n\nPlease provide a bug description.\nUsage: \`-report <bug description>\``
                    ))],
                flags: MessageFlags.IsComponentsV2,
            });
        }
        if (bug.length > 1500) {
            return message.reply({
                components: [new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# ${E.cancel} Too Long\n\nKeep your report under **1,500** characters.`
                    ))],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        const remaining = checkCooldown(message.author.id);
        if (remaining) {
            return message.reply({
                components: [new ContainerBuilder()
                    .setAccentColor(0xFEE75C)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# ${E.clock} Slow Down\n\nYou can send another report in **${remaining}s**.`
                    ))],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        const result = await sendReport(message.client, message.author, message.guild, bug);
        if (result.success) {
            cooldown.set(message.author.id, Date.now());
            return message.reply({ components: [buildSuccessContainer(bug)], flags: MessageFlags.IsComponentsV2 });
        }
        return message.reply({ components: [buildErrorContainer(result.reason)], flags: MessageFlags.IsComponentsV2 });
    },
};
