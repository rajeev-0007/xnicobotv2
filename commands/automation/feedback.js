const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ContainerBuilder,
    SectionBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
} = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const log = require('../../utils/logger-styled');

const STORE_KEY = 'feedback';
const CV2 = MessageFlags.IsComponentsV2;

/* ─── Custom emojis ─── */
const E = {
    feedback  : '<:Lightbulbalt:1521227880703463675>',
    star      : '<:Star:1521227981685526568>',
    starOn    : '⭐',
    starOff   : '☆',
    user      : '<:User:1521227714227343380>',
    clock     : '<:Clock:1521228110408847623>',
    check     : '<:Checkedbox:1521227734943269077>',
    cancel    : '<:Cancel:1521227723916181644>',
    channel   : '<:Bullhorn:1521227936575914016>',
    chat      : '<:Hashtag:1521227771957870604>',
    trash     : '<:Trash:1521227750420254820>',
    edit      : '<:Edit:1521227886634205298>',
    info      : '<:Inforect:1521228008285929532>',
    fire      : '<:Fire:1521227907647668374>',
    comment   : '<:Commentblock:1521227898101432331>',
    settings  : '<:Settings:1521227767780343879>',
    stats     : '<:Lightning:1521227915537285150>',
    document  : '<:Document:1521227875016114266>',
};

/* ─── Store helpers ─── */
function getStore() {
    return jsonStore.read(STORE_KEY) || {};
}

function saveStore(data) {
    jsonStore.write(STORE_KEY, data);
}

function getGuildData(guildId) {
    const store = getStore();
    if (!store[guildId]) {
        store[guildId] = {
            channelId    : null,
            logsChannelId: null,
            totalCount   : 0,
            ratings      : { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        };
        saveStore(store);
    }
    return { store, guildData: store[guildId] };
}

function buildStarsBar(rating) {
    const n = Math.min(Math.max(parseInt(rating) || 0, 0), 5);
    return '⭐'.repeat(n) + '☆'.repeat(5 - n);
}

function avgRating(ratings) {
    let total = 0, count = 0;
    for (let i = 1; i <= 5; i++) {
        total += i * (ratings[i] || 0);
        count += (ratings[i] || 0);
    }
    return count === 0 ? 0 : (total / count);
}

/* ─── Cards ─── */
function buildFeedbackCard({ rating, review, imageUrl, user, feedbackNumber }) {
    const stars  = buildStarsBar(rating);
    const avatar = user.displayAvatarURL({ size: 256, extension: 'png' });
    const time   = new Date().toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
    const accent = rating >= 4 ? 0x57F287 : rating === 3 ? 0xFEE75C : 0xED4245;
    const ratingLabel = ['', 'Terrible', 'Bad', 'Average', 'Good', 'Excellent'][rating] || 'Rated';

    const c = new ContainerBuilder().setAccentColor(accent);

    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `## ${E.feedback} Feedback #${String(feedbackNumber).padStart(4, '0')}\n` +
            `-# ${ratingLabel} experience`
        )
    );

    c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    c.addSectionComponents(
        new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `${stars}  **${rating} / 5**\n\n` +
                    `> *"${review}"*`
                )
            )
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar))
    );

    c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${E.user} **${user.username}**  \`${user.id}\`\n` +
            `-# ${E.clock} ${time}`
        )
    );

    if (imageUrl && imageUrl.startsWith('http')) {
        try {
            c.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
            c.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL(imageUrl)
                )
            );
        } catch (_) {}
    }

    c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    c.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('fb_open_modal')
                .setLabel('Leave a Review Too')
                .setEmoji('<:Star:1521227981685526568>')
                .setStyle(ButtonStyle.Secondary)
        )
    );

    return c;
}

function buildPanel(guild) {
    const botAvatar = guild.client.user.displayAvatarURL({ size: 256, extension: 'png' });

    const c = new ContainerBuilder();

    c.addSectionComponents(
        new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# ${E.feedback} Share Your Feedback\n` +
                    `Your honest opinion helps us improve.\n` +
                    `-# Every review is read by the team.`
                )
            )
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatar))
    );

    c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${E.star} Rate your experience from **1** to **5** stars\n` +
            `${E.comment} Write a short honest review\n` +
            `-# Takes less than a minute.`
        )
    );

    c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    c.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('fb_open_modal')
                .setLabel('Write Your Review')
                .setEmoji('<:Star:1521227981685526568>')
                .setStyle(ButtonStyle.Primary)
        )
    );

    return c;
}

function buildSetupPanel(guildId) {
    const { guildData } = getGuildData(guildId);
    const ch   = guildData.channelId     ? `<#${guildData.channelId}>`      : '`Not configured`';
    const logs = guildData.logsChannelId ? `<#${guildData.logsChannelId}>` : '`Not configured`';
    const total = guildData.totalCount || 0;
    const avg   = avgRating(guildData.ratings || {});
    const avgStr = avg > 0 ? `${avg.toFixed(1)} / 5.0` : 'No data yet';

    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ${E.settings} Feedback System\n` +
                `-# Configure the feedback system for this server`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${E.channel} **Feedback Channel:** ${ch}\n` +
                `${E.comment} **Logs Channel:** ${logs}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${E.fire} **Total Reviews:** ${total}\n` +
                `${E.star} **Average Rating:** ${avgStr}\n` +
                `-# Members submit reviews by clicking the panel button`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('fb_setup_channel').setLabel('Set Channel').setStyle(ButtonStyle.Primary).setEmoji(E.channel),
                new ButtonBuilder().setCustomId('fb_setup_logs').setLabel('Set Logs').setStyle(ButtonStyle.Secondary).setEmoji(E.document),
                new ButtonBuilder().setCustomId('fb_post_panel').setLabel('Post Panel').setStyle(ButtonStyle.Secondary).setEmoji(E.edit)
            )
        )
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('fb_setup_remove').setLabel('Remove Setup').setStyle(ButtonStyle.Danger).setEmoji(E.cancel)
            )
        );
}

function buildModal() {
    return new ModalBuilder()
        .setCustomId('fb_submit_modal')
        .setTitle('Share Your Feedback')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('fb_rating')
                    .setLabel('Rating (1–5 stars)')
                    .setPlaceholder('Enter a number from 1 to 5')
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(1)
                    .setMaxLength(1)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('fb_review')
                    .setLabel('Your Review')
                    .setPlaceholder('Write your honest experience here…')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMinLength(10)
                    .setMaxLength(1000)
                    .setRequired(true)
            )
        );
}

/* ─── Interaction handler (buttons + modals) ─── */
async function handleInteraction(interaction) {
    // Re-validate premium on every component press — the system is
    // premium-gated at the command level, but stray panel buttons
    // / modals route by customId prefix and need their own check.
    const { requirePremium } = require('../../utils/interactionGuards');
    if (await requirePremium(interaction, { commandName: '/feedback' })) return true;

    const { customId, guildId } = interaction;

    /* ── Button: open modal ── */
    if (customId === 'fb_open_modal') {
        return interaction.showModal(buildModal());
    }

    /* ── Button: setup — set channel ── */
    if (customId === 'fb_setup_channel') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: `${E.cancel} You need **Manage Server** permission.`, flags: MessageFlags.Ephemeral });
        }
        const { ChannelSelectMenuBuilder } = require('discord.js');
        const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('fb_select_channel')
                .setPlaceholder('Pick the feedback channel')
                .addChannelTypes(ChannelType.GuildText)
        );
        const c = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${E.channel} **Select the channel** where feedback cards will be posted.`))
            .addActionRowComponents(row);
        return interaction.reply({ components: [c], flags: CV2 | MessageFlags.Ephemeral });
    }

    /* ── Button: setup — set logs channel ── */
    if (customId === 'fb_setup_logs') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: `${E.cancel} You need **Manage Server** permission.`, flags: MessageFlags.Ephemeral });
        }
        const { ChannelSelectMenuBuilder } = require('discord.js');
        const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('fb_select_logs')
                .setPlaceholder('Pick the logs channel (optional)')
                .addChannelTypes(ChannelType.GuildText)
        );
        const c = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${E.comment} **Select the logs channel** where all reviews will be mirrored for moderation.`))
            .addActionRowComponents(row);
        return interaction.reply({ components: [c], flags: CV2 | MessageFlags.Ephemeral });
    }

    /* ── Button: post panel ── */
    if (customId === 'fb_post_panel') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: `${E.cancel} You need **Manage Server** permission.`, flags: MessageFlags.Ephemeral });
        }
        const panel = buildPanel(interaction.guild);
        await interaction.channel.send({ components: [panel], flags: CV2 });
        return interaction.reply({ content: `${E.check} Feedback panel posted in ${interaction.channel}.`, flags: MessageFlags.Ephemeral });
    }

    /* ── Button: remove setup ── */
    if (customId === 'fb_setup_remove') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: `${E.cancel} You need **Manage Server** permission.`, flags: MessageFlags.Ephemeral });
        }
        const store = getStore();
        delete store[guildId];
        saveStore(store);
        const c = new ContainerBuilder()
            .setAccentColor(0xED4245)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## ${E.trash} Feedback System Reset\nAll configuration has been cleared.\nRun \`/feedback setup\` to reconfigure.`
            ));
        return interaction.update({ components: [c], flags: CV2 });
    }

    /* ── Select: channel ── */
    if (customId === 'fb_select_channel') {
        const channel = interaction.values[0];
        const { store, guildData } = getGuildData(guildId);
        guildData.channelId = channel;
        saveStore(store);
        const c = new ContainerBuilder()
            .setAccentColor(0x57F287)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${E.check} **Feedback channel set to** <#${channel}>\n-# Use the setup panel to post the review panel.`
            ));
        return interaction.update({ components: [c], flags: CV2 });
    }

    /* ── Select: logs ── */
    if (customId === 'fb_select_logs') {
        const channel = interaction.values[0];
        const { store, guildData } = getGuildData(guildId);
        guildData.logsChannelId = channel;
        saveStore(store);
        const c = new ContainerBuilder()
            .setAccentColor(0x57F287)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${E.check} **Logs channel set to** <#${channel}>`
            ));
        return interaction.update({ components: [c], flags: CV2 });
    }

    /* ── Modal submit ── */
    if (customId === 'fb_submit_modal') {
        const ratingRaw = interaction.fields.getTextInputValue('fb_rating').trim();
        const review    = interaction.fields.getTextInputValue('fb_review').trim();
        const rating    = parseInt(ratingRaw);

        if (isNaN(rating) || rating < 1 || rating > 5) {
            return interaction.reply({
                content: `${E.cancel} Rating must be a number from **1 to 5**. Please try again.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const { store, guildData } = getGuildData(guildId);

        if (!guildData.channelId) {
            return interaction.reply({
                content: `${E.cancel} The feedback system hasn't been configured yet. Ask an admin to run \`/feedback setup\`.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const feedbackChannel = interaction.guild.channels.cache.get(guildData.channelId);
        if (!feedbackChannel) {
            return interaction.reply({
                content: `${E.cancel} The feedback channel no longer exists. Ask an admin to run \`/feedback setup\` again.`,
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        guildData.totalCount = (guildData.totalCount || 0) + 1;
        if (!guildData.ratings) guildData.ratings = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        guildData.ratings[rating] = (guildData.ratings[rating] || 0) + 1;
        saveStore(store);

        const card = buildFeedbackCard({
            rating,
            review,
            imageUrl : null,
            user     : interaction.user,
            feedbackNumber: guildData.totalCount,
        });

        await feedbackChannel.send({ components: [card], flags: CV2 });

        if (guildData.logsChannelId) {
            const logsChannel = interaction.guild.channels.cache.get(guildData.logsChannelId);
            if (logsChannel) {
                const logCard = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `${E.info} **Review #${String(guildData.totalCount).padStart(4, '0')}** logged\n` +
                        `${E.user} ${interaction.user.username} \`${interaction.user.id}\`\n` +
                        `${buildStarsBar(rating)}  **${rating} / 5**\n` +
                        `> ${review.length > 200 ? review.slice(0, 200) + '…' : review}`
                    ));
                logsChannel.send({ components: [logCard], flags: CV2 }).catch(() => {});
            }
        }

        const thankYou = new ContainerBuilder()
            .setAccentColor(0x57F287)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## ${E.check} Thank You!\n` +
                `Your ${buildStarsBar(rating)} review has been posted.\n` +
                `-# We appreciate your honest feedback.`
            ));

        return interaction.editReply({ components: [thankYou], flags: CV2 });
    }

    return false;
}

/* ─── Command ─── */
module.exports = {
    /**
     * Premium-gated feature. `premiumOnly` is read by the
     * command dispatcher in index.js — non-premium users get a
     * polite message instead of execution.
     */
    premiumOnly: true,

    name: 'feedback',
    prefix: 'feedback',
    aliases: ['fb'],
    category: 'automation',
    description: 'Professional feedback system — star ratings, review cards, stats, and logs channel mirroring',
    usage: '/feedback setup  |  /feedback panel  |  /feedback stats',
    permissions: [],

    data: new SlashCommandBuilder()
        .setName('feedback')
        .setDescription('Manage the server feedback system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Open the feedback system setup panel')
        )
        .addSubcommand(sub =>
            sub.setName('panel')
                .setDescription('Post the feedback panel in the current channel')
        )
        .addSubcommand(sub =>
            sub.setName('stats')
                .setDescription('View feedback statistics for this server')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'setup') {
            return interaction.reply({ components: [buildSetupPanel(interaction.guildId)], flags: CV2 });
        }

        if (sub === 'panel') {
            const { guildData } = getGuildData(interaction.guildId);
            if (!guildData.channelId) {
                return interaction.reply({
                    content: `${E.cancel} Please run \`/feedback setup\` and configure a channel first.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            const panel = buildPanel(interaction.guild);
            await interaction.channel.send({ components: [panel], flags: CV2 });
            return interaction.reply({ content: `${E.check} Feedback panel posted!`, flags: MessageFlags.Ephemeral });
        }

        if (sub === 'stats') {
            const { guildData } = getGuildData(interaction.guildId);
            const total = guildData.totalCount || 0;
            const r     = guildData.ratings || {};
            const avg   = avgRating(r);

            let bars = '';
            for (let i = 5; i >= 1; i--) {
                const count = r[i] || 0;
                const pct   = total > 0 ? Math.round((count / total) * 12) : 0;
                const bar   = '█'.repeat(pct) + '░'.repeat(12 - pct);
                bars += `${'⭐'.repeat(i)}  \`${bar}\`  **${count}**\n`;
            }

            const c = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `## ${E.fire} Feedback Statistics\n` +
                    `-# ${interaction.guild.name}`
                ))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `**Total Reviews:** ${total}\n` +
                    `**Average Rating:** ${avg > 0 ? avg.toFixed(1) + ' / 5.0  ' + buildStarsBar(Math.round(avg)) : 'No reviews yet'}`
                ))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(bars || '-# No reviews yet.'));

            return interaction.reply({ components: [c], flags: CV2 });
        }
    },

    async executePrefix(message, args) {
        const sub = (args[0] || '').toLowerCase();

        if (!sub || sub === 'setup') {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return message.reply(`${E.cancel} You need **Manage Server** permission.`);
            }
            return message.reply({ components: [buildSetupPanel(message.guildId)], flags: CV2 });
        }

        if (sub === 'panel') {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return message.reply(`${E.cancel} You need **Manage Server** permission.`);
            }
            const { guildData } = getGuildData(message.guildId);
            if (!guildData.channelId) {
                return message.reply(`${E.cancel} Please run \`feedback setup\` first to configure the system.`);
            }
            const panel = buildPanel(message.guild);
            await message.channel.send({ components: [panel], flags: CV2 });
            return message.reply(`${E.check} Feedback panel posted!`);
        }

        if (sub === 'stats') {
            const { guildData } = getGuildData(message.guildId);
            const total = guildData.totalCount || 0;
            const r     = guildData.ratings || {};
            const avg   = avgRating(r);
            let bars = '';
            for (let i = 5; i >= 1; i--) {
                const count = r[i] || 0;
                const pct   = total > 0 ? Math.round((count / total) * 12) : 0;
                const bar   = '█'.repeat(pct) + '░'.repeat(12 - pct);
                bars += `${'⭐'.repeat(i)}  \`${bar}\`  **${count}**\n`;
            }
            const c = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `## ${E.fire} Feedback Statistics\n\n` +
                    `**Total Reviews:** ${total}\n` +
                    `**Average Rating:** ${avg > 0 ? avg.toFixed(1) + ' / 5.0' : 'No reviews yet'}\n\n` +
                    (bars || '-# No reviews yet.')
                ));
            return message.reply({ components: [c], flags: CV2 });
        }
    },

    handleInteraction,
};
