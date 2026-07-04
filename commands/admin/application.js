const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
    MessageFlags, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType,
    ChannelSelectMenuBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder
} = require('discord.js');
const { buildErrorResponse, buildSuccessResponse, buildPermissionDenied, COLORS, EMOJIS } = require('../../utils/responseBuilder');
const jsonStore = require('../../utils/jsonStore');

const activeSetups = new Map();
const activeApplications = new Map();
const reviewLocks = new Set();

function loadConfig() {
    try { if (jsonStore.has('applications')) return jsonStore.read('applications'); } catch {}
    return {};
}

function normalizeQuestions(questions) {
    if (!Array.isArray(questions)) return [];
    return questions.map(q => typeof q === 'string' ? q : (q.label || q.question || String(q)));
}

function saveConfig(config) {
    jsonStore.write('applications', config);
}

function loadResponses() {
    try { if (jsonStore.has('application-responses')) return jsonStore.read('application-responses'); } catch {}
    return {};
}

function saveResponses(data) {
    jsonStore.write('application-responses', data);
}

function getDefaultForm() {
    return {
        enabled: false,
        name: 'Staff Application',
        description: 'Apply to join our team!',
        questions: [],
        reviewChannel: null,
        logChannel: null,
        acceptRole: null,
        removeRole: null,
        denyMessage: 'Thank you for your interest, but your application has been denied.',
        acceptMessage: 'Congratulations! Your application has been accepted!',
        cooldown: 86400000,
        color: 0x5865F2,
        requireRole: null
    };
}

function getResponseCount(guildId) {
    const responses = loadResponses();
    const guildResponses = responses[guildId] || {};
    let pending = 0, accepted = 0, denied = 0;
    for (const r of Object.values(guildResponses)) {
        if (r.status === 'pending') pending++;
        else if (r.status === 'accepted') accepted++;
        else if (r.status === 'denied') denied++;
    }
    return { pending, accepted, denied, total: pending + accepted + denied };
}

function formatDuration(ms) {
    if (ms <= 0) return 'None';
    const hours = Math.floor(ms / 3600000);
    if (hours >= 24) return `${Math.floor(hours / 24)}d`;
    if (hours > 0) return `${hours}h`;
    return `${Math.floor(ms / 60000)}m`;
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

function buildMainPanel(guild, guildConfig) {
    const counts = getResponseCount(guild.id);
    const normalizedQ = normalizeQuestions(guildConfig.questions);
    const qCount = normalizedQ.length;

    const questionPreview = qCount > 0
        ? normalizedQ.map((q, i) => `> **${i + 1}.** ${q}`).join('\n')
        : '> *No questions configured yet*';

    let content = `# <:Document:1521227875016114266> Application System\n`;
    content += `-# Manage server applications — create forms, review responses\n\n`;

    content += `### <:Settings:1521227767780343879> Status\n`;
    content += `> ${guildConfig.enabled ? '<:Toggleon:1521227758011809964> **Active**' : '<:Toggleoff:1521227763816595559> **Disabled**'}`;
    content += ` — \`${qCount}\` questions configured\n\n`;

    content += `### <:Bookopen:1521227911137595605> Questions\n`;
    content += questionPreview + '\n\n';

    content += `### <:Settings:1521227767780343879> Configuration\n`;
    content += `> <:Edit:1521227886634205298> **Form Name:** ${guildConfig.name}\n`;
    content += `> <:Hashtag:1521227771957870604> **Review Channel:** ${guildConfig.reviewChannel ? `<#${guildConfig.reviewChannel}>` : '`Not set`'}\n`;
    content += `> <:Document:1521227875016114266> **Log Channel:** ${guildConfig.logChannel ? `<#${guildConfig.logChannel}>` : '`None`'}\n`;
    content += `> <:Userplus:1521227719621218477> **Accept Role:** ${guildConfig.acceptRole ? `<@&${guildConfig.acceptRole}>` : '`None`'}\n`;
    content += `> <:Shield:1521227694677692467> **Required Role:** ${guildConfig.requireRole ? `<@&${guildConfig.requireRole}>` : '`None`'}\n`;
    content += `> <:Alarm:1521227869047750689> **Cooldown:** \`${formatDuration(guildConfig.cooldown || 0)}\`\n\n`;

    content += `### <:Invoice:1521227903956811836> Statistics\n`;
    content += `> <:Lightning:1521227915537285150> Pending: \`${counts.pending}\` • <:Checkedbox:1521227734943269077> Accepted: \`${counts.accepted}\` • <:Cancel:1521227723916181644> Denied: \`${counts.denied}\``;

    const container = new ContainerBuilder()
        .setAccentColor(guildConfig.enabled ? 0x57F287 : 0xED4245);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('app_toggle').setLabel(guildConfig.enabled ? 'Disable' : 'Enable').setStyle(guildConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success).setEmoji(guildConfig.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
        new ButtonBuilder().setCustomId('app_questions_dm').setLabel('Setup Questions').setStyle(ButtonStyle.Primary).setEmoji('<:Bookopen:1521227911137595605>'),
        new ButtonBuilder().setCustomId('app_edit_info').setLabel('Edit Info').setStyle(ButtonStyle.Primary).setEmoji('<:Editalt:1521227921673556019>'),
        new ButtonBuilder().setCustomId('app_send_panel').setLabel('Send Apply Panel').setStyle(ButtonStyle.Success).setEmoji('<:Add:1521227828199293152>')
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('app_set_review').setLabel('Review Channel').setStyle(ButtonStyle.Secondary).setEmoji('<:Hashtag:1521227771957870604>'),
        new ButtonBuilder().setCustomId('app_set_log').setLabel('Log Channel').setStyle(ButtonStyle.Secondary).setEmoji('<:Document:1521227875016114266>'),
        new ButtonBuilder().setCustomId('app_set_accept_role').setLabel('Accept Role').setStyle(ButtonStyle.Secondary).setEmoji('<:Userplus:1521227719621218477>'),
        new ButtonBuilder().setCustomId('app_set_require_role').setLabel('Required Role').setStyle(ButtonStyle.Secondary).setEmoji('<:Shield:1521227694677692467>')
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('app_messages').setLabel('Accept/Deny Messages').setStyle(ButtonStyle.Secondary).setEmoji('<:Hashtag:1521227771957870604>'),
        new ButtonBuilder().setCustomId('app_pending').setLabel(`Pending (${counts.pending})`).setStyle(ButtonStyle.Secondary).setEmoji('<:Lightning:1521227915537285150>'),
        new ButtonBuilder().setCustomId('app_reset').setLabel('Reset All').setStyle(ButtonStyle.Danger).setEmoji('<:Trash:1521227750420254820>')
    );

    container.addActionRowComponents(row1);
    container.addActionRowComponents(row2);
    container.addActionRowComponents(row3);

    return container;
}

function buildApplyButton(guildConfig) {
    const content = `# <:Document:1521227875016114266> ${guildConfig.name}\n\n${guildConfig.description}\n\n-# Click the button below to apply`;

    const container = new ContainerBuilder()
        .setAccentColor(guildConfig.color || 0x5865F2);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('app_apply_start')
            .setLabel('Apply Now')
            .setStyle(ButtonStyle.Success)
            .setEmoji('<:Document:1521227875016114266>')
    );

    container.addActionRowComponents(row);

    return container;
}

function buildApplicationReview(guild, appData) {
    const answers = appData.answers.map((a, i) =>
        `### Q${i + 1}: ${a.question}\n> ${a.answer.split('\n').join('\n> ')}`
    ).join('\n\n');

    const content = `# <:Document:1521227875016114266> New Application\n\n` +
        `<:User:1521227714227343380> **Applicant:** <@${appData.userId}> (\`${appData.userId}\`)\n` +
        `<:Alarm:1521227869047750689> **Submitted:** <t:${Math.floor(appData.submittedAt / 1000)}:R>\n` +
        `<:Bookmark:1521227835526742066> **ID:** \`${appData.id}\`\n\n` +
        answers;

    const container = new ContainerBuilder()
        ;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`app_accept_${appData.id}`).setLabel('Accept').setStyle(ButtonStyle.Success).setEmoji('<:Checkedbox:1521227734943269077>'),
        new ButtonBuilder().setCustomId(`app_deny_${appData.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setEmoji('<:Cancel:1521227723916181644>'),
        new ButtonBuilder().setCustomId(`app_deny_reason_${appData.id}`).setLabel('Deny with Reason').setStyle(ButtonStyle.Secondary).setEmoji('<:Hashtag:1521227771957870604>')
    );

    container.addActionRowComponents(row);

    return container;
}

async function startQuestionSetupDM(interaction, guild, guildConfig, config) {
    const userId = interaction.user.id;
    const guildId = guild.id;

    if (activeSetups.has(userId)) {
        return interaction.reply({ components: [buildErrorResponse('Active Session', 'You already have an active question setup session. Finish it first or type `cancel` in DMs.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    activeSetups.set(userId, { pending: true });

    let dmChannel;
    try {
        dmChannel = await interaction.user.createDM();
    } catch {
        activeSetups.delete(userId);
        return interaction.reply({ components: [buildErrorResponse('DMs Closed', 'I cannot send you DMs. Please enable DMs from server members and try again.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    await interaction.reply({ components: [buildSuccessResponse('Check your DMs!', 'I\'ve started the question setup in your DMs. Follow the prompts there.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

    const session = {
        guildId,
        guildName: guild.name,
        questions: [],
        dmChannel,
        timeout: null
    };
    activeSetups.set(userId, session);

    const startMsg =
        `# <:Bookopen:1521227911137595605> Question Setup — ${guild.name}\n\n` +
        `I'll walk you through setting up your application questions one by one.\n\n` +
        `### How it works\n` +
        `> Type each question and press Enter\n` +
        `> Type **done** when you've added all questions\n` +
        `> Type **cancel** to abort without saving\n` +
        `> Type **undo** to remove the last question\n` +
        `> You can add up to **20** questions\n\n` +
        `-# Let's start! Type your **first question** below:`;

    await dmChannel.send({ content: startMsg }).catch(() => {});

    const collector = dmChannel.createMessageCollector({
        filter: (m) => m.author.id === userId,
        time: 300000,
        idle: 120000
    });

    collector.on('collect', async (msg) => {
        const text = msg.content.trim();

        if (text.toLowerCase() === 'cancel') {
            activeSetups.delete(userId);
            collector.stop('cancelled');
            await dmChannel.send({ content: `<:Cancel:1521227723916181644> Question setup cancelled. No changes were saved.` }).catch(() => {});
            return;
        }

        if (text.toLowerCase() === 'undo') {
            if (session.questions.length === 0) {
                await dmChannel.send({ content: `<:Infotriangle:1521227710381428926> No questions to undo. Type your first question:` }).catch(() => {});
                return;
            }
            const removed = session.questions.pop();
            await dmChannel.send({ content: `<:Trash:1521227750420254820> Removed: *"${removed}"*\n\n> You have **${session.questions.length}** question(s). Type next question or **done** to finish.` }).catch(() => {});
            return;
        }

        if (text.toLowerCase() === 'done') {
            if (session.questions.length === 0) {
                await dmChannel.send({ content: `<:Infotriangle:1521227710381428926> You haven't added any questions yet. Add at least one question or type **cancel** to abort.` }).catch(() => {});
                return;
            }

            const freshConfig = loadConfig();
            if (!freshConfig[guildId]) freshConfig[guildId] = getDefaultForm();
            freshConfig[guildId].questions = session.questions;
            saveConfig(freshConfig);

            const questionList = session.questions.map((q, i) => `> **${i + 1}.** ${q}`).join('\n');

            await dmChannel.send({
                content:
                    `# <:Checkedbox:1521227734943269077> Questions Saved!\n\n` +
                    `**${session.questions.length}** question(s) saved for **${session.guildName}**:\n\n` +
                    questionList + `\n\n` +
                    `-# Go back to the server to enable the application system`
            }).catch(() => {});

            activeSetups.delete(userId);
            collector.stop('completed');
            return;
        }

        if (text.length > 256) {
            await dmChannel.send({ content: `<:Infotriangle:1521227710381428926> Question is too long (max 256 characters). Try again:` }).catch(() => {});
            return;
        }

        if (text.length < 3) {
            await dmChannel.send({ content: `<:Infotriangle:1521227710381428926> Question is too short (min 3 characters). Try again:` }).catch(() => {});
            return;
        }

        if (session.questions.length >= 20) {
            await dmChannel.send({ content: `<:Infotriangle:1521227710381428926> Maximum 20 questions reached. Type **done** to save.` }).catch(() => {});
            return;
        }

        session.questions.push(text);
        const count = session.questions.length;

        await dmChannel.send({
            content:
                `<:Checkedbox:1521227734943269077> **Question ${count} added!**\n` +
                `> *"${text}"*\n\n` +
                `Type your next question, **done** to finish, or **undo** to remove the last one.`
        }).catch(() => {});
    });

    collector.on('end', (collected, reason) => {
        activeSetups.delete(userId);
        if (reason === 'time' || reason === 'idle') {
            dmChannel.send({ content: `<:Alarm:1521227869047750689> Question setup timed out. Your progress was not saved. Run the setup again when ready.` }).catch(() => {});
        }
    });
}

async function startApplicationDM(interaction, guild, guildConfig) {
    const userId = interaction.user.id;
    const guildId = guild.id;

    if (activeApplications.has(userId)) {
        return interaction.reply({ components: [buildErrorResponse('Active Session', 'You already have an active application session. Complete it in your DMs first.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    if (guildConfig.requireRole && !interaction.member?.roles?.cache?.has(guildConfig.requireRole)) {
        return interaction.reply({ components: [buildErrorResponse('Missing Role', `You need <@&${guildConfig.requireRole}> to apply.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    const responses = loadResponses();
    const guildResponses = responses[guildId] || {};

    const userPending = Object.values(guildResponses).find(r => r.userId === userId && r.status === 'pending');
    if (userPending) {
        return interaction.reply({ components: [buildErrorResponse('Pending Application', 'You already have a pending application. Wait for it to be reviewed.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    const userRecent = Object.values(guildResponses)
        .filter(r => r.userId === userId)
        .sort((a, b) => b.submittedAt - a.submittedAt)[0];
    if (userRecent && guildConfig.cooldown && Date.now() - userRecent.submittedAt < guildConfig.cooldown) {
        const remaining = userRecent.submittedAt + guildConfig.cooldown;
        return interaction.reply({ components: [buildErrorResponse('Cooldown', `You can apply again <t:${Math.floor(remaining / 1000)}:R>.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    const questions = normalizeQuestions(guildConfig.questions);
    if (!questions || questions.length === 0) {
        return interaction.reply({ components: [buildErrorResponse('No Questions', 'This application has no questions configured yet.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    activeApplications.set(userId, { pending: true });

    let dmChannel;
    try {
        dmChannel = await interaction.user.createDM();
        await dmChannel.send({
            content:
                `# <:Document:1521227875016114266> ${guildConfig.name} — ${guild.name}\n\n` +
                `You're applying to **${guild.name}**! I'll ask you **${questions.length}** question(s) one by one.\n\n` +
                `> Answer each question by typing your response\n` +
                `> Type **cancel** at any time to abort\n\n` +
                `-# Let's begin!`
        });
    } catch {
        activeApplications.delete(userId);
        return interaction.reply({ components: [buildErrorResponse('DMs Closed', 'I cannot send you DMs. Please enable DMs from server members and try again.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    await interaction.reply({ components: [buildSuccessResponse('Check your DMs!', `I've started your application in your DMs. Answer the questions there.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

    const session = {
        guildId,
        guildName: guild.name,
        guildConfig,
        questions: [...questions],
        answers: [],
        currentIndex: 0,
        dmChannel,
        guild
    };
    activeApplications.set(userId, session);

    await askNextQuestion(dmChannel, session, userId);
}

async function askNextQuestion(dmChannel, session, userId) {
    const idx = session.currentIndex;
    const question = session.questions[idx];

    await dmChannel.send({
        content:
            `### Question ${idx + 1}/${session.questions.length}\n` +
            `> **${question}**\n\n` +
            `-# Type your answer below`
    }).catch(() => {});

    const collector = dmChannel.createMessageCollector({
        filter: (m) => m.author.id === userId,
        max: 1,
        time: 300000
    });

    collector.on('collect', async (msg) => {
        const text = msg.content.trim();

        if (text.toLowerCase() === 'cancel') {
            activeApplications.delete(userId);
            await dmChannel.send({ content: `<:Cancel:1521227723916181644> Application cancelled. You can apply again later.` }).catch(() => {});
            return;
        }

        if (text.length > 1024) {
            await dmChannel.send({ content: `<:Infotriangle:1521227710381428926> Answer is too long (max 1024 characters). Try again:` }).catch(() => {});
            await askNextQuestion(dmChannel, session, userId);
            return;
        }

        session.answers.push({ question: session.questions[idx], answer: text });
        session.currentIndex++;

        if (session.currentIndex < session.questions.length) {
            await askNextQuestion(dmChannel, session, userId);
        } else {
            await submitApplication(dmChannel, session, userId);
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            activeApplications.delete(userId);
            dmChannel.send({ content: `<:Alarm:1521227869047750689> Application timed out. You can start over by clicking **Apply Now** again.` }).catch(() => {});
        }
    });
}

async function submitApplication(dmChannel, session, userId) {
    activeApplications.delete(userId);

    const appId = generateId();
    const appData = {
        id: appId,
        userId,
        answers: session.answers,
        submittedAt: Date.now(),
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        reason: null
    };

    const responses = loadResponses();
    if (!responses[session.guildId]) responses[session.guildId] = {};
    responses[session.guildId][appId] = appData;
    saveResponses(responses);

    const answerPreview = session.answers.map((a, i) => `> **Q${i + 1}:** ${a.question}\n> **A:** ${a.answer}`).join('\n\n');

    await dmChannel.send({
        content:
            `# <:Checkedbox:1521227734943269077> Application Submitted!\n\n` +
            `Your application to **${session.guildName}** has been submitted successfully!\n\n` +
            `### Your Answers\n` +
            answerPreview + `\n\n` +
            `> **Application ID:** \`${appId}\`\n\n` +
            `-# You will be notified here when your application is reviewed. Good luck!`
    }).catch(() => {});

    const freshConfig = loadConfig();
    const guildConfig = freshConfig[session.guildId];
    if (guildConfig?.reviewChannel && session.guild) {
        const reviewChannel = session.guild.channels.cache.get(guildConfig.reviewChannel);
        if (reviewChannel) {
            const reviewContainer = buildApplicationReview(session.guild, appData);
            reviewChannel.send({ components: [reviewContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    }

    if (guildConfig?.logChannel && session.guild) {
        const logCh = session.guild.channels.cache.get(guildConfig.logChannel);
        if (logCh) {
            logCh.send({ content: `<:Document:1521227875016114266> New application \`${appId}\` from <@${userId}> — waiting for review` }).catch(() => {});
        }
    }
}

module.exports = {
    prefix: 'application',
    description: 'Configure the server application system — create forms, review & manage applications',
    usage: 'application',
    category: 'admin',
    aliases: ['applications', 'apply-setup', 'appsetup'],
    permissions: ['ManageGuild'],
    loadConfig,
    saveConfig,
    loadResponses,
    saveResponses,
    generateId,
    getDefaultForm,

    async startApplication(interaction) {
        const config = loadConfig();
        const guildId = interaction.guild.id;
        const guildConfig = config[guildId];

        if (!guildConfig || !guildConfig.enabled) {
            return interaction.reply({ components: [buildErrorResponse('Closed', 'Applications are currently closed.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        return startApplicationDM(interaction, interaction.guild, guildConfig);
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply({ components: [buildPermissionDenied('Manage Server')], flags: MessageFlags.IsComponentsV2 });
        }

        const config = loadConfig();
        const guildId = message.guild.id;
        if (!config[guildId]) {
            config[guildId] = getDefaultForm();
            saveConfig(config);
        }

        const container = buildMainPanel(message.guild, config[guildId]);
        const reply = await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

        const { registerPanel } = require('../../utils/panelRegistry');
        registerPanel(guildId, 'application', message.channel.id, reply.id);
    },

    async handleInteraction(interaction) {
        if (!interaction.guild || !interaction.member) return;

        const config = loadConfig();
        const guildId = interaction.guild.id;
        let guildConfig = config[guildId];

        if (interaction.customId === 'app_apply_start') {
            if (!guildConfig || !guildConfig.enabled) {
                return interaction.reply({ components: [buildErrorResponse('Closed', 'Applications are currently closed.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
            return startApplicationDM(interaction, interaction.guild, guildConfig);
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) &&
            !interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.reply({ components: [buildPermissionDenied('Manage Server or Manage Roles')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (!guildConfig) {
            guildConfig = getDefaultForm();
            config[guildId] = guildConfig;
            saveConfig(config);
        }

        const { updatePanel } = require('../../utils/panelRegistry');

        if (interaction.customId === 'app_toggle') {
            if (!guildConfig.reviewChannel && !guildConfig.enabled) {
                return interaction.reply({ components: [buildErrorResponse('Setup Required', 'Set a review channel first before enabling.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
            if (!normalizeQuestions(guildConfig.questions).length && !guildConfig.enabled) {
                return interaction.reply({ components: [buildErrorResponse('Setup Required', 'Add at least one question first using **Setup Questions**.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
            guildConfig.enabled = !guildConfig.enabled;
            config[guildId] = guildConfig;
            saveConfig(config);

            await interaction.deferUpdate();
            await updatePanel(interaction.client, guildId, 'application', async (message) => {
                await message.edit({ components: [buildMainPanel(interaction.guild, guildConfig)] });
            });
            return;
        }

        if (interaction.customId === 'app_questions_dm') {
            return startQuestionSetupDM(interaction, interaction.guild, guildConfig, config);
        }

        if (interaction.customId === 'app_edit_info') {
            const modal = new ModalBuilder()
                .setCustomId('app_modal_info')
                .setTitle('Edit Application Info');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('app_name').setLabel('Application Name').setStyle(TextInputStyle.Short).setValue(guildConfig.name).setMaxLength(50).setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('app_desc').setLabel('Description (shown on apply panel)').setStyle(TextInputStyle.Paragraph).setValue(guildConfig.description).setMaxLength(500).setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('app_cooldown').setLabel('Cooldown between applications (hours)').setStyle(TextInputStyle.Short).setValue(String((guildConfig.cooldown || 0) / 3600000)).setRequired(false)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('app_color').setLabel('Accent Color (hex, e.g. #5865F2)').setStyle(TextInputStyle.Short).setValue(`#${(guildConfig.color || 0x5865F2).toString(16).padStart(6, '0')}`).setRequired(false)
                )
            );
            return interaction.showModal(modal);
        }

        if (interaction.customId === 'app_set_review') {
            const selectContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### <:Hashtag:1521227771957870604> Select Review Channel\n-# Applications will be sent here for staff to review`
                ));

            const channelSelect = new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId('app_select_review_ch')
                    .setPlaceholder('Select a channel...')
                    .setChannelTypes(ChannelType.GuildText)
            );

            selectContainer.addActionRowComponents(channelSelect);
            return interaction.reply({ components: [selectContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (interaction.customId === 'app_set_log') {
            const selectContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### <:Document:1521227875016114266> Select Log Channel\n-# Application events will be logged here (optional)`
                ));

            const channelSelect = new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId('app_select_log_ch')
                    .setPlaceholder('Select a channel...')
                    .setChannelTypes(ChannelType.GuildText)
            );

            selectContainer.addActionRowComponents(channelSelect);
            return interaction.reply({ components: [selectContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (interaction.customId === 'app_set_accept_role') {
            const selectContainer = new ContainerBuilder()
                .setAccentColor(0x57F287)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### <:Userplus:1521227719621218477> Select Accept Role\n-# This role will be given when an application is accepted`
                ));

            const roleSelect = new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId('app_select_accept_role')
                    .setPlaceholder('Select a role...')
            );

            selectContainer.addActionRowComponents(roleSelect);
            return interaction.reply({ components: [selectContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (interaction.customId === 'app_set_require_role') {
            const selectContainer = new ContainerBuilder()
                .setAccentColor(0xFEE75C)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### <:Shield:1521227694677692467> Select Required Role\n-# Only members with this role can apply (optional)`
                ));

            const roleSelect = new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId('app_select_require_role')
                    .setPlaceholder('Select a role (or skip)...')
            );

            selectContainer.addActionRowComponents(roleSelect);
            return interaction.reply({ components: [selectContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (interaction.customId === 'app_select_review_ch') {
            const channelId = interaction.values[0];
            guildConfig.reviewChannel = channelId;
            config[guildId] = guildConfig;
            saveConfig(config);

            await interaction.update({ components: [buildSuccessResponse('Review Channel Set', `Applications will be sent to <#${channelId}> for review.`)], flags: MessageFlags.IsComponentsV2 });
            await updatePanel(interaction.client, guildId, 'application', async (message) => {
                await message.edit({ components: [buildMainPanel(interaction.guild, guildConfig)] });
            });
            return;
        }

        if (interaction.customId === 'app_select_log_ch') {
            const channelId = interaction.values[0];
            guildConfig.logChannel = channelId;
            config[guildId] = guildConfig;
            saveConfig(config);

            await interaction.update({ components: [buildSuccessResponse('Log Channel Set', `Application logs will be sent to <#${channelId}>.`)], flags: MessageFlags.IsComponentsV2 });
            await updatePanel(interaction.client, guildId, 'application', async (message) => {
                await message.edit({ components: [buildMainPanel(interaction.guild, guildConfig)] });
            });
            return;
        }

        if (interaction.customId === 'app_select_accept_role') {
            const roleId = interaction.values[0];
            guildConfig.acceptRole = roleId;
            config[guildId] = guildConfig;
            saveConfig(config);

            await interaction.update({ components: [buildSuccessResponse('Accept Role Set', `Accepted applicants will receive <@&${roleId}>.`)], flags: MessageFlags.IsComponentsV2 });
            await updatePanel(interaction.client, guildId, 'application', async (message) => {
                await message.edit({ components: [buildMainPanel(interaction.guild, guildConfig)] });
            });
            return;
        }

        if (interaction.customId === 'app_select_require_role') {
            const roleId = interaction.values[0];
            guildConfig.requireRole = roleId;
            config[guildId] = guildConfig;
            saveConfig(config);

            await interaction.update({ components: [buildSuccessResponse('Required Role Set', `Only members with <@&${roleId}> can apply.`)], flags: MessageFlags.IsComponentsV2 });
            await updatePanel(interaction.client, guildId, 'application', async (message) => {
                await message.edit({ components: [buildMainPanel(interaction.guild, guildConfig)] });
            });
            return;
        }

        if (interaction.customId === 'app_messages') {
            const modal = new ModalBuilder()
                .setCustomId('app_modal_messages')
                .setTitle('Accept & Deny Messages');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('app_accept_msg').setLabel('Accept DM Message').setStyle(TextInputStyle.Paragraph).setValue(guildConfig.acceptMessage || '').setMaxLength(500).setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('app_deny_msg').setLabel('Deny DM Message').setStyle(TextInputStyle.Paragraph).setValue(guildConfig.denyMessage || '').setMaxLength(500).setRequired(true)
                )
            );
            return interaction.showModal(modal);
        }

        if (interaction.customId === 'app_send_panel') {
            if (!guildConfig.enabled) {
                return interaction.reply({ components: [buildErrorResponse('Disabled', 'Enable the application system first.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
            if (!guildConfig.reviewChannel) {
                return interaction.reply({ components: [buildErrorResponse('No Review Channel', 'Set a review channel first.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const panel = buildApplyButton(guildConfig);
            await interaction.channel.send({ components: [panel], flags: MessageFlags.IsComponentsV2 });
            return interaction.reply({ components: [buildSuccessResponse('Panel Sent', 'The application panel has been sent to this channel.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (interaction.customId === 'app_pending') {
            const responses = loadResponses();
            const guildResponses = responses[guildId] || {};
            const pending = Object.values(guildResponses).filter(r => r.status === 'pending').sort((a, b) => b.submittedAt - a.submittedAt);

            if (pending.length === 0) {
                return interaction.reply({ components: [buildSuccessResponse('No Pending', 'There are no pending applications.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            let content = `# <:Lightning:1521227915537285150> Pending Applications (${pending.length})\n\n`;
            for (const app of pending.slice(0, 15)) {
                content += `> <:User:1521227714227343380> <@${app.userId}> — \`${app.id}\` — <t:${Math.floor(app.submittedAt / 1000)}:R>\n`;
            }
            if (pending.length > 15) content += `\n-# +${pending.length - 15} more pending`;

            const container = new ContainerBuilder()
                .setAccentColor(0xFEE75C)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (interaction.customId === 'app_reset') {
            config[guildId] = getDefaultForm();
            saveConfig(config);

            const responses = loadResponses();
            delete responses[guildId];
            saveResponses(responses);

            await interaction.reply({ components: [buildSuccessResponse('Reset Complete', 'Application system reset to defaults. All responses cleared.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            await updatePanel(interaction.client, guildId, 'application', async (message) => {
                await message.edit({ components: [buildMainPanel(interaction.guild, config[guildId])] });
            });
            return;
        }

        if (interaction.customId.startsWith('app_accept_')) {
            const appId = interaction.customId.replace('app_accept_', '');

            if (reviewLocks.has(appId)) {
                return interaction.reply({ components: [buildErrorResponse('Processing', 'This application is already being processed by another moderator.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
            reviewLocks.add(appId);

            try {
            const responses = loadResponses();
            const guildResponses = responses[guildId] || {};
            const appData = guildResponses[appId];

            if (!appData) {
                reviewLocks.delete(appId);
                return interaction.reply({ components: [buildErrorResponse('Not Found', 'Application not found or already processed.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
            if (appData.status !== 'pending') {
                reviewLocks.delete(appId);
                return interaction.reply({ components: [buildErrorResponse('Already Processed', `Already **${appData.status}** by <@${appData.reviewedBy}>.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            appData.status = 'accepted';
            appData.reviewedBy = interaction.user.id;
            appData.reviewedAt = Date.now();
            responses[guildId] = guildResponses;
            saveResponses(responses);

            if (guildConfig.acceptRole) {
                const member = await interaction.guild.members.fetch(appData.userId).catch(() => null);
                if (member) await member.roles.add(guildConfig.acceptRole, 'Application accepted').catch(() => {});
            }

            const applicant = await interaction.client.users.fetch(appData.userId).catch(() => null);
            if (applicant) {
                applicant.send({
                    content:
                        `# <:Checkedbox:1521227734943269077> Application Accepted!\n\n` +
                        `Your application to **${interaction.guild.name}** has been **accepted**!\n\n` +
                        `> ${guildConfig.acceptMessage || 'Congratulations!'}\n\n` +
                        `-# ${interaction.guild.name}`
                }).catch(() => {});
            }

            const updatedContainer = new ContainerBuilder()
                .setAccentColor(0x57F287)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Application Accepted\n\n` +
                    `<:User:1521227714227343380> **Applicant:** <@${appData.userId}>\n` +
                    `<:Bookmark:1521227835526742066> **ID:** \`${appId}\`\n` +
                    `<:Shield:1521227694677692467> **Accepted by:** <@${interaction.user.id}>\n` +
                    `<:Alarm:1521227869047750689> **Time:** <t:${Math.floor(Date.now() / 1000)}:R>` +
                    (guildConfig.acceptRole ? `\n<:Userplus:1521227719621218477> **Role Given:** <@&${guildConfig.acceptRole}>` : '')
                ))
;

            await interaction.update({ components: [updatedContainer] });

            if (guildConfig.logChannel) {
                const logCh = interaction.guild.channels.cache.get(guildConfig.logChannel);
                if (logCh) logCh.send({ content: `<:Checkedbox:1521227734943269077> Application \`${appId}\` from <@${appData.userId}> **accepted** by <@${interaction.user.id}>` }).catch(() => {});
            }
            } finally {
                reviewLocks.delete(appId);
            }
            return;
        }

        if (interaction.customId.startsWith('app_deny_reason_')) {
            const appId = interaction.customId.replace('app_deny_reason_', '');
            const modal = new ModalBuilder()
                .setCustomId(`app_modal_deny_${appId}`)
                .setTitle('Deny Application');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('deny_reason').setLabel('Reason for denial').setStyle(TextInputStyle.Paragraph).setPlaceholder('Enter reason...').setRequired(true).setMaxLength(500)
                )
            );
            return interaction.showModal(modal);
        }

        if (interaction.customId.startsWith('app_deny_') && !interaction.customId.startsWith('app_deny_reason_')) {
            const appId = interaction.customId.replace('app_deny_', '');
            return handleDeny(interaction, guildId, appId, guildConfig, null);
        }
    },

    async handleModalSubmit(interaction) {
        if (!interaction.isModalSubmit()) return false;

        const config = loadConfig();
        const guildId = interaction.guild.id;
        let guildConfig = config[guildId];

        if (!guildConfig) {
            guildConfig = getDefaultForm();
            config[guildId] = guildConfig;
        }

        const { updatePanel } = require('../../utils/panelRegistry');

        if (interaction.customId === 'app_modal_info') {
            const name = interaction.fields.getTextInputValue('app_name');
            const desc = interaction.fields.getTextInputValue('app_desc');
            const cooldownHours = parseFloat(interaction.fields.getTextInputValue('app_cooldown') || '24');
            const colorHex = interaction.fields.getTextInputValue('app_color') || '#5865F2';

            guildConfig.name = name;
            guildConfig.description = desc;
            guildConfig.cooldown = Math.max(0, cooldownHours) * 3600000;

            const parsed = parseInt(colorHex.replace('#', ''), 16);
            if (!isNaN(parsed) && parsed >= 0 && parsed <= 0xFFFFFF) guildConfig.color = parsed;

            config[guildId] = guildConfig;
            saveConfig(config);

            await interaction.reply({ components: [buildSuccessResponse('Info Updated', `Name: **${name}** • Cooldown: **${cooldownHours}h**`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            await updatePanel(interaction.client, guildId, 'application', async (message) => {
                await message.edit({ components: [buildMainPanel(interaction.guild, guildConfig)] });
            });
            return true;
        }

        if (interaction.customId === 'app_modal_messages') {
            const acceptMsg = interaction.fields.getTextInputValue('app_accept_msg');
            const denyMsg = interaction.fields.getTextInputValue('app_deny_msg');

            guildConfig.acceptMessage = acceptMsg;
            guildConfig.denyMessage = denyMsg;
            config[guildId] = guildConfig;
            saveConfig(config);

            await interaction.reply({ components: [buildSuccessResponse('Messages Updated', 'Accept and deny messages have been updated.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        if (interaction.customId.startsWith('app_modal_deny_')) {
            const appId = interaction.customId.replace('app_modal_deny_', '');
            const reason = interaction.fields.getTextInputValue('deny_reason');
            await handleDeny(interaction, guildId, appId, guildConfig, reason);
            return true;
        }

        return false;
    }
};

async function handleDeny(interaction, guildId, appId, guildConfig, reason) {
    if (reviewLocks.has(appId)) {
        return interaction.reply({ components: [buildErrorResponse('Processing', 'This application is already being processed by another moderator.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }
    reviewLocks.add(appId);

    try {
    const responses = loadResponses();
    const guildResponses = responses[guildId] || {};
    const appData = guildResponses[appId];

    if (!appData) {
        return interaction.reply({ components: [buildErrorResponse('Not Found', 'Application not found or already processed.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }
    if (appData.status !== 'pending') {
        return interaction.reply({ components: [buildErrorResponse('Already Processed', `Already **${appData.status}** by <@${appData.reviewedBy}>.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    appData.status = 'denied';
    appData.reviewedBy = interaction.user.id;
    appData.reviewedAt = Date.now();
    appData.reason = reason;
    responses[guildId] = guildResponses;
    saveResponses(responses);

    const applicant = await interaction.client.users.fetch(appData.userId).catch(() => null);
    if (applicant) {
        applicant.send({
            content:
                `# <:Cancel:1521227723916181644> Application Denied\n\n` +
                `Your application to **${interaction.guild.name}** has been **denied**.\n\n` +
                (reason ? `> **Reason:** ${reason}\n\n` : `> ${guildConfig?.denyMessage || 'Your application has been denied.'}\n\n`) +
                `-# ${interaction.guild.name}`
        }).catch(() => {});
    }

    const updatedContainer = new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Cancel:1521227723916181644> Application Denied\n\n` +
            `<:User:1521227714227343380> **Applicant:** <@${appData.userId}>\n` +
            `<:Bookmark:1521227835526742066> **ID:** \`${appId}\`\n` +
            `<:Shield:1521227694677692467> **Denied by:** <@${interaction.user.id}>\n` +
            `<:Alarm:1521227869047750689> **Time:** <t:${Math.floor(Date.now() / 1000)}:R>` +
            (reason ? `\n<:Hashtag:1521227771957870604> **Reason:** ${reason}` : '')
        ))
;

    if (interaction.isModalSubmit()) {
        await interaction.reply({ components: [updatedContainer], flags: MessageFlags.IsComponentsV2 });
    } else {
        await interaction.update({ components: [updatedContainer] });
    }

    if (guildConfig?.logChannel) {
        const logCh = interaction.guild.channels.cache.get(guildConfig.logChannel);
        if (logCh) logCh.send({ content: `<:Cancel:1521227723916181644> Application \`${appId}\` from <@${appData.userId}> **denied** by <@${interaction.user.id}>${reason ? ` — ${reason}` : ''}` }).catch(() => {});
    }
    } finally {
        reviewLocks.delete(appId);
    }
}
