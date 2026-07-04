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
    bulb     : '<:Lightbulbalt:1521227880703463675>',
    edit     : '<:Edit:1521227886634205298>',
    user     : '<:User:1521227714227343380>',
    folder   : '<:Folder:1521228095225331765>',
    check    : '<:Checkedbox:1521227734943269077>',
    cancel   : '<:Cancel:1521227723916181644>',
    clock    : '<:Clock:1521228110408847623>',
    fire     : '<:Fire:1521227907647668374>',
};

const COOLDOWN_MS = 30_000;
const cooldown = new Map(); // userId -> timestamp

function checkCooldown(userId) {
    const last = cooldown.get(userId) || 0;
    const remaining = COOLDOWN_MS - (Date.now() - last);
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

async function sendSuggestion(client, author, guild, suggestion) {
    const ownerId = process.env.OWNER_ID;
    if (!ownerId) return { success: false, reason: 'no-owner' };

    try {
        const owner = await client.users.fetch(ownerId);

        const guildLine = guild
            ? `${E.folder} **Server:** ${guild.name} (\`${guild.id}\`)`
            : `${E.folder} **Server:** *DM context*`;

        const container = new ContainerBuilder()
            .addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# ${E.bulb} New Suggestion\n-# Submitted via \`/suggest\``
                    ))
                    .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: author.displayAvatarURL({ size: 256 }) } }))
            )
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${E.edit} Suggestion\n${suggestion.length > 1500 ? suggestion.slice(0, 1500) + '…' : suggestion}\n\n` +
                `${E.user} **From:** ${author.username} (\`${author.id}\`)\n` +
                guildLine + `\n` +
                `${E.clock} **Submitted:** <t:${Math.floor(Date.now() / 1000)}:R>`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))

        await owner.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return { success: true };
    } catch (error) {
        console.error('Suggestion error:', error);
        return { success: false, reason: 'send-failed', error };
    }
}

function buildSuccessContainer(suggestion) {
    const preview = suggestion.length > 200 ? suggestion.slice(0, 200) + '…' : suggestion;
    return new ContainerBuilder()
        .setAccentColor(0x57F287)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${E.check} Suggestion Sent\n\n` +
            `> ${preview.replace(/\n/g, '\n> ')}\n\n` +
            `Your suggestion has been sent to the bot owner. Thanks for the feedback!`
        ));
}

function buildErrorContainer(reason) {
    const body = reason === 'cooldown'
        ? 'You are submitting suggestions too fast. Please wait a moment and try again.'
        : 'Failed to send your suggestion. Please try again later.';
    return new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${E.cancel} Suggestion Failed\n\n${body}`
        ));
}

module.exports = {
    sendSuggestion,
    prefix: 'suggest',
    description: 'Submit a suggestion to the bot owner',
    usage: 'suggest <your idea>',
    category: 'basic',
    aliases: ['feedback-bot', 'idea'],

    data: new SlashCommandBuilder()
        .setName('suggest')
        .setDescription('Submit a suggestion to the bot owner')
        .addStringOption(option =>
            option.setName('suggestion')
                .setDescription('Your suggestion')
                .setRequired(true)
                .setMaxLength(1500)),

    async execute(interaction) {
        const remaining = checkCooldown(interaction.user.id);
        if (remaining) {
            return interaction.reply({
                components: [new ContainerBuilder()
                    .setAccentColor(0xFEE75C)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# ${E.clock} Slow Down\n\nYou can send another suggestion in **${remaining}s**.`
                    ))],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }

        const suggestion = interaction.options.getString('suggestion');
        const result = await sendSuggestion(interaction.client, interaction.user, interaction.guild, suggestion);

        if (result.success) {
            cooldown.set(interaction.user.id, Date.now());
            return interaction.reply({
                components: [buildSuccessContainer(suggestion)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }
        return interaction.reply({
            components: [buildErrorContainer(result.reason)],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
    },

    async executePrefix(message, args) {
        const suggestion = args.join(' ').trim();
        if (!suggestion) {
            return message.reply({
                components: [new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# ${E.cancel} Missing Input\n\nPlease provide your suggestion.\nUsage: \`-suggest <your idea>\``
                    ))],
                flags: MessageFlags.IsComponentsV2,
            });
        }
        if (suggestion.length > 1500) {
            return message.reply({
                components: [new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# ${E.cancel} Too Long\n\nKeep your suggestion under **1,500** characters.`
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
                        `# ${E.clock} Slow Down\n\nYou can send another suggestion in **${remaining}s**.`
                    ))],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        const result = await sendSuggestion(message.client, message.author, message.guild, suggestion);
        if (result.success) {
            cooldown.set(message.author.id, Date.now());
            return message.reply({ components: [buildSuccessContainer(suggestion)], flags: MessageFlags.IsComponentsV2 });
        }
        return message.reply({ components: [buildErrorContainer(result.reason)], flags: MessageFlags.IsComponentsV2 });
    },
};
