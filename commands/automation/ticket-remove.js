const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags,
    ContainerBuilder, TextDisplayBuilder,
} = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const { ensureMigrated } = require('../../utils/ticketPanels');
const {
    E, COLOR, errorContainer, v2Reply, canManageTicket,
} = require('../../utils/ticketUI');

/* ───────────────────────── store helpers ───────────────────────── */

function loadConfig() {
    if (!jsonStore.has('tickets')) {
        jsonStore.write('tickets', {});
        return {};
    }
    const data = jsonStore.read('tickets');
    if (Array.isArray(data)) {
        jsonStore.write('tickets', {});
        return {};
    }
    return data;
}

function resolveTicketContext(guild, channelId) {
    const config = loadConfig();
    const guildConfig = ensureMigrated(config[guild.id]);
    if (!guildConfig) return null;
    const ticket = guildConfig.tickets?.[channelId];
    if (!ticket) return null;
    return { config, guildConfig, ticket };
}

/* ─────────────────────────── shared logic ──────────────────────── */

async function removeUserFromTicket({ guild, channel, member, targetUser }) {
    const ctx = resolveTicketContext(guild, channel.id);
    if (!ctx) return { ok: false, message: 'This is not a ticket channel.' };

    const { config, guildConfig, ticket } = ctx;

    // Removing other people is a staff action only — owners shouldn't be able
    // to evict staff or other invitees from their own ticket.
    if (!canManageTicket(member, guildConfig, ticket, { level: 'staff' })) {
        return { ok: false, message: 'Only the support team or admins can remove users from tickets.' };
    }
    if (!targetUser) {
        return { ok: false, message: 'Please specify a user to remove.' };
    }
    if (targetUser.id === ticket.userId) {
        return { ok: false, message: 'You cannot remove the ticket owner. Close the ticket instead.' };
    }
    if (targetUser.id === guild.members.me.id) {
        return { ok: false, message: 'You cannot remove the bot from this ticket.' };
    }
    if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return { ok: false, message: 'I need **Manage Channels** permission to update this ticket.' };
    }

    try {
        await channel.permissionOverwrites.delete(targetUser);
    } catch (err) {
        return { ok: false, message: `Failed to update channel permissions: ${err.message}` };
    }

    if (ticket.members) {
        ticket.members = ticket.members.filter(id => id !== targetUser.id);
    }
    jsonStore.write('tickets', config);

    const text =
        `# ${E.cancel} User Removed\n\n` +
        `${targetUser} has been removed from this ticket by ${member}.\n\n` +
        `${E.pin} They can no longer read or reply in this channel.`;

    const container = new ContainerBuilder()
        .setAccentColor(COLOR.WARNING)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

    return { ok: true, container };
}

/* ─────────────────────────── command ──────────────────────────── */

module.exports = {
    category: 'automation',
    data: new SlashCommandBuilder()
        .setName('ticket-remove')
        .setDescription('Remove a user from the current ticket channel')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to remove from this ticket')
                .setRequired(true))
        .setDMPermission(false),

    async execute(interaction) {
        try {
            const targetUser = interaction.options.getUser('user');
            const result = await removeUserFromTicket({
                guild:   interaction.guild,
                channel: interaction.channel,
                member:  interaction.member,
                targetUser,
            });

            if (!result.ok) {
                return interaction.reply({
                    ...v2Reply(errorContainer(result.message), true),
                });
            }
            await interaction.reply({
                components: [result.container],
                flags: MessageFlags.IsComponentsV2,
            });
        } catch (error) {
            console.error(`[ticket-remove] ${error.message}`, error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    ...v2Reply(errorContainer('Failed to remove user from ticket.'), true),
                }).catch(() => {});
            }
        }
    },

    async executePrefix(message) {
        try {
            const targetUser = message.mentions.users.first();
            if (!targetUser) {
                return message.reply({
                    ...v2Reply(errorContainer('Mention the user to remove. Example: `-ticket-remove @user`')),
                });
            }
            const result = await removeUserFromTicket({
                guild:   message.guild,
                channel: message.channel,
                member:  message.member,
                targetUser,
            });

            if (!result.ok) {
                return message.reply({ ...v2Reply(errorContainer(result.message)) });
            }
            await message.reply({
                components: [result.container],
                flags: MessageFlags.IsComponentsV2,
            });
        } catch (error) {
            console.error(`[ticket-remove] ${error.message}`, error);
        }
    },
};
