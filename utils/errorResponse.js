const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const log = require('./logger-styled');

const SUPPORT_SERVER_URL = process.env.SUPPORT_SERVER || 'https://discord.gg/Zs35X7Umak';

/**
 * Generate a short unique error reference ID.
 * @returns {string}
 */
function generateErrorId() {
    return Date.now().toString(36);
}

/**
 * Build the action row with "Join Support Server" and "Report Bug" buttons.
 * @param {string} [errorId] – Optional error reference ID attached to the report button custom ID.
 * @returns {ActionRowBuilder}
 */
function buildErrorActionRow(errorId = null) {
    const reportCustomId = errorId ? `bug_report:${errorId}` : 'bug_report';

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Join Support Server')
            .setURL(SUPPORT_SERVER_URL)
            .setStyle(ButtonStyle.Link)
            .setEmoji('🆘'),
        new ButtonBuilder()
            .setCustomId(reportCustomId)
            .setLabel('Report Bug')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🐛')
    );
}

/**
 * Build a complete error reply payload for slash commands (ephemeral with buttons).
 * @param {string} message – The error message to display.
 * @param {string} [errorId] – Optional error reference ID.
 * @returns {object} – Ready-to-send reply/editReply payload.
 */
function buildErrorReply(message, errorId = null) {
    return {
        content: `<:Cancel:1521227723916181644> ${message}`,
        components: [buildErrorActionRow(errorId)],
        flags: MessageFlags.Ephemeral
    };
}

/**
 * Build an error container (Components V2) with action row for prefix commands.
 * @param {string} title – Error title.
 * @param {string} description – Error description.
 * @param {string} [errorId] – Optional error reference ID.
 * @returns {{ container: ContainerBuilder, row: ActionRowBuilder }}
 */
function buildErrorContainer(title, description, errorId = null) {
    const container = new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> ${title}\n\n${description}`)
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Need help? Use the buttons below to get support or report this bug.'));

    return { container, row: buildErrorActionRow(errorId) };
}

/**
 * Send a standardised error reply on an interaction (slash or button).
 * Handles deferred / already-replied states gracefully.
 * @param {import('discord.js').Interaction} interaction
 * @param {string} message – User-facing message.
 * @param {string} [errorId] – Optional reference ID.
 */
async function sendErrorReply(interaction, message, errorId = null) {
    const payload = buildErrorReply(message, errorId);
    try {
        if (interaction.deferred) {
            await interaction.editReply(payload).catch(() => {});
        } else if (!interaction.replied) {
            await interaction.reply(payload).catch(() => {});
        }
    } catch {
        // Interaction may have already expired – nothing we can do.
    }
}

/**
 * Build the bug-report modal that opens when a user clicks "Report Bug".
 * @param {string} [errorId] – Optional reference to embed into the modal custom ID.
 * @returns {ModalBuilder}
 */
function buildBugReportModal(errorId = null) {
    const modalId = errorId ? `bug_report_modal:${errorId}` : 'bug_report_modal';

    return new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Report a Bug')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('bug_description')
                    .setLabel('What happened?')
                    .setPlaceholder('Describe the bug you encountered...')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1000)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('bug_steps')
                    .setLabel('Steps to reproduce (optional)')
                    .setPlaceholder('1. Run /command\n2. Click button\n3. See error')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setMaxLength(1000)
            )
        );
}

/**
 * Handle the bug report modal submission.
 * Sends the report to the bot owner via DM (reusing the report.js pattern).
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @param {import('discord.js').Client} client
 */
async function handleBugReportSubmit(interaction, client) {
    const description = interaction.fields.getTextInputValue('bug_description');
    const steps = interaction.fields.getTextInputValue('bug_steps') || 'Not provided';

    // Extract error ID from modal custom ID if present
    const parts = interaction.customId.split(':');
    const errorId = parts.length > 1 ? parts[1] : null;

    const ownerId = process.env.OWNER_ID;
    if (!ownerId) {
        await interaction.reply({
            content: '<:Cancel:1521227723916181644> Bug report feature is not configured. Please join the support server instead.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
    }

    try {
        const owner = await client.users.fetch(ownerId);

        const reportContainer = new ContainerBuilder()
            .setAccentColor(0xED4245)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# 🐛 Bug Report`)
            )
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### <:Edit:1521227886634205298> Description\n${description}\n\n` +
                    `### 🔄 Steps to Reproduce\n${steps}\n\n` +
                    `<:User:1521227714227343380> **From:** ${interaction.user.username} (\`${interaction.user.id}\`)\n` +
                    `<:Folder:1521228095225331765> **Server:** ${interaction.guild ? `${interaction.guild.name} (\`${interaction.guild.id}\`)` : 'DM'}\n` +
                    (errorId ? `<:Infotriangle:1521227710381428926> **Error ID:** \`${errorId}\`\n` : '')
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

        await owner.send({ components: [reportContainer], flags: MessageFlags.IsComponentsV2 });

        const successContainer = new ContainerBuilder()
            .setAccentColor(0x57F287)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Bug Report Sent\n\n` +
                    `Your bug report has been sent to the bot owner. Thank you for helping improve xNico!`
                )
            );

        await interaction.reply({
            components: [successContainer],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        }).catch(() => {});
    } catch (error) {
        log.error('Bug report submission error:', error);
        await interaction.reply({
            content: '<:Cancel:1521227723916181644> Failed to send the bug report. Please try using `/report` or join the support server.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }
}

module.exports = {
    generateErrorId,
    buildErrorActionRow,
    buildErrorReply,
    buildErrorContainer,
    sendErrorReply,
    buildBugReportModal,
    handleBugReportSubmit,
    SUPPORT_SERVER_URL
};
