const { SlashCommandBuilder, AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags } = require('discord.js');
const { isImageApiConfigured, getImageApiUrl, getUnavailableMessage } = require('./imageApiHelper');
const log = require('./logger-styled');

async function getImageUrl(message, args) {
    if (message.attachments.size > 0) {
        return { url: message.attachments.first().url, source: 'attachment' };
    }
    
    if (args[0]) {
        const userMatch = args[0].match(/^<@!?(\d+)>$/);
        if (userMatch) {
            try {
                const user = await message.client.users.fetch(userMatch[1]);
                return { url: user.displayAvatarURL({ extension: 'png', size: 512 }), source: `${user.username}'s avatar` };
            } catch {
                return { url: message.author.displayAvatarURL({ extension: 'png', size: 512 }), source: 'your avatar' };
            }
        }
        if (args[0].match(/^https?:\/\//)) {
            return { url: args[0], source: 'provided URL' };
        }
    }
    
    if (message.mentions.users.size > 0) {
        const user = message.mentions.users.first();
        return { url: user.displayAvatarURL({ extension: 'png', size: 512 }), source: `${user.username}'s avatar` };
    }
    
    return { url: message.author.displayAvatarURL({ extension: 'png', size: 512 }), source: 'your avatar' };
}

/**
 * Resolve target image URL from slash interaction.
 */
function getImageUrlFromInteraction(interaction) {
    const attachment = interaction.options.getAttachment('image');
    if (attachment) return { url: attachment.url, source: 'attachment' };

    const user = interaction.options.getUser('user');
    if (user) return { url: user.displayAvatarURL({ extension: 'png', size: 512 }), source: `${user.username}'s avatar` };

    const urlOpt = interaction.options.getString('url');
    if (urlOpt && /^https?:\/\//i.test(urlOpt)) return { url: urlOpt, source: 'provided URL' };

    return { url: interaction.user.displayAvatarURL({ extension: 'png', size: 512 }), source: 'your avatar' };
}

function createImageResponse(title, description, filename, accentColor = 0xCAD7E6) {
    const container = new ContainerBuilder()
        .setAccentColor(accentColor)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`${title}\n-# ${description}`)
        )
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(`attachment://${filename}`)
            )
        );
    return container;
}

async function executeImageCommand(message, args, options) {
    const { effectName, apiEndpoint, filename, title, accentColor = 0xCAD7E6, errorMessage } = options;
    
    if (!isImageApiConfigured()) {
        return message.reply(getUnavailableMessage());
    }

    const { url: imageUrl, source: sourceType } = await getImageUrl(message, args);

    try {
        const apiUrl = getImageApiUrl(apiEndpoint, imageUrl);
        if (!apiUrl) {
            return message.reply(getUnavailableMessage());
        }

        const attachment = new AttachmentBuilder(apiUrl, { name: filename });
        const container = createImageResponse(title, `Applied ${effectName} to ${sourceType}`, filename, accentColor);
        await message.reply({ components: [container], files: [attachment], flags: MessageFlags.IsComponentsV2 });
    } catch (error) {
        log.error(`[IMAGE] ${effectName} error:`, error.message);
        await message.reply(errorMessage || `<:Cancel:1521227723916181644> Failed to apply ${effectName}.`);
    }
}

/**
 * Create an image command module.
 *
 * By default the factory builds both a slash payload (`data`) and an
 * `execute(interaction)` handler in addition to the `executePrefix`
 * handler. Pass `prefixOnly: true` to omit the slash side of the
 * module entirely so the command only ever runs through the prefix
 * dispatcher.
 *
 * @param {object} opts
 * @param {boolean} [opts.prefixOnly=false] Skip slash registration.
 */
function createImageCommand(opts) {
    const {
        name, description, aliases = [],
        effectName, apiEndpoint, filename, title,
        accentColor = 0xCAD7E6, errorMessage,
        prefixOnly = false,
    } = opts;

    const base = {
        prefix: name,
        name,
        description,
        usage: `${name} [image|@user|url]`,
        category: 'image',
        aliases,
        dmAllowed: true,

        async executePrefix(message, args) {
            await executeImageCommand(message, args, { effectName, apiEndpoint, filename, title, accentColor, errorMessage });
        },
    };

    if (prefixOnly) {
        // Mark explicitly so the loader treats this as prefix-only.
        base.prefixOnly = true;
        return base;
    }

    base.data = new SlashCommandBuilder()
        .setName(name)
        .setDescription(description)
        .addAttachmentOption(o => o.setName('image').setDescription('Image to apply effect to').setRequired(false))
        .addUserOption(o => o.setName('user').setDescription('Use this user\'s avatar').setRequired(false))
        .addStringOption(o => o.setName('url').setDescription('Image URL').setRequired(false));

    base.execute = async function execute(interaction) {
        if (!isImageApiConfigured()) {
            return interaction.reply({ content: getUnavailableMessage(), flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply();

        const { url: imageUrl, source: sourceType } = getImageUrlFromInteraction(interaction);
        try {
            const apiUrl = getImageApiUrl(apiEndpoint, imageUrl);
            if (!apiUrl) {
                return interaction.editReply({ content: getUnavailableMessage() });
            }
            const attachment = new AttachmentBuilder(apiUrl, { name: filename });
            const container = createImageResponse(title, `Applied ${effectName} to ${sourceType}`, filename, accentColor);
            await interaction.editReply({ components: [container], files: [attachment], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            log.error(`[IMAGE] ${effectName} error:`, error.message);
            await interaction.editReply({ content: errorMessage || `<:Cancel:1521227723916181644> Failed to apply ${effectName}.` });
        }
    };

    return base;
}

module.exports = {
    getImageUrl,
    getImageUrlFromInteraction,
    createImageResponse,
    executeImageCommand,
    createImageCommand,
    isImageApiConfigured,
    getUnavailableMessage
};
