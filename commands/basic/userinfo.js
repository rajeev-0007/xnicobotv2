'use strict';

const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    GatewayIntentBits,
    MessageFlags,
    UserFlags,
} = require('discord.js');

const E = {
    user:      '<:User:1521227714227343380>',
    bot:       '<:bots:1521227848101396610>',
    shield:    '<:Shield:1521227694677692467>',
    crown:     '<:Crown:1521227739988889764>',
    folder:    '<:Folder:1521228095225331765>',
    lightning: '<:Lightning:1521227915537285150>',
    edit:      '<:Editalt:1521227921673556019>',
    award:     '<:Award:1521228119640375336>',
    caret:     '<:Caretright:1521227704953864202>',
    sketch:    '<:Sketch:1521228025365004471>',
    online:    '<:online:1521228065752088576>',
    offline:   '<:offline:1521228263177977897>',
    book:      '<:Bookopen:1521227911137595605>',
    star:      '<:Star:1521227981685526568>',
    fire:      '<:Fire:1521227907647668374>',
    info:      '<:Inforect:1521228008285929532>',
    copy:      '<:Copy:1521227960554881084>',
};

const STATUS_EMOJI = {
    online: E.online,
    idle:   '<:idle:1521228053936603257>',
    dnd:    '<:dnd:1521228070701502486>',
    offline: E.offline,
    invisible: E.offline,
};

const FLAG_LABELS = {
    Staff:                  'Discord Staff',
    Partner:                'Partner',
    Hypesquad:              'HypeSquad Events',
    BugHunterLevel1:        'Bug Hunter',
    BugHunterLevel2:        'Bug Hunter (Gold)',
    HypeSquadOnlineHouse1:  'House Bravery',
    HypeSquadOnlineHouse2:  'House Brilliance',
    HypeSquadOnlineHouse3:  'House Balance',
    PremiumEarlySupporter:  'Early Supporter',
    VerifiedDeveloper:      'Verified Developer',
    CertifiedModerator:     'Discord Moderator',
    ActiveDeveloper:        'Active Developer',
};

function tsR(ms) { return ms ? `<t:${Math.floor(ms / 1000)}:R>` : '*unknown*'; }
function tsD(ms) { return ms ? `<t:${Math.floor(ms / 1000)}:D>` : '*unknown*'; }

async function fetchPremiumLine(userId, guildId) {
    try {
        const premiumManager = require('../../utils/premiumManager');
        if (premiumManager.isPremium(userId)) return `${E.crown} **Premium User**`;
        if (guildId && premiumManager.isServerPremium(guildId)) return `${E.crown} **Premium (via server)**`;
    } catch { /* ignore */ }
    return null;
}

async function buildUserInfo(user, guild, client) {
    // Fetch fresh so we get badges & banner
    let fresh = user;
    try { fresh = await client.users.fetch(user.id, { force: true }); } catch {}

    const member = guild ? await guild.members.fetch(user.id).catch(() => null) : null;

    const accent = member?.displayColor || fresh.accentColor || 0xCAD7E6;
    const container = new ContainerBuilder().setAccentColor(accent);

    // Header section with avatar
    const presenceOn = client.options.intents.has(GatewayIntentBits.GuildPresences);
    const status = member?.presence?.status || 'offline';
    const statusEmoji = STATUS_EMOJI[status] || E.offline;
    const tagDisplay = fresh.discriminator && fresh.discriminator !== '0' ? `${fresh.username}#${fresh.discriminator}` : fresh.username;

    // Without the Presence intent the status is always "offline" — note it
    // so the indicator isn't mistaken for the user's real status.
    const statusLine = presenceOn
        ? `${statusEmoji} ${status[0].toUpperCase() + status.slice(1)}`
        : `${statusEmoji} ${status[0].toUpperCase() + status.slice(1)}  ·  -# ${E.info} Presence Intent disabled`;

    container.addSectionComponents(
        new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# ${tagDisplay}${fresh.bot ? ` ${E.bot}` : ''}\n` +
                statusLine +
                (member?.nickname ? ` · ${E.edit} ${member.nickname}` : '')
            ))
            .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: fresh.displayAvatarURL({ size: 256, extension: 'png' }) } }))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // Account block
    const created = fresh.createdTimestamp;
    let accountBlock = `### ${E.user} Account\n`;
    accountBlock += `${E.copy} ID: \`${fresh.id}\`\n`;
    accountBlock += `${E.book} Created: ${tsD(created)} (${tsR(created)})`;
    const premiumLine = await fetchPremiumLine(fresh.id, guild?.id);
    if (premiumLine) accountBlock += `\n${premiumLine}`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(accountBlock));

    // Server-specific block
    if (member) {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

        const roles = member.roles.cache
            .filter(r => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => r.toString());
        const shownRoles = roles.slice(0, 10);
        const moreRoles = roles.length > 10 ? ` +${roles.length - 10} more` : '';
        const joinedAt = member.joinedTimestamp;

        // Member-join position (1-based by joinedAt across all members)
        let joinPos = null;
        try {
            const members = await guild.members.fetch();
            const sorted = members
                .filter(m => m.joinedTimestamp)
                .sorted((a, b) => a.joinedTimestamp - b.joinedTimestamp);
            const ids = [...sorted.keys()];
            const idx = ids.indexOf(member.id);
            if (idx >= 0) joinPos = idx + 1;
        } catch {}

        let serverBlock = `### ${E.folder} ${guild.name}\n`;
        serverBlock += `${E.lightning} Joined: ${tsD(joinedAt)} (${tsR(joinedAt)})\n`;
        if (joinPos != null) serverBlock += `${E.caret} Join position: \`#${joinPos}\` of \`${guild.memberCount}\`\n`;
        serverBlock += `${E.award} Highest role: ${member.roles.highest}\n`;
        serverBlock += `${E.caret} Display color: ${member.displayHexColor || 'default'}`;

        if (member.premiumSinceTimestamp) {
            serverBlock += `\n${E.sketch} Boosting since: ${tsR(member.premiumSinceTimestamp)}`;
        }

        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(serverBlock));

        if (shownRoles.length > 0) {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### Roles · ${roles.length}\n${shownRoles.join(' ')}${moreRoles}`
            ));
        }

        // Permissions snapshot
        const perms = member.permissions.toArray();
        if (perms.includes('Administrator')) {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${E.shield} **Administrator** — full permissions on this server.`
            ));
        } else {
            const keyPerms = perms.filter(p =>
                ['ManageGuild', 'ManageRoles', 'ManageChannels', 'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageMessages', 'ManageNicknames'].includes(p)
            );
            if (keyPerms.length) {
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `${E.shield} **Key permissions:** ${keyPerms.map(p => `\`${p}\``).join(' · ')}`
                ));
            }
        }
    }

    // Public flags / badges
    try {
        const flagSet = fresh.flags?.toArray?.() || [];
        const labels = flagSet.map(f => FLAG_LABELS[f] || f);
        if (labels.length > 0) {
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${E.star} Badges\n${labels.map(l => `${E.caret} ${l}`).join('\n')}`
            ));
        }
    } catch {}

    // Avatar / banner / profile buttons
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel('Avatar')
            .setEmoji(E.user)
            .setURL(fresh.displayAvatarURL({ size: 4096 })),
    );
    if (fresh.bannerURL?.()) {
        buttons.addComponents(
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel('Banner')
                .setEmoji(E.fire)
                .setURL(fresh.bannerURL({ size: 4096 }))
        );
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    return { container, buttons };
}

module.exports = {
    prefix: 'userinfo',
    description: 'Display detailed user information',
    usage: 'userinfo [@user]',
    category: 'basic',
    aliases: ['ui', 'user', 'whois'],

    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Display detailed user information')
        .addUserOption(option =>
            option.setName('user').setDescription('The user to get information about').setRequired(false)),

    async execute(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;
        const { container, buttons } = await buildUserInfo(user, interaction.guild, interaction.client);
        await interaction.reply({ components: [container.addActionRowComponents(buttons)], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        let user = message.author;
        if (message.mentions.users.size > 0) {
            user = message.mentions.users.first();
        } else if (args[0]) {
            try { user = await message.client.users.fetch(args[0]); } catch {}
        }
        const { container, buttons } = await buildUserInfo(user, message.guild, message.client);
        await message.reply({ components: [container.addActionRowComponents(buttons)], flags: MessageFlags.IsComponentsV2 });
    },
};
