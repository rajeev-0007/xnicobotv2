const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, SeparatorBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType, ActionRowBuilder: AR, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const { checkAndExpire } = require('../../utils/panelExpiration');

function loadConfig() {
    if (!jsonStore.has('giveaways')) {
        jsonStore.write('giveaways', {});
        return {};
    }
    try {
        const data = JSON.stringify(jsonStore.read('giveaways'));
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
            jsonStore.write('giveaways', {});
            return {};
        }
        return parsed;
    } catch (e) {
        jsonStore.write('giveaways', {});
        return {};
    }
}

function saveConfig(config) {
    jsonStore.write('giveaways', config);
}

function loadSettings() {
    if (!jsonStore.has('giveaway-settings')) {
        jsonStore.write('giveaway-settings', {});
        return {};
    }
    try {
        return jsonStore.read('giveaway-settings');
    } catch (e) {
        return {};
    }
}

function saveSettings(settings) {
    jsonStore.write('giveaway-settings', settings);
}

function getGuildSettings(guildId) {
    const settings = loadSettings();
    if (!settings[guildId]) {
        settings[guildId] = {
            defaultDuration: 60,
            defaultWinners: 1,
            pingRole: null,
            dmWinners: true,
            showParticipants: true,
            requireRole: null,
            bypassRole: null
        };
        saveSettings(settings);
    }
    return settings[guildId];
}

function formatDuration(ms) {
    if (ms <= 0) return 'Ended';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function formatDurationInput(input) {
    input = input.toLowerCase().trim();
    let totalMinutes = 0;
    
    const dayMatch = input.match(/(\d+)\s*d/);
    const hourMatch = input.match(/(\d+)\s*h/);
    const minMatch = input.match(/(\d+)\s*m/);
    
    if (dayMatch) totalMinutes += parseInt(dayMatch[1]) * 24 * 60;
    if (hourMatch) totalMinutes += parseInt(hourMatch[1]) * 60;
    if (minMatch) totalMinutes += parseInt(minMatch[1]);
    
    if (totalMinutes === 0 && !isNaN(parseInt(input))) {
        totalMinutes = parseInt(input);
    }
    
    return totalMinutes;
}

function buildSetupPanel(guildSettings, guild) {
    const pingRole = guildSettings.pingRole ? guild.roles.cache.get(guildSettings.pingRole) : null;
    const requireRole = guildSettings.requireRole ? guild.roles.cache.get(guildSettings.requireRole) : null;
    const bypassRole = guildSettings.bypassRole ? guild.roles.cache.get(guildSettings.bypassRole) : null;

    let content = `# <:Present:1521228115655917659> Giveaway System Setup\n`;
    content += `-# Configure default settings and customize how giveaways work in your server\n\n`;

    content += `### <:Settings:1521227767780343879> Current Configuration\n`;
    content += `\`\`\`ansi\n`;
    content += `\u001b[1;34m╔════════════════════════════════════════════╗\n`;
    content += `\u001b[1;34m║  \u001b[1;37mGiveaway Default Settings                 \u001b[1;34m║\n`;
    content += `\u001b[1;34m╠════════════════════════════════════════════╣\n`;
    content += `\u001b[1;34m║ \u001b[1;36mDefault Duration:   \u001b[1;33m${String(guildSettings.defaultDuration + ' minutes').padEnd(18)} \u001b[1;34m║\n`;
    content += `\u001b[1;34m║ \u001b[1;36mDefault Winners:    \u001b[1;33m${String(guildSettings.defaultWinners).padEnd(18)} \u001b[1;34m║\n`;
    content += `\u001b[1;34m║ \u001b[1;36mDM Winners:         ${guildSettings.dmWinners ? '\u001b[1;32mEnabled' : '\u001b[1;31mDisabled'}              \u001b[1;34m║\n`;
    content += `\u001b[1;34m║ \u001b[1;36mShow Participants:  ${guildSettings.showParticipants ? '\u001b[1;32mEnabled' : '\u001b[1;31mDisabled'}              \u001b[1;34m║\n`;
    content += `\u001b[1;34m╚════════════════════════════════════════════╝\n`;
    content += `\`\`\`\n`;

    content += `### <:Userplus:1521227719621218477> Role Configuration\n`;
    content += `> **Ping Role:** ${pingRole ? pingRole : '*Not set*'}\n`;
    content += `> **Required Role:** ${requireRole ? requireRole : '*None (anyone can enter)*'}\n`;
    content += `> **Bypass Role:** ${bypassRole ? bypassRole : '*None*'}\n\n`;

    content += `### <:Invoice:1521227903956811836> Statistics\n`;
    const config = loadConfig();
    const guildGiveaways = config[guild.id] || {};
    const activeCount = Object.values(guildGiveaways).filter(g => !g.ended).length;
    const totalCount = Object.keys(guildGiveaways).length;
    content += `> 🎁 **Active Giveaways:** ${activeCount}\n`;
    content += `> 📈 **Total Giveaways:** ${totalCount}\n\n`;

    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('giveaway_setup_defaults')
            .setLabel('Edit Defaults')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Settings:1521227767780343879>'),
        new ButtonBuilder()
            .setCustomId('giveaway_setup_roles')
            .setLabel('Configure Roles')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Userplus:1521227719621218477>'),
        new ButtonBuilder()
            .setCustomId('giveaway_setup_toggles')
            .setLabel('Toggle Features')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:History:1521227863079256278>')
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('giveaway_create')
            .setLabel('Create Giveaway')
            .setStyle(ButtonStyle.Success)
            .setEmoji('<:Present:1521228115655917659>'),
        new ButtonBuilder()
            .setCustomId('giveaway_manage')
            .setLabel('Manage Active')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Document:1521227875016114266>'),
        new ButtonBuilder()
            .setCustomId('giveaway_setup_help')
            .setLabel('Help')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Lightbulbalt:1521227880703463675>')
    );

    container.addActionRowComponents(row1);
    container.addActionRowComponents(row2);

    return container;
}

function buildGiveawayPanel(guildConfig) {
    const activeGiveaways = Object.entries(guildConfig || {})
        .filter(([_, g]) => !g.ended && g.endTime > Date.now())
        .slice(0, 5);

    let content = `# <:Present:1521228115655917659> Giveaway Manager\n`;
    content += `-# Create and manage exciting giveaways for your server\n\n`;

    if (activeGiveaways.length > 0) {
        content += `### <:Document:1521227875016114266> Active Giveaways (${activeGiveaways.length})\n`;
        activeGiveaways.forEach(([id, g]) => {
            const timeLeft = g.endTime - Date.now();
            const status = timeLeft > 0 ? `<t:${Math.floor(g.endTime / 1000)}:R>` : '<:Alarm:1521227869047750689> Ending soon';
            content += `> 🎁 **${g.prize}** • ${g.participants?.length || 0} entries • ${status}\n`;
        });
        content += '\n';
    } else {
        content += `### <:Document:1521227875016114266> No Active Giveaways\n`;
        content += `> Create a new giveaway to get started!\n\n`;
    }

    content += `### 🛠️ Quick Actions\n`;
    content += `Use the buttons below to manage giveaways`;

    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('giveaway_create')
            .setLabel('Create Giveaway')
            .setStyle(ButtonStyle.Success)
            .setEmoji('<:Present:1521228115655917659>'),
        new ButtonBuilder()
            .setCustomId('giveaway_quick')
            .setLabel('Quick Giveaway')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Lightningalt:1521227851796447472>'),
        new ButtonBuilder()
            .setCustomId('giveaway_view')
            .setLabel('View All')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Document:1521227875016114266>')
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('giveaway_manage')
            .setLabel('Manage')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Settings:1521227767780343879>'),
        new ButtonBuilder()
            .setCustomId('giveaway_setup_open')
            .setLabel('Settings')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Settings:1521227767780343879>'),
        new ButtonBuilder()
            .setCustomId('giveaway_help')
            .setLabel('Help')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Lightbulbalt:1521227880703463675>')
    );

    container.addActionRowComponents(row1);
    container.addActionRowComponents(row2);

    return container;
}

function buildGiveawayMessage(giveaway, guildId, messageId, showDescription = true) {
    const endTimestamp = Math.floor(giveaway.endTime / 1000);
    const participantCount = giveaway.participants?.length || 0;
    const timeLeft = giveaway.endTime - Date.now();
    const isEnded = giveaway.ended || timeLeft <= 0;

    let content = `# <:Present:1521228115655917659> GIVEAWAY <:Present:1521228115655917659>\n\n`;
    content += `## 🎁 ${giveaway.prize}\n\n`;
    
    if (showDescription && giveaway.description) {
        content += `${giveaway.description}\n\n`;
    }

    if (isEnded) {
        content += `**<:Alarm:1521227869047750689> Status:** <:Cancel:1521227723916181644> ENDED\n`;
    } else {
        content += `**<:Alarm:1521227869047750689> Ends:** <t:${endTimestamp}:R> (<t:${endTimestamp}:f>)\n`;
    }
    content += `**<:Award:1521228119640375336> Winners:** ${giveaway.winners}\n`;
    content += `**<:Userplus:1521227719621218477> Entries:** ${participantCount}\n`;
    content += `**<:Bookmark:1521227835526742066> Hosted by:** <@${giveaway.hostId}>\n\n`;

    if (giveaway.requireRole) {
        content += `**<:Lock:1521227892770734120> Required Role:** <@&${giveaway.requireRole}>\n\n`;
    }

    if (!isEnded) {
        content += `-# Click the button below to enter! Good luck! 🍀`;
    } else {
        content += `-# This giveaway has ended.`;
    }

    const container = new ContainerBuilder()
        .setAccentColor(isEnded ? 0x99AAB5 : 0xE91E63)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    if (!isEnded) {
        const enterButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('giveaway_enter')
                .setLabel(`Enter Giveaway (${participantCount})`)
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Present:1521228115655917659>'),
            new ButtonBuilder()
                .setCustomId('giveaway_leave')
                .setLabel('Leave')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🚪'),
            new ButtonBuilder()
                .setCustomId('giveaway_check')
                .setLabel('Check Entry')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Checkedbox:1521227734943269077>'),
            new ButtonBuilder()
                .setCustomId('giveaway_participants')
                .setLabel('View Entries')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Userplus:1521227719621218477>')
        );
        container.addActionRowComponents(enterButton);
    }

    return container;
}

function buildEndedGiveawayMessage(giveaway, winners) {
    const winnerMentions = winners.length > 0 
        ? winners.map(w => `<@${w}>`).join(', ')
        : 'No valid entries';

    let content = `# 🎊 GIVEAWAY ENDED 🎊\n\n`;
    content += `## 🎁 ${giveaway.prize}\n\n`;
    content += `**<:Award:1521228119640375336> Winner(s):** ${winnerMentions}\n`;
    content += `**<:Userplus:1521227719621218477> Total Entries:** ${giveaway.participants?.length || 0}\n`;
    content += `**<:Bookmark:1521227835526742066> Hosted by:** <@${giveaway.hostId}>\n\n`;
    
    if (winners.length > 0) {
        content += `-# Congratulations to the winner(s)! <:Present:1521228115655917659>`;
    } else {
        content += `-# No one entered this giveaway.`;
    }

    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('giveaway_ended_info')
            .setLabel('Giveaway Ended')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
            .setEmoji('🏁')
    );
    container.addActionRowComponents(row);

    return container;
}

async function updateGiveawayMessage(client, guildId, messageId) {
    const config = loadConfig();
    const giveaway = config[guildId]?.[messageId];
    if (!giveaway) return;

    if (giveaway.ended || giveaway.endTime <= Date.now()) {
        return;
    }

    try {
        const channel = await client.channels.fetch(giveaway.channelId);
        const message = await channel.messages.fetch(messageId);
        const container = buildGiveawayMessage(giveaway, guildId, messageId);
        await message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } catch (error) {
        console.error('Error updating giveaway message:', error.message);
    }
}

async function endGiveaway(client, guildId, messageId) {
    const config = loadConfig();
    const giveaway = config[guildId]?.[messageId];
    
    if (!giveaway || giveaway.ended) return;
    
    giveaway.ended = true;
    
    try {
        const channel = await client.channels.fetch(giveaway.channelId);
        const message = await channel.messages.fetch(messageId);
        
        const winners = [];
        const participants = giveaway.participants || [];
        if (participants.length > 0) {
            const winnerCount = Math.min(giveaway.winners, participants.length);
            const participantsCopy = [...participants];
            
            for (let i = 0; i < winnerCount; i++) {
                const randomIndex = Math.floor(Math.random() * participantsCopy.length);
                winners.push(participantsCopy[randomIndex]);
                participantsCopy.splice(randomIndex, 1);
            }
        }

        giveaway.winnerIds = winners;
        saveConfig(config);

        const container = buildEndedGiveawayMessage(giveaway, winners);
        await message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
        
        if (winners.length > 0) {
            const winnerMentions = winners.map(w => `<@${w}>`).join(', ');
            const winContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# 🎊 Congratulations!\n\n${winnerMentions}\n\nYou won **${giveaway.prize}**! <:Present:1521228115655917659>`
                    )
                );
            await channel.send({ 
                components: [winContainer], 
                flags: MessageFlags.IsComponentsV2 
            });

            const settings = loadSettings();
            const guildSettings = settings[guildId];
            if (guildSettings?.dmWinners) {
                for (const winnerId of winners) {
                    try {
                        const user = await client.users.fetch(winnerId);
                        await user.send({
                            content: `<:Present:1521228115655917659> **Congratulations!** You won **${giveaway.prize}** in **${channel.guild.name}**!\n\n<:Attach:1521228039135170722> [View Giveaway](https://discord.com/channels/${guildId}/${giveaway.channelId}/${messageId})`
                        });
                    } catch (e) {}
                }
            }
        }
    } catch (error) {
        saveConfig(config);
        console.error('Error ending giveaway:', error);
    }
}

/** Restore giveaway timers after bot restart */
function restoreGiveawayTimers(client) {
    const config = loadConfig();
    let restored = 0;
    const now = Date.now();
    for (const [guildId, giveaways] of Object.entries(config)) {
        for (const [messageId, g] of Object.entries(giveaways)) {
            if (g.ended || !g.endTime) continue;
            const remaining = g.endTime - now;
            if (remaining <= 0) {
                setTimeout(() => endGiveaway(client, guildId, messageId).catch(() => {}), 1000);
                restored++;
            } else {
                setTimeout(() => endGiveaway(client, guildId, messageId).catch(() => {}), remaining);
                restored++;
            }
        }
    }
    return restored;
}

module.exports = {
    category: 'automation',
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Create and manage giveaways')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Open the giveaway management panel'))
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Create a new giveaway with full customization')
                .addStringOption(opt => opt.setName('prize').setDescription('What are you giving away?').setRequired(true))
                .addStringOption(opt => opt.setName('duration').setDescription('Duration (e.g., 1h, 2d, 30m, or minutes)').setRequired(true))
                .addIntegerOption(opt => opt.setName('winners').setDescription('Number of winners (default: 1)').setMinValue(1).setMaxValue(20))
                .addStringOption(opt => opt.setName('description').setDescription('Additional details about the giveaway'))
                .addChannelOption(opt => opt.setName('channel').setDescription('Channel to post giveaway (default: current)').addChannelTypes(ChannelType.GuildText))
                .addRoleOption(opt => opt.setName('required-role').setDescription('Role required to enter'))
                .addRoleOption(opt => opt.setName('ping-role').setDescription('Role to ping when giveaway starts')))
        .addSubcommand(sub =>
            sub.setName('end')
                .setDescription('End a giveaway early')
                .addStringOption(opt => opt.setName('message_id').setDescription('Message ID of the giveaway').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('reroll')
                .setDescription('Reroll a giveaway winner')
                .addStringOption(opt => opt.setName('message_id').setDescription('Message ID of the giveaway').setRequired(true))
                .addIntegerOption(opt => opt.setName('winners').setDescription('Number of new winners to pick').setMinValue(1).setMaxValue(10)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List active giveaways'))
        .addSubcommand(sub =>
            sub.setName('delete')
                .setDescription('Delete a giveaway completely')
                .addStringOption(opt => opt.setName('message_id').setDescription('Message ID of the giveaway').setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const config = loadConfig();
        const guildId = interaction.guild.id;
        if (!config[guildId]) config[guildId] = {};
        const guildSettings = getGuildSettings(guildId);

        if (subcommand === 'setup') {
            const container = buildSetupPanel(guildSettings, interaction.guild);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        else if (subcommand === 'create') {
            const prize = interaction.options.getString('prize');
            const durationInput = interaction.options.getString('duration');
            const winners = interaction.options.getInteger('winners') || guildSettings.defaultWinners;
            const description = interaction.options.getString('description');
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            const requiredRole = interaction.options.getRole('required-role');
            const pingRole = interaction.options.getRole('ping-role');

            const duration = formatDurationInput(durationInput);
            if (duration < 1 || duration > 10080) {
                return await interaction.reply({ 
                    content: '<:Cancel:1521227723916181644> Duration must be between 1 minute and 7 days.\n**Examples:** `30m`, `2h`, `1d`, `60`', 
                    flags: MessageFlags.Ephemeral 
                });
            }

            const endTime = Date.now() + (duration * 60 * 1000);

            const giveawayData = {
                prize,
                description: description || null,
                duration,
                winners,
                channelId: channel.id,
                hostId: interaction.user.id,
                participants: [],
                endTime,
                ended: false,
                requireRole: requiredRole?.id || null,
                pingRole: pingRole?.id || null
            };

            const tempContainer = buildGiveawayMessage(giveawayData, guildId, 'temp');
            if (pingRole) {
                tempContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${pingRole}`));
            }
            const giveawayMsg = await channel.send({ 
                components: [tempContainer], 
                flags: MessageFlags.IsComponentsV2 
            });

            giveawayData.messageId = giveawayMsg.id;
            config[guildId][giveawayMsg.id] = giveawayData;
            saveConfig(config);

            const container = buildGiveawayMessage(giveawayData, guildId, giveawayMsg.id);
            await giveawayMsg.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });

            setTimeout(() => endGiveaway(interaction.client, guildId, giveawayMsg.id).catch(() => {}), duration * 60 * 1000);

            const successContent = `# <:Checkedbox:1521227734943269077> Giveaway Created!\n\n` +
                `**Prize:** ${prize}\n` +
                `**Duration:** ${formatDuration(duration * 60 * 1000)}\n` +
                `**Winners:** ${winners}\n` +
                `**Channel:** ${channel}\n` +
                `**Ends:** <t:${Math.floor(endTime / 1000)}:R>\n\n` +
                `<:Attach:1521228039135170722> [Jump to Giveaway](https://discord.com/channels/${guildId}/${channel.id}/${giveawayMsg.id})`;

            const successContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(successContent));

            await interaction.reply({ components: [successContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        else if (subcommand === 'end') {
            const messageId = interaction.options.getString('message_id');
            const giveaway = config[guildId]?.[messageId];

            if (!giveaway) {
                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Giveaway not found! Make sure you have the correct message ID.', flags: MessageFlags.Ephemeral });
            }

            if (giveaway.ended) {
                return await interaction.reply({ content: '<:Cancel:1521227723916181644> This giveaway has already ended!', flags: MessageFlags.Ephemeral });
            }

            await endGiveaway(interaction.client, guildId, messageId);
            await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Giveaway ended successfully! Winners have been announced.', flags: MessageFlags.Ephemeral });
        }

        else if (subcommand === 'reroll') {
            const messageId = interaction.options.getString('message_id');
            const rerollCount = interaction.options.getInteger('winners') || 1;
            const giveaway = config[guildId]?.[messageId];

            if (!giveaway) {
                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Giveaway not found!', flags: MessageFlags.Ephemeral });
            }

            if (!giveaway.ended) {
                return await interaction.reply({ content: '<:Cancel:1521227723916181644> This giveaway hasn\'t ended yet!', flags: MessageFlags.Ephemeral });
            }

            if ((giveaway.participants || []).length === 0) {
                return await interaction.reply({ content: '<:Cancel:1521227723916181644> No participants to reroll!', flags: MessageFlags.Ephemeral });
            }

            const newWinners = [];
            const participantsCopy = [...giveaway.participants];
            const count = Math.min(rerollCount, participantsCopy.length);

            for (let i = 0; i < count; i++) {
                const randomIndex = Math.floor(Math.random() * participantsCopy.length);
                newWinners.push(participantsCopy[randomIndex]);
                participantsCopy.splice(randomIndex, 1);
            }

            const winnerMentions = newWinners.map(w => `<@${w}>`).join(', ');
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# 🎲 Reroll Results!\n\n**Prize:** ${giveaway.prize}\n**New Winner(s):** ${winnerMentions}\n\nCongratulations! <:Present:1521228115655917659>`
                    )
                );

            try {
                const channel = await interaction.client.channels.fetch(giveaway.channelId);
                await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch (e) {}

            await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Rerolled! New winner(s): ${winnerMentions}`, flags: MessageFlags.Ephemeral });
        }

        else if (subcommand === 'list') {
            const activeGiveaways = Object.entries(config[guildId] || {})
                .filter(([_, g]) => !g.ended && g.endTime > Date.now());

            if (activeGiveaways.length === 0) {
                return await interaction.reply({ content: '<:Document:1521227875016114266> No active giveaways in this server.', flags: MessageFlags.Ephemeral });
            }

            let content = `# <:Document:1521227875016114266> Active Giveaways (${activeGiveaways.length})\n\n`;
            activeGiveaways.forEach(([id, g], i) => {
                content += `### ${i + 1}. ${g.prize}\n`;
                content += `> <:Alarm:1521227869047750689> Ends: <t:${Math.floor(g.endTime / 1000)}:R>\n`;
                content += `> <:Award:1521228119640375336> Winners: ${g.winners}\n`;
                content += `> <:Userplus:1521227719621218477> Entries: ${g.participants?.length || 0}\n`;
                content += `> <:Attach:1521228039135170722> [Jump to Giveaway](https://discord.com/channels/${guildId}/${g.channelId}/${id})\n\n`;
            });

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        else if (subcommand === 'delete') {
            const messageId = interaction.options.getString('message_id');
            const giveaway = config[guildId]?.[messageId];

            if (!giveaway) {
                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Giveaway not found!', flags: MessageFlags.Ephemeral });
            }

            try {
                const channel = await interaction.client.channels.fetch(giveaway.channelId);
                const message = await channel.messages.fetch(messageId);
                await message.delete();
            } catch (e) {}

            delete config[guildId][messageId];
            saveConfig(config);

            await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Giveaway deleted successfully!', flags: MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('<:Cancel:1521227723916181644> You need **Manage Server** permission to use this command!');
        }

        const subcommand = args[0]?.toLowerCase();
        const config = loadConfig();
        const guildId = message.guild.id;
        if (!config[guildId]) config[guildId] = {};
        const guildSettings = getGuildSettings(guildId);

        if (!subcommand || subcommand === 'panel' || subcommand === 'setup') {
            const container = buildGiveawayPanel(config[guildId]);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (subcommand === 'settings') {
            const container = buildSetupPanel(guildSettings, message.guild);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (subcommand === 'start' || subcommand === 'create') {
            const durationInput = args[1];
            const winners = parseInt(args[2]) || 1;
            const prize = args.slice(3).join(' ');

            if (!durationInput || !prize) {
                return message.reply('<:Cancel:1521227723916181644> **Usage:** `-giveaway start <duration> <winners> <prize>`\n**Examples:**\n`-giveaway start 1h 1 Discord Nitro`\n`-giveaway start 2d 3 Steam Gift Card`\n`-giveaway start 30m 1 Custom Role`');
            }

            const duration = formatDurationInput(durationInput);
            if (duration < 1 || duration > 10080) {
                return message.reply('<:Cancel:1521227723916181644> Duration must be between 1 minute and 7 days.\n**Examples:** `30m`, `2h`, `1d`');
            }

            const endTime = Date.now() + (duration * 60 * 1000);

            const giveawayData = {
                prize,
                duration,
                winners,
                channelId: message.channel.id,
                hostId: message.author.id,
                participants: [],
                endTime,
                ended: false
            };

            const tempContainer = buildGiveawayMessage(giveawayData, guildId, 'temp');
            const giveawayMsg = await message.channel.send({ 
                components: [tempContainer], 
                flags: MessageFlags.IsComponentsV2 
            });

            giveawayData.messageId = giveawayMsg.id;
            config[guildId][giveawayMsg.id] = giveawayData;
            saveConfig(config);

            const container = buildGiveawayMessage(giveawayData, guildId, giveawayMsg.id);
            await giveawayMsg.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });

            setTimeout(() => endGiveaway(message.client, guildId, giveawayMsg.id).catch(() => {}), duration * 60 * 1000);

            await message.reply(`<:Checkedbox:1521227734943269077> Giveaway for **${prize}** started! Duration: ${formatDuration(duration * 60 * 1000)}`);
        }

        else if (subcommand === 'end') {
            const messageId = args[1];
            if (!messageId) {
                return message.reply('<:Cancel:1521227723916181644> **Usage:** `-giveaway end <message_id>`');
            }

            const giveaway = config[guildId]?.[messageId];
            if (!giveaway) {
                return message.reply('<:Cancel:1521227723916181644> Giveaway not found!');
            }

            await endGiveaway(message.client, guildId, messageId);
            await message.reply('<:Checkedbox:1521227734943269077> Giveaway ended!');
        }

        else if (subcommand === 'reroll') {
            const messageId = args[1];
            const count = parseInt(args[2]) || 1;
            if (!messageId) {
                return message.reply('<:Cancel:1521227723916181644> **Usage:** `-giveaway reroll <message_id> [count]`');
            }

            const giveaway = config[guildId]?.[messageId];
            if (!giveaway) {
                return message.reply('<:Cancel:1521227723916181644> Giveaway not found!');
            }

            if (!giveaway.ended) {
                return message.reply('<:Cancel:1521227723916181644> This giveaway hasn\'t ended yet!');
            }

            if (giveaway.participants.length === 0) {
                return message.reply('<:Cancel:1521227723916181644> No participants to reroll!');
            }

            const newWinners = [];
            const participantsCopy = [...giveaway.participants];
            const winCount = Math.min(count, participantsCopy.length);

            for (let i = 0; i < winCount; i++) {
                const randomIndex = Math.floor(Math.random() * participantsCopy.length);
                newWinners.push(participantsCopy[randomIndex]);
                participantsCopy.splice(randomIndex, 1);
            }

            const winnerMentions = newWinners.map(w => `<@${w}>`).join(', ');
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# 🎲 Reroll Results!\n\n**Prize:** ${giveaway.prize}\n**New Winner(s):** ${winnerMentions}\n\nCongratulations! <:Present:1521228115655917659>`
                    )
                );

            await message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
            await message.reply('<:Checkedbox:1521227734943269077> Giveaway rerolled!');
        }

        else if (subcommand === 'list') {
            const activeGiveaways = Object.entries(config[guildId] || {})
                .filter(([_, g]) => !g.ended && g.endTime > Date.now());

            if (activeGiveaways.length === 0) {
                return message.reply('<:Document:1521227875016114266> No active giveaways in this server.');
            }

            let content = `# <:Document:1521227875016114266> Active Giveaways\n\n`;
            activeGiveaways.forEach(([id, g], i) => {
                content += `**${i + 1}. ${g.prize}**\n`;
                content += `> <:Alarm:1521227869047750689> Ends: <t:${Math.floor(g.endTime / 1000)}:R>\n`;
                content += `> <:Userplus:1521227719621218477> Entries: ${g.participants?.length || 0}\n`;
                content += `> <:Attach:1521228039135170722> [Jump](https://discord.com/channels/${guildId}/${g.channelId}/${id})\n\n`;
            });

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        else if (subcommand === 'delete') {
            const messageId = args[1];
            if (!messageId) {
                return message.reply('<:Cancel:1521227723916181644> **Usage:** `-giveaway delete <message_id>`');
            }

            const giveaway = config[guildId]?.[messageId];
            if (!giveaway) {
                return message.reply('<:Cancel:1521227723916181644> Giveaway not found!');
            }

            try {
                const channel = await message.client.channels.fetch(giveaway.channelId);
                const msg = await channel.messages.fetch(messageId);
                await msg.delete();
            } catch (e) {}

            delete config[guildId][messageId];
            saveConfig(config);

            await message.reply('<:Checkedbox:1521227734943269077> Giveaway deleted!');
        }

        else if (subcommand === 'help') {
            const helpContent = `# <:Present:1521228115655917659> Giveaway System Help\n\n` +
                `### <:Document:1521227875016114266> Commands\n` +
                `\`-giveaway\` - Open management panel\n` +
                `\`-giveaway settings\` - Configure giveaway settings\n` +
                `\`-giveaway start <duration> <winners> <prize>\` - Create giveaway\n` +
                `\`-giveaway end <message_id>\` - End a giveaway\n` +
                `\`-giveaway reroll <message_id> [count]\` - Pick new winner(s)\n` +
                `\`-giveaway list\` - View active giveaways\n` +
                `\`-giveaway delete <message_id>\` - Delete a giveaway\n\n` +
                `### <:Timer:1521227971590095070> Duration Examples\n` +
                `\`30m\` - 30 minutes\n` +
                `\`2h\` - 2 hours\n` +
                `\`1d\` - 1 day\n` +
                `\`1d12h\` - 1 day and 12 hours\n\n` +
                `### <:Edit:1521227886634205298> Examples\n` +
                `\`-giveaway start 1h 1 Discord Nitro\`\n` +
                `\`-giveaway start 2d 3 Steam Gift Card\``;

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(helpContent));

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        else {
            await message.reply('<:Cancel:1521227723916181644> Unknown subcommand. Use `-giveaway help` for usage information.');
        }
    },

    async handleInteraction(interaction) {
        if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu() && !interaction.isRoleSelectMenu()) return false;

        const customId = interaction.customId;
        if (!customId.startsWith('giveaway_')) return false;

        // Check if setup session has expired (skip for user-facing giveaway buttons)
        // User-facing buttons: giveaway_enter, giveaway_leave, giveaway_check, giveaway_participants
        const userFacingButtons = ['giveaway_enter', 'giveaway_leave', 'giveaway_check', 'giveaway_participants'];
        if (!userFacingButtons.includes(customId) && await checkAndExpire(interaction, 'config')) return true;

        const config = loadConfig();
        const guildId = interaction.guild.id;
        if (!config[guildId]) config[guildId] = {};

        if (customId === 'giveaway_enter') {
            const giveaway = config[guildId]?.[interaction.message.id];

            if (!giveaway) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Giveaway data not found! It may have been deleted.', flags: MessageFlags.Ephemeral });
                return true;
            }

            if (giveaway.ended || giveaway.endTime <= Date.now()) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> This giveaway has ended!', flags: MessageFlags.Ephemeral });
                return true;
            }

            if (giveaway.requireRole && !interaction.member.roles.cache.has(giveaway.requireRole)) {
                await interaction.reply({ content: `<:Cancel:1521227723916181644> You need the <@&${giveaway.requireRole}> role to enter this giveaway!`, flags: MessageFlags.Ephemeral });
                return true;
            }

            if (giveaway.participants.includes(interaction.user.id)) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> You\'ve already entered this giveaway!', flags: MessageFlags.Ephemeral });
                return true;
            }

            giveaway.participants.push(interaction.user.id);
            saveConfig(config);

            await interaction.reply({ content: '<:Present:1521228115655917659> You\'ve entered the giveaway! Good luck! 🍀', flags: MessageFlags.Ephemeral });
            updateGiveawayMessage(interaction.client, guildId, interaction.message.id).catch(() => {});
            return true;
        }

        if (customId === 'giveaway_leave') {
            const giveaway = config[guildId]?.[interaction.message.id];

            if (!giveaway || giveaway.ended) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> This giveaway has ended!', flags: MessageFlags.Ephemeral });
                return true;
            }

            const index = giveaway.participants.indexOf(interaction.user.id);
            if (index === -1) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> You haven\'t entered this giveaway!', flags: MessageFlags.Ephemeral });
                return true;
            }

            giveaway.participants.splice(index, 1);
            saveConfig(config);

            await interaction.reply({ content: '🚪 You\'ve left the giveaway.', flags: MessageFlags.Ephemeral });
            updateGiveawayMessage(interaction.client, guildId, interaction.message.id).catch(() => {});
            return true;
        }

        if (customId === 'giveaway_check') {
            const giveaway = config[guildId]?.[interaction.message.id];

            if (!giveaway) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Giveaway not found!', flags: MessageFlags.Ephemeral });
                return true;
            }

            const participants = giveaway.participants || [];
            const isEntered = participants.includes(interaction.user.id);
            const position = isEntered ? participants.indexOf(interaction.user.id) + 1 : null;
            const isEnded = giveaway.ended || giveaway.endTime <= Date.now();
            
            let content;
            if (isEntered && isEnded) {
                content = `<:Checkedbox:1521227734943269077> **You were entered!**\n\n**Prize:** ${giveaway.prize}\n**Your Entry #:** ${position} of ${participants.length}\n\nThis giveaway has ended.`;
            } else if (isEntered) {
                content = `<:Checkedbox:1521227734943269077> **You're entered!**\n\n**Prize:** ${giveaway.prize}\n**Your Entry #:** ${position} of ${participants.length}\n**Ends:** <t:${Math.floor(giveaway.endTime / 1000)}:R>\n\nGood luck! 🍀`;
            } else {
                content = '<:Cancel:1521227723916181644> You haven\'t entered this giveaway yet.\n\nClick the **Enter Giveaway** button to participate!';
            }

            await interaction.reply({ content, flags: MessageFlags.Ephemeral });
            return true;
        }

        if (customId === 'giveaway_participants') {
            const giveaway = config[guildId]?.[interaction.message.id];

            if (!giveaway) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Giveaway not found!', flags: MessageFlags.Ephemeral });
                return true;
            }

            const count = giveaway.participants.length;
            if (count === 0) {
                await interaction.reply({ content: '<:Userplus:1521227719621218477> **No entries yet!**\n\nBe the first to enter this giveaway!', flags: MessageFlags.Ephemeral });
                return true;
            }

            // Build all participant lines (newest first)
            const PER_PAGE = 15;
            const allLines = [...giveaway.participants].reverse().map((id, i) => `**${count - i}.** <@${id}>`);
            const totalPages = Math.ceil(allLines.length / PER_PAGE);
            let currentPage = 0;
            const btnPrefix = `gp_${Date.now().toString(36)}`;

            function buildParticipantPage(page) {
                const start = page * PER_PAGE;
                const pageLines = allLines.slice(start, start + PER_PAGE);
                let content = `<:Userplus:1521227719621218477> **Giveaway Entries (${count})**\n\n${pageLines.join('\n')}`;
                if (totalPages > 1) content += `\n\n-# Page ${page + 1}/${totalPages}`;
                return content;
            }

            if (totalPages <= 1) {
                await interaction.reply({ content: buildParticipantPage(0), flags: MessageFlags.Ephemeral });
                return true;
            }

            // Multi-page with buttons
                        function participantButtons(page) {
                return new AR().addComponents(
                    new BB().setCustomId(`${btnPrefix}_prev`).setEmoji('<:History:1521227863079256278>').setLabel('Prev').setStyle(BS.Primary).setDisabled(page === 0),
                    new BB().setCustomId(`${btnPrefix}_ind`).setLabel(`${page + 1} / ${totalPages}`).setStyle(BS.Secondary).setDisabled(true),
                    new BB().setCustomId(`${btnPrefix}_next`).setEmoji('<:Caretright:1521227704953864202>').setLabel('Next').setStyle(BS.Primary).setDisabled(page >= totalPages - 1)
                );
            }

            const reply = await interaction.reply({
                content: buildParticipantPage(0),
                components: [participantButtons(0)],
                flags: MessageFlags.Ephemeral,
                fetchReply: true
            });

            const collector = reply.createMessageComponentCollector({
                filter: i => i.customId.startsWith(btnPrefix) && i.user.id === interaction.user.id,
                time: 120_000
            });

            collector.on('collect', async (i) => {
                const action = i.customId.replace(`${btnPrefix}_`, '');
                if (action === 'prev') currentPage = Math.max(0, currentPage - 1);
                else if (action === 'next') currentPage = Math.min(totalPages - 1, currentPage + 1);
                await i.update({ content: buildParticipantPage(currentPage), components: [participantButtons(currentPage)] }).catch(() => {});
            });
            
            return true;
        }

        if (customId === 'giveaway_create') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> You need **Manage Server** permission!', flags: MessageFlags.Ephemeral });
                return true;
            }

            const modal = new ModalBuilder()
                .setCustomId('giveaway_create_modal')
                .setTitle('Create Giveaway');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('prize')
                        .setLabel('Prize')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('What are you giving away? (e.g., Discord Nitro)')
                        .setMaxLength(100)
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('duration')
                        .setLabel('Duration (e.g., 1h, 2d, 30m)')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Examples: 30m, 2h, 1d, 1d12h')
                        .setMaxLength(10)
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('winners')
                        .setLabel('Number of Winners')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Default: 1')
                        .setMaxLength(2)
                        .setRequired(false)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('description')
                        .setLabel('Description (optional)')
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder('Additional details about the giveaway...')
                        .setMaxLength(500)
                        .setRequired(false)
                )
            );

            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'giveaway_create_modal' && interaction.isModalSubmit()) {
            const prize = interaction.fields.getTextInputValue('prize').trim();
            const durationStr = interaction.fields.getTextInputValue('duration').trim();
            const winnersStr = interaction.fields.getTextInputValue('winners').trim();
            const description = interaction.fields.getTextInputValue('description').trim();

            const duration = formatDurationInput(durationStr);
            const winners = parseInt(winnersStr) || 1;

            if (duration < 1 || duration > 10080) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Duration must be between 1 minute and 7 days.\n**Examples:** `30m`, `2h`, `1d`', flags: MessageFlags.Ephemeral });
                return true;
            }

            if (winners < 1 || winners > 20) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Winners must be between 1 and 20.', flags: MessageFlags.Ephemeral });
                return true;
            }

            const endTime = Date.now() + (duration * 60 * 1000);

            const giveawayData = {
                prize,
                description: description || null,
                duration,
                winners,
                channelId: interaction.channel.id,
                hostId: interaction.user.id,
                participants: [],
                endTime,
                ended: false
            };

            const tempContainer = buildGiveawayMessage(giveawayData, guildId, 'temp');
            const giveawayMsg = await interaction.channel.send({ 
                components: [tempContainer], 
                flags: MessageFlags.IsComponentsV2 
            });

            giveawayData.messageId = giveawayMsg.id;
            config[guildId][giveawayMsg.id] = giveawayData;
            saveConfig(config);

            const container = buildGiveawayMessage(giveawayData, guildId, giveawayMsg.id);
            await giveawayMsg.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });

            setTimeout(() => endGiveaway(interaction.client, guildId, giveawayMsg.id).catch(() => {}), duration * 60 * 1000);

            await interaction.reply({ 
                content: `<:Checkedbox:1521227734943269077> Giveaway created!\n\n**Prize:** ${prize}\n**Duration:** ${formatDuration(duration * 60 * 1000)}\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor(endTime / 1000)}:R>`, 
                flags: MessageFlags.Ephemeral 
            });

            try {
                const panelContainer = buildGiveawayPanel(config[guildId]);
                await interaction.message.edit({ components: [panelContainer], flags: MessageFlags.IsComponentsV2 });
            } catch (e) {}

            return true;
        }

        if (customId === 'giveaway_quick') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> You need **Manage Server** permission!', flags: MessageFlags.Ephemeral });
                return true;
            }

            const guildSettings = getGuildSettings(guildId);

            const modal = new ModalBuilder()
                .setCustomId('giveaway_quick_modal')
                .setTitle('Quick Giveaway (1 Hour)');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('prize')
                        .setLabel('Prize')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('What are you giving away?')
                        .setRequired(true)
                )
            );

            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'giveaway_quick_modal' && interaction.isModalSubmit()) {
            const prize = interaction.fields.getTextInputValue('prize').trim();
            const guildSettings = getGuildSettings(guildId);
            const duration = guildSettings.defaultDuration || 60;
            const winners = guildSettings.defaultWinners || 1;
            const endTime = Date.now() + (duration * 60 * 1000);

            const giveawayData = {
                prize,
                duration,
                winners,
                channelId: interaction.channel.id,
                hostId: interaction.user.id,
                participants: [],
                endTime,
                ended: false
            };

            const tempContainer = buildGiveawayMessage(giveawayData, guildId, 'temp');
            const giveawayMsg = await interaction.channel.send({ 
                components: [tempContainer], 
                flags: MessageFlags.IsComponentsV2 
            });

            giveawayData.messageId = giveawayMsg.id;
            config[guildId][giveawayMsg.id] = giveawayData;
            saveConfig(config);

            const container = buildGiveawayMessage(giveawayData, guildId, giveawayMsg.id);
            await giveawayMsg.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });

            setTimeout(() => endGiveaway(interaction.client, guildId, giveawayMsg.id).catch(() => {}), duration * 60 * 1000);

            await interaction.reply({ 
                content: `<:Lightningalt:1521227851796447472> Quick giveaway created for **${prize}**!\nDuration: ${formatDuration(duration * 60 * 1000)} • Winners: ${winners}`, 
                flags: MessageFlags.Ephemeral 
            });

            try {
                const panelContainer = buildGiveawayPanel(config[guildId]);
                await interaction.message.edit({ components: [panelContainer], flags: MessageFlags.IsComponentsV2 });
            } catch (e) {}

            return true;
        }

        if (customId === 'giveaway_view') {
            const activeGiveaways = Object.entries(config[guildId] || {})
                .filter(([_, g]) => !g.ended && g.endTime > Date.now());

            if (activeGiveaways.length === 0) {
                await interaction.reply({ content: '<:Document:1521227875016114266> No active giveaways in this server.', flags: MessageFlags.Ephemeral });
                return true;
            }

            let content = `# <:Document:1521227875016114266> Active Giveaways (${activeGiveaways.length})\n\n`;
            activeGiveaways.forEach(([id, g], i) => {
                content += `### ${i + 1}. ${g.prize}\n`;
                content += `> <:Alarm:1521227869047750689> Ends: <t:${Math.floor(g.endTime / 1000)}:R>\n`;
                content += `> <:Award:1521228119640375336> Winners: ${g.winners}\n`;
                content += `> <:Userplus:1521227719621218477> Entries: ${g.participants?.length || 0}\n`;
                content += `> <:Attach:1521228039135170722> [Jump](https://discord.com/channels/${guildId}/${g.channelId}/${id})\n\n`;
            });

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        if (customId === 'giveaway_manage') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> You need **Manage Server** permission!', flags: MessageFlags.Ephemeral });
                return true;
            }

            const activeGiveaways = Object.entries(config[guildId] || {})
                .filter(([_, g]) => !g.ended && g.endTime > Date.now());

            if (activeGiveaways.length === 0) {
                await interaction.reply({ content: '<:Document:1521227875016114266> No active giveaways to manage.', flags: MessageFlags.Ephemeral });
                return true;
            }

            const options = activeGiveaways.slice(0, 25).map(([id, g]) => ({
                label: g.prize.substring(0, 50),
                description: `${g.participants?.length || 0} entries • Ends ${formatDuration(g.endTime - Date.now())}`,
                value: id
            }));

            const select = new StringSelectMenuBuilder()
                .setCustomId('giveaway_manage_select')
                .setPlaceholder('Select a giveaway to manage...')
                .addOptions(options);

            await interaction.reply({
                content: '<:Settings:1521227767780343879> **Select a giveaway to manage:**',
                components: [new ActionRowBuilder().addComponents(select)],
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'giveaway_manage_select' && interaction.isStringSelectMenu()) {
            const messageId = interaction.values[0];
            const giveaway = config[guildId]?.[messageId];

            if (!giveaway) {
                await interaction.update({ content: '<:Cancel:1521227723916181644> Giveaway not found!', components: [] });
                return true;
            }

            let content = `### Managing: ${giveaway.prize}\n`;
            content += `**Entries:** ${giveaway.participants?.length || 0}\n`;
            content += `**Ends:** <t:${Math.floor(giveaway.endTime / 1000)}:R>\n`;
            content += `**Host:** <@${giveaway.hostId}>`;

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`giveaway_action_end_${messageId}`)
                    .setLabel('End Now')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('<:Cancel:1521227723916181644>'),
                new ButtonBuilder()
                    .setCustomId(`giveaway_action_delete_${messageId}`)
                    .setLabel('Delete')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('<:Trash:1521227750420254820>'),
                new ButtonBuilder()
                    .setCustomId('giveaway_manage_back')
                    .setLabel('Back')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('<:Caretleft:1521227977495543838>')
            );

            await interaction.update({ content, components: [row] });
            return true;
        }

        if (customId === 'giveaway_manage_back') {
            const activeGiveaways = Object.entries(config[guildId] || {})
                .filter(([_, g]) => !g.ended && g.endTime > Date.now());

            if (activeGiveaways.length === 0) {
                await interaction.update({ content: '<:Document:1521227875016114266> No active giveaways to manage.', components: [] });
                return true;
            }

            const options = activeGiveaways.slice(0, 25).map(([id, g]) => ({
                label: g.prize.substring(0, 50),
                description: `${g.participants?.length || 0} entries`,
                value: id
            }));

            const select = new StringSelectMenuBuilder()
                .setCustomId('giveaway_manage_select')
                .setPlaceholder('Select a giveaway to manage...')
                .addOptions(options);

            await interaction.update({
                content: '<:Settings:1521227767780343879> **Select a giveaway to manage:**',
                components: [new ActionRowBuilder().addComponents(select)]
            });
            return true;
        }

        if (customId.startsWith('giveaway_action_end_')) {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> You need **Manage Server** permission!', flags: MessageFlags.Ephemeral });
                return true;
            }
            const messageId = customId.replace('giveaway_action_end_', '');
            await endGiveaway(interaction.client, guildId, messageId);
            await interaction.update({ content: '<:Checkedbox:1521227734943269077> Giveaway ended! Winners have been announced.', components: [] });
            return true;
        }

        if (customId.startsWith('giveaway_action_delete_')) {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> You need **Manage Server** permission!', flags: MessageFlags.Ephemeral });
                return true;
            }
            const messageId = customId.replace('giveaway_action_delete_', '');
            const giveaway = config[guildId]?.[messageId];

            if (giveaway) {
                try {
                    const channel = await interaction.client.channels.fetch(giveaway.channelId);
                    const message = await channel.messages.fetch(messageId);
                    await message.delete();
                } catch (e) {}

                delete config[guildId][messageId];
                saveConfig(config);
            }

            await interaction.update({ content: '<:Checkedbox:1521227734943269077> Giveaway deleted!', components: [] });
            return true;
        }

        if (customId === 'giveaway_setup_open') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> You need **Manage Server** permission!', flags: MessageFlags.Ephemeral });
                return true;
            }

            const guildSettings = getGuildSettings(guildId);
            const container = buildSetupPanel(guildSettings, interaction.guild);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        if (customId === 'giveaway_setup_defaults') {
            const modal = new ModalBuilder()
                .setCustomId('giveaway_defaults_modal')
                .setTitle('Edit Default Settings');

            const guildSettings = getGuildSettings(guildId);

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('default_duration')
                        .setLabel('Default Duration (in minutes)')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('e.g., 60 for 1 hour')
                        .setValue(String(guildSettings.defaultDuration))
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('default_winners')
                        .setLabel('Default Number of Winners')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('e.g., 1')
                        .setValue(String(guildSettings.defaultWinners))
                        .setRequired(true)
                )
            );

            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'giveaway_defaults_modal' && interaction.isModalSubmit()) {
            const settings = loadSettings();
            if (!settings[guildId]) settings[guildId] = getGuildSettings(guildId);

            const duration = parseInt(interaction.fields.getTextInputValue('default_duration')) || 60;
            const winners = parseInt(interaction.fields.getTextInputValue('default_winners')) || 1;

            settings[guildId].defaultDuration = Math.max(1, Math.min(10080, duration));
            settings[guildId].defaultWinners = Math.max(1, Math.min(20, winners));
            saveSettings(settings);

            await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Defaults updated!\n**Duration:** ${settings[guildId].defaultDuration} minutes\n**Winners:** ${settings[guildId].defaultWinners}`, flags: MessageFlags.Ephemeral });

            try {
                const container = buildSetupPanel(settings[guildId], interaction.guild);
                await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch (e) {}
            return true;
        }

        if (customId === 'giveaway_setup_toggles') {
            const settings = loadSettings();
            if (!settings[guildId]) settings[guildId] = getGuildSettings(guildId);
            const guildSettings = settings[guildId];

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('giveaway_toggle_dm')
                    .setLabel(guildSettings.dmWinners ? 'DM Winners: ON' : 'DM Winners: OFF')
                    .setStyle(guildSettings.dmWinners ? ButtonStyle.Success : ButtonStyle.Danger)
                    .setEmoji('<:Editalt:1521227921673556019>'),
                new ButtonBuilder()
                    .setCustomId('giveaway_toggle_show')
                    .setLabel(guildSettings.showParticipants ? 'Show Entries: ON' : 'Show Entries: OFF')
                    .setStyle(guildSettings.showParticipants ? ButtonStyle.Success : ButtonStyle.Danger)
                    .setEmoji('<:Userplus:1521227719621218477>')
            );

            await interaction.reply({
                content: '<:History:1521227863079256278> **Toggle Features:**',
                components: [row],
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'giveaway_toggle_dm') {
            const settings = loadSettings();
            if (!settings[guildId]) settings[guildId] = getGuildSettings(guildId);

            settings[guildId].dmWinners = !settings[guildId].dmWinners;
            saveSettings(settings);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('giveaway_toggle_dm')
                    .setLabel(settings[guildId].dmWinners ? 'DM Winners: ON' : 'DM Winners: OFF')
                    .setStyle(settings[guildId].dmWinners ? ButtonStyle.Success : ButtonStyle.Danger)
                    .setEmoji('<:Editalt:1521227921673556019>'),
                new ButtonBuilder()
                    .setCustomId('giveaway_toggle_show')
                    .setLabel(settings[guildId].showParticipants ? 'Show Entries: ON' : 'Show Entries: OFF')
                    .setStyle(settings[guildId].showParticipants ? ButtonStyle.Success : ButtonStyle.Danger)
                    .setEmoji('<:Userplus:1521227719621218477>')
            );

            await interaction.update({ components: [row] });
            return true;
        }

        if (customId === 'giveaway_toggle_show') {
            const settings = loadSettings();
            if (!settings[guildId]) settings[guildId] = getGuildSettings(guildId);

            settings[guildId].showParticipants = !settings[guildId].showParticipants;
            saveSettings(settings);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('giveaway_toggle_dm')
                    .setLabel(settings[guildId].dmWinners ? 'DM Winners: ON' : 'DM Winners: OFF')
                    .setStyle(settings[guildId].dmWinners ? ButtonStyle.Success : ButtonStyle.Danger)
                    .setEmoji('<:Editalt:1521227921673556019>'),
                new ButtonBuilder()
                    .setCustomId('giveaway_toggle_show')
                    .setLabel(settings[guildId].showParticipants ? 'Show Entries: ON' : 'Show Entries: OFF')
                    .setStyle(settings[guildId].showParticipants ? ButtonStyle.Success : ButtonStyle.Danger)
                    .setEmoji('<:Userplus:1521227719621218477>')
            );

            await interaction.update({ components: [row] });
            return true;
        }

        if (customId === 'giveaway_setup_roles') {
            await interaction.reply({
                content: '<:Userplus:1521227719621218477> **Role Configuration:**\nUse the slash command `/giveaway create` with role options to set required/ping roles for specific giveaways.\n\nGlobal role settings coming soon!',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (customId === 'giveaway_help' || customId === 'giveaway_setup_help') {
            const helpText = `# <:Present:1521228115655917659> Giveaway System Help

## <:Star:1521227981685526568> Features
• **Create Giveaways** - Full customization with duration, winners, description
• **Quick Giveaway** - One-click creation with default settings
• **Leave Giveaway** - Users can withdraw their entry
• **View Entries** - See who has entered
• **DM Winners** - Automatically notify winners via DM
• **Role Requirements** - Require specific roles to enter

## <:Document:1521227875016114266> Slash Commands
\`/giveaway setup\` - Open settings panel
\`/giveaway create\` - Create with full options
\`/giveaway end <id>\` - End early
\`/giveaway reroll <id>\` - Pick new winner
\`/giveaway list\` - View active
\`/giveaway delete <id>\` - Remove completely

## <:Timer:1521227971590095070> Duration Format
\`30m\` - 30 minutes
\`2h\` - 2 hours
\`1d\` - 1 day
\`1d12h\` - 1 day and 12 hours

## <:Settings:1521227767780343879> Settings Panel
• Edit default duration and winners
• Toggle DM notifications
• Configure role requirements

-# Giveaways automatically end and pick winners!`;

            await interaction.reply({ content: helpText, flags: MessageFlags.Ephemeral });
            return true;
        }

        return false;
    },

    endGiveaway,
    updateGiveawayMessage,
    loadConfig,
    saveConfig,
    restoreGiveawayTimers
};
