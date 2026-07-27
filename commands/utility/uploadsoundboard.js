'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');

const MAX_DURATION = 5; // seconds
const MAX_SIZE = 512 * 1024; // 512KB
const SUPPORTED_FORMATS = ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp3'];

async function handleUpload(reply, guild, user, name, source, volume) {
    if (!name || !source) {
        const container = new ContainerBuilder().setAccentColor(0xED4245);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Cancel:1521227723916181644> Usage\n\n` +
            `> \`uploadsoundboard <name> <url_or_attachment>\`\n\n` +
            `<:Caretright:1521227704953864202> **Name:** 2-32 characters, no spaces\n` +
            `<:Caretright:1521227704953864202> **Source:** Direct audio URL (.mp3, .ogg, .wav) or attachment\n` +
            `<:Caretright:1521227704953864202> **Max duration:** ${MAX_DURATION}s | **Max size:** 512KB\n\n` +
            `-# Requires Manage Expressions permission`
        ));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // Validate name
    const cleanName = name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
    if (cleanName.length < 2) {
        const container = new ContainerBuilder().setAccentColor(0xED4245);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Cancel:1521227723916181644> Invalid Name\n> Name must be 2-32 alphanumeric characters.`
        ));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    try {
        // Fetch audio data
        const response = await axios.get(source, { responseType: 'arraybuffer', timeout: 10000, maxContentLength: MAX_SIZE });
        const buffer = Buffer.from(response.data);

        if (buffer.length > MAX_SIZE) {
            const container = new ContainerBuilder().setAccentColor(0xED4245);
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Cancel:1521227723916181644> File Too Large\n> Maximum size is **512KB**. Your file is ${(buffer.length / 1024).toFixed(0)}KB.`
            ));
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Upload to guild soundboard
        const sound = await guild.soundboardSounds.create({
            name: cleanName,
            file: buffer,
            volume: Math.min(1, Math.max(0, volume || 1)),
            emojiName: '🎵',
            reason: `Uploaded by ${user.username} via uploadsoundboard`,
        });

        const container = new ContainerBuilder().setAccentColor(0x57F287);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Checkedbox:1521227734943269077> Soundboard Uploaded\n\n` +
            `> <:Caretright:1521227704953864202> **Name:** \`${sound.name}\`\n` +
            `> <:Caretright:1521227704953864202> **ID:** \`${sound.soundId}\`\n` +
            `> <:Caretright:1521227704953864202> **Volume:** ${Math.round((volume || 1) * 100)}%\n\n` +
            `-# Uploaded by ${user.username}`
        ));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

    } catch (err) {
        const reason = err.code === 50035 ? 'Invalid audio format or duration exceeds 5s'
            : err.code === 30038 ? 'Soundboard slots are full for this server'
            : err.message || 'Unknown error';

        const container = new ContainerBuilder().setAccentColor(0xED4245);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Cancel:1521227723916181644> Upload Failed\n\n> ${reason}\n\n` +
            `-# Supported: .mp3, .ogg, .wav | Max 5s, 512KB`
        ));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('uploadsoundboard')
        .setDescription('Upload a sound to the server soundboard from a URL')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
        .addStringOption(o => o.setName('name').setDescription('Sound name (2-32 chars)').setRequired(true))
        .addStringOption(o => o.setName('url').setDescription('Direct audio URL (.mp3, .ogg, .wav)').setRequired(true))
        .addNumberOption(o => o.setName('volume').setDescription('Volume 0-1 (default 1)').setMinValue(0).setMaxValue(1).setRequired(false)),
    prefix: 'uploadsoundboard',
    description: 'Upload a sound to the server soundboard from a URL or attachment',
    usage: 'uploadsoundboard <name> <url>',
    aliases: ['uploadsb', 'addsound'],
    category: 'utility',

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
            const c = new ContainerBuilder().setAccentColor(0xED4245);
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Permission Denied\n> You need **Manage Expressions** permission.`));
            return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const name = interaction.options.getString('name');
        const url = interaction.options.getString('url');
        const volume = interaction.options.getNumber('volume') || 1;

        await interaction.deferReply();
        return handleUpload(interaction.editReply.bind(interaction), interaction.guild, interaction.user, name, url, volume);
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
            const c = new ContainerBuilder().setAccentColor(0xED4245);
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Permission Denied\n> You need **Manage Expressions** permission.`));
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        const name = args[0];
        const url = args[1] || message.attachments.first()?.url;

        return handleUpload(message.reply.bind(message), message.guild, message.author, name, url, 1);
    },
};
