const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { isOwner } = require('../../utils/helpers');
const disabled = require('../../utils/disabledCommands');

const E = {
    ok: '<:Checkedbox:1521227734943269077>',
    no: '<:Cancel:1521227723916181644>',
    lock: '<:Lock:1521227892770734120>',
    unlock: '<:Unlock:1521228030842769610>',
    doc: '<:Document:1521227875016114266>'
};

function panel(color, text) {
    return new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}
const ok = (t) => panel(0x57F287, t);
const err = (t) => panel(0xED4245, t);

// Resolve a user-typed command/alias to its canonical name (or null if unknown).
function resolveName(client, input) {
    if (!input) return null;
    const cmd = client.commands.get(String(input).toLowerCase());
    if (!cmd) return null;
    return String(cmd.data?.name || cmd.prefix || input).toLowerCase();
}

function doDisable(client, name, reason, byId) {
    const canonical = resolveName(client, name);
    if (!canonical) return err(`${E.no} **Unknown command:** \`${name}\`\nCheck the name and try again.`);
    if (disabled.isProtected(canonical)) return err(`${E.no} \`${canonical}\` is protected and cannot be disabled.`);
    if (disabled.isDisabled(canonical)) return err(`${E.no} \`${canonical}\` is already disabled.`);
    disabled.disable(canonical, reason, byId);
    return ok(`${E.lock} **Command Disabled**\n\`${canonical}\` is now disabled for everyone (except owners).\n\n**Reason:** ${reason || 'No reason provided'}`);
}

function doEnable(client, name) {
    const canonical = resolveName(client, name) || String(name || '').toLowerCase();
    if (!disabled.enable(canonical)) return err(`${E.no} \`${canonical}\` is not disabled.`);
    return ok(`${E.unlock} **Command Enabled**\n\`${canonical}\` is available again.`);
}

function doList() {
    const all = disabled.list();
    const keys = Object.keys(all);
    if (!keys.length) return ok(`${E.doc} **No Disabled Commands**\nEvery command is currently active.`);
    const lines = keys.slice(0, 25).map(k => {
        const r = all[k];
        const ts = r?.at ? ` · <t:${Math.floor(r.at / 1000)}:R>` : '';
        return `${E.lock} \`${k}\` — ${r?.reason || 'No reason'}${ts}`;
    });
    const extra = keys.length > 25 ? `\n-# …and ${keys.length - 25} more` : '';
    return panel(0xED4245, `# ${E.doc} Disabled Commands (${keys.length})\n\n${lines.join('\n')}${extra}`);
}

module.exports = {
    ownerOnly: true,
    data: new SlashCommandBuilder()
        .setName('disablecommand')
        .setDescription('[Owner] Temporarily disable or enable any command')
        .addSubcommand(s => s.setName('disable').setDescription('Disable a command with a reason')
            .addStringOption(o => o.setName('command').setDescription('Command name to disable').setRequired(true))
            .addStringOption(o => o.setName('reason').setDescription('Why it is disabled (shown to users)').setRequired(true)))
        .addSubcommand(s => s.setName('enable').setDescription('Re-enable a disabled command')
            .addStringOption(o => o.setName('command').setDescription('Command name to enable').setRequired(true)))
        .addSubcommand(s => s.setName('list').setDescription('List all currently disabled commands')),

    prefix: 'disablecommand',
    description: '[Owner] Temporarily disable or enable any command',
    usage: 'disablecommand <disable|enable|list> [command] [reason]',
    category: 'owner',
    aliases: ['disablecmd', 'dcmd', 'blockcommand'],

    async execute(interaction) {
        if (!isOwner(interaction.user.id)) {
            return interaction.reply({ components: [err(`${E.no} This command is owner-only.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        const sub = interaction.options.getSubcommand();
        let container;
        if (sub === 'disable') {
            container = doDisable(interaction.client, interaction.options.getString('command'), interaction.options.getString('reason'), interaction.user.id);
        } else if (sub === 'enable') {
            container = doEnable(interaction.client, interaction.options.getString('command'));
        } else {
            container = doList();
        }
        return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            return message.reply({ components: [err(`${E.no} This command is owner-only.`)], flags: MessageFlags.IsComponentsV2 });
        }
        const sub = (args[0] || '').toLowerCase();
        let container;
        if (sub === 'disable') {
            const name = args[1];
            const reason = args.slice(2).join(' ');
            if (!name) container = err(`${E.no} **Usage:** \`disablecommand disable <command> <reason>\``);
            else container = doDisable(message.client, name, reason, message.author.id);
        } else if (sub === 'enable') {
            if (!args[1]) container = err(`${E.no} **Usage:** \`disablecommand enable <command>\``);
            else container = doEnable(message.client, args[1]);
        } else if (sub === 'list') {
            container = doList();
        } else {
            container = err(`${E.no} **Usage:** \`disablecommand <disable|enable|list> [command] [reason]\``);
        }
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
