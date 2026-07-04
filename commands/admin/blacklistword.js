const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags
} = require('discord.js');
const { loadConfig, saveConfig, getGuildConfig, getDefaultConfig } = require('../../utils/panels/automodPanel');
const { syncToDiscord } = require('../../utils/automodSync');
const { THEME, formatCheck, createFooterText } = require('../../utils/theme');
const {  EMOJIS, COLORS } = require('../../utils/responseBuilder');

function buildOk(title, desc) {
    return new ContainerBuilder()
        .setAccentColor(COLORS.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${EMOJIS.SUCCESS} ${title}\n\n${desc}`))
;
}

function buildErr(title, desc) {
    return new ContainerBuilder()
        .setAccentColor(COLORS.ERROR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${EMOJIS.ERROR} ${title}\n\n${desc}`));
}

function buildWordList(guildConfig) {
    const bw = guildConfig.badWords || {};
    const words = bw.words || [];

    let content = `# ${THEME.EMOJIS.SHIELD} Blocked Words\n\n`;
    if (words.length === 0) {
        content += '*No blocked words configured.*\n';
        content += `\n> Use \`blacklistword add <word>\` to add words.`;
    } else {
        content += `**Total:** \`${words.length}\` word(s)\n\n`;
        const preview = words.map(w => `\`${w}\``).join(', ');
        if (preview.length > 1800) {
            const shown = words.slice(0, 50).map(w => `\`${w}\``).join(', ');
            content += shown + `\n\n-# ... and ${words.length - 50} more`;
        } else {
            content += preview;
        }
    }

    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;
}

function buildConfigDisplay(guildConfig) {
    const bw = guildConfig.badWords || {};
    const wordCount = bw.words?.length || 0;
    const filterEnabled = bw.enabled || false;
    const action = bw.action || 'delete';
    const bypassRole = guildConfig.bypassRoleId ? `<@&${guildConfig.bypassRoleId}>` : '`None`';

    let content = `# ${THEME.EMOJIS.SHIELD} Blacklist Word Config\n\n`;
    content += `### Status\n`;
    content += `> ${formatCheck(filterEnabled)} **Filter:** ${filterEnabled ? 'Enabled' : 'Disabled'}\n`;
    content += `> **Word Count:** \`${wordCount}\`\n`;
    content += `> **Action:** \`${action}\`\n`;
    content += `> **Bypass Role:** ${bypassRole}\n`;
    content += `> **System:** ${formatCheck(guildConfig.enabled)} ${guildConfig.enabled ? 'Active' : 'Inactive'}`;

    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;
}

async function handleSubcommand(sub, options, guild) {
    const guildId = guild.id;
    const config = loadConfig();
    if (!config[guildId]) config[guildId] = getDefaultConfig();
    const guildConfig = getGuildConfig(guildId);

    if (!sub || sub === 'list') {
        return buildWordList(guildConfig);
    }

    if (sub === 'add') {
        const input = options.words;
        if (!input) return buildErr('Missing Words', 'Provide one or more words (comma-separated).\n\n**Usage:** `blacklistword add word1, word2`');

        const newWords = input.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0 && w.length <= 60);
        if (newWords.length === 0) return buildErr('Invalid Words', 'No valid words provided. Words must be 1-60 characters.');

        if (!config[guildId].badWords) config[guildId].badWords = { enabled: false, words: [], action: 'delete' };
        if (!config[guildId].badWords.words) config[guildId].badWords.words = [];

        const existing = new Set(config[guildId].badWords.words.map(w => w.toLowerCase()));
        const added = [];
        const skipped = [];

        for (const word of newWords) {
            if (existing.has(word)) {
                skipped.push(word);
            } else {
                config[guildId].badWords.words.push(word);
                existing.add(word);
                added.push(word);
            }
        }

        if (added.length === 0) return buildErr('No Words Added', `All words are already in the list: ${skipped.map(w => `\`${w}\``).join(', ')}`);

        saveConfig(config, guildId);
        const updatedConfig = getGuildConfig(guildId);
        await syncToDiscord(guild, updatedConfig);

        let desc = `Added **${added.length}** word(s): ${added.map(w => `\`${w}\``).join(', ')}`;
        if (skipped.length > 0) desc += `\n\nSkipped (already listed): ${skipped.map(w => `\`${w}\``).join(', ')}`;
        desc += `\n\n> Total words: **${config[guildId].badWords.words.length}**`;
        return buildOk('Words Added', desc);
    }

    if (sub === 'remove') {
        const input = options.words;
        if (!input) return buildErr('Missing Words', 'Provide one or more words (comma-separated).\n\n**Usage:** `blacklistword remove word1, word2`');

        const toRemove = input.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
        if (toRemove.length === 0) return buildErr('Invalid Words', 'No valid words provided.');

        if (!config[guildId].badWords?.words?.length) return buildErr('Empty List', 'There are no blocked words to remove.');

        const removeSet = new Set(toRemove);
        const before = config[guildId].badWords.words.length;
        config[guildId].badWords.words = config[guildId].badWords.words.filter(w => !removeSet.has(w.toLowerCase()));
        const removed = before - config[guildId].badWords.words.length;

        if (removed === 0) return buildErr('Not Found', `None of the specified words were in the list.`);

        saveConfig(config, guildId);
        const updatedConfig = getGuildConfig(guildId);
        await syncToDiscord(guild, updatedConfig);

        return buildOk('Words Removed', `Removed **${removed}** word(s).\n\n> Remaining: **${config[guildId].badWords.words.length}** word(s)`);
    }

    if (sub === 'reset') {
        if (!config[guildId].badWords) config[guildId].badWords = { enabled: false, words: [], action: 'delete' };
        const count = config[guildId].badWords.words?.length || 0;
        config[guildId].badWords.words = [];
        saveConfig(config, guildId);
        const updatedConfig = getGuildConfig(guildId);
        await syncToDiscord(guild, updatedConfig);
        return buildOk('Word List Cleared', `Removed **${count}** word(s) from the blocked list.`);
    }

    if (sub === 'config') {
        return buildConfigDisplay(guildConfig);
    }

    if (sub === 'bypass') {
        const roleId = options.roleId;
        const clear = options.clear || false;
        if (clear) {
            config[guildId].bypassRoleId = null;
            saveConfig(config, guildId);
            const updatedConfig = getGuildConfig(guildId);
            await syncToDiscord(guild, updatedConfig);
            return buildOk('Bypass Role Cleared', 'The bypass role has been removed. No role bypasses the bad words filter now.');
        }
        if (!roleId) {
            const current = guildConfig.bypassRoleId ? `<@&${guildConfig.bypassRoleId}>` : '`None`';
            return buildOk('Bypass Role', `Current bypass role: ${current}\n\n> Use \`blacklistword bypass @role\` to set a new one.\n> Use \`blacklistword bypass clear\` to remove it.`);
        }
        config[guildId].bypassRoleId = roleId;
        saveConfig(config, guildId);
        const updatedConfig = getGuildConfig(guildId);
        await syncToDiscord(guild, updatedConfig);
        return buildOk('Bypass Role Set', `<@&${roleId}> can now bypass the bad words filter.`);
    }

    return buildErr('Unknown Subcommand', 'Available: `add`, `remove`, `reset`, `config`, `bypass`');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('blacklistword')
        .setDescription('Manage the server blocked word list')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub.setName('list').setDescription('Show the current blocked word list'))
        .addSubcommand(sub => sub.setName('add').setDescription('Add words to the blocked list')
            .addStringOption(opt => opt.setName('words').setDescription('Words to add (comma-separated)').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove words from the blocked list')
            .addStringOption(opt => opt.setName('words').setDescription('Words to remove (comma-separated)').setRequired(true)))
        .addSubcommand(sub => sub.setName('reset').setDescription('Clear the entire blocked word list'))
        .addSubcommand(sub => sub.setName('config').setDescription('Show blacklist word configuration'))
        .addSubcommand(sub => sub.setName('bypass').setDescription('Set or view the bypass role')
            .addRoleOption(opt => opt.setName('role').setDescription('Role to set as bypass (leave empty to view)').setRequired(false))),

    prefix: 'blacklistword',
    description: 'Manage the server blocked word list',
    usage: 'blacklistword [add|remove|reset|config|bypass] [args]',
    category: 'admin',
    aliases: ['blw', 'badword', 'badwords'],

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const options = {};

        if (sub === 'add' || sub === 'remove') {
            options.words = interaction.options.getString('words');
        } else if (sub === 'bypass') {
            const role = interaction.options.getRole('role');
            options.roleId = role?.id || null;
        }

        const container = await handleSubcommand(sub, options, interaction.guild);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply({ components: [buildErr('Permission Denied', 'You need **Manage Server** permission.')], flags: MessageFlags.IsComponentsV2 });
        }

        const sub = args[0]?.toLowerCase();
        const options = {};

        if (!sub) {
            const guildConfig = getGuildConfig(message.guild.id);
            const container = buildWordList(guildConfig);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'add' || sub === 'remove') {
            options.words = args.slice(1).join(' ');
        } else if (sub === 'bypass') {
            if (args[1]?.toLowerCase() === 'clear') {
                options.clear = true;
            } else {
                const role = message.mentions.roles.first();
                options.roleId = role?.id || null;
            }
        }

        const container = await handleSubcommand(sub, options, message.guild);
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
