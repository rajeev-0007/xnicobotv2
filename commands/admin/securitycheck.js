const { PermissionFlagsBits, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { COLORS, buildErrorResponse } = require('../../utils/responseBuilder');
const fs = require('fs');
const path = require('path');
const jsonStore = require('../../utils/jsonStore');

const DATAS = path.join(__dirname, '..', '..', 'datas');

function loadJSON(filename) {
    const storeName = filename.replace('.json', '');
    return jsonStore.read(storeName);
}

module.exports = {
    name: 'securitycheck',
    prefix: 'securitycheck',
    description: 'Audit your server\'s security configuration and get recommendations',
    usage: 'securitycheck',
    category: 'admin',
    aliases: ['secaudit', 'securityaudit', 'scheck'],

    async executePrefix(message) {
        if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('<:Cancel:1521227723916181644> You need **Administrator** permission to use this command.');
        }

        try {
            const guildId = message.guild.id;
            const guild = message.guild;

            // Load all security-related configs
            const antinuke = loadJSON('antinuke.json')[guildId];
            const antiraid = loadJSON('antiraid.json')[guildId];
            const automod = loadJSON('automod.json')[guildId];
            const antialt = loadJSON('antialt.json')[guildId];
            const verification = loadJSON('verification.json')[guildId];
            const logs = loadJSON('logs.json')[guildId];
            const antispam = loadJSON('antispam.json')[guildId];
            const welcomer = loadJSON('welcomer.json')[guildId];

            // ── Score calculation ──
            let score = 0;
            let maxScore = 0;
            const checks = [];
            const recommendations = [];

            // 1. Antinuke
            maxScore += 20;
            if (antinuke?.enabled) {
                score += 15;
                const activeProtections = ['banProtection', 'kickProtection', 'channelDelete', 'channelCreate', 'roleDelete', 'roleCreate', 'webhookCreate', 'botAdd']
                    .filter(k => antinuke[k]?.enabled).length;
                if (activeProtections >= 6) score += 5;
                checks.push(`<:Toggleon:1521227758011809964> **Antinuke** — Active (${activeProtections}/8 protections)`);
                if (activeProtections < 6) recommendations.push('Enable all antinuke protections for full coverage');
                if (!antinuke.logChannel) recommendations.push('Set an antinuke log channel for audit trail');
            } else {
                checks.push(`<:Toggleoff:1521227763816595559> **Antinuke** — Disabled`);
                recommendations.push('**Enable antinuke** — protects against mass bans, kicks, channel/role deletion');
            }

            // 2. Antiraid
            maxScore += 20;
            if (antiraid?.enabled) {
                score += 15;
                const activeModules = ['joinRate', 'accountAge', 'autoLockdown', 'suspiciousPatterns']
                    .filter(k => antiraid[k]?.enabled).length;
                if (activeModules >= 3) score += 5;
                checks.push(`<:Toggleon:1521227758011809964> **Antiraid** — Active (${activeModules}/4 modules)`);
                if (!antiraid.logChannel) recommendations.push('Set an antiraid log channel');
            } else {
                checks.push(`<:Toggleoff:1521227763816595559> **Antiraid** — Disabled`);
                recommendations.push('**Enable antiraid** — protects against coordinated raid attacks');
            }

            // 3. Automod
            maxScore += 15;
            if (automod?.enabled) {
                score += 10;
                // The automod config is keyed by filter name — `spam.enabled`,
                // `links.enabled`, etc. (NOT antiSpam/antiLink booleans).
                const featureChecks = [
                    automod.spam?.enabled,
                    automod.links?.enabled,
                    automod.invites?.enabled,
                    automod.massMention?.enabled,
                    automod.badWords?.enabled,
                    automod.caps?.enabled,
                ];
                const features = featureChecks.filter(Boolean).length;
                if (features >= 3) score += 5;
                checks.push(`<:Toggleon:1521227758011809964> **Automod** — Active (${features}/${featureChecks.length} filters on)`);
            } else {
                checks.push(`<:Toggleoff:1521227763816595559> **Automod** — Disabled`);
                recommendations.push('**Enable automod** — filters invites, links, spam, and mass mentions');
            }

            // 4. Anti-alt
            maxScore += 10;
            if (antialt?.enabled) {
                score += 10;
                checks.push(`<:Toggleon:1521227758011809964> **Anti-Alt** — Active (min age: ${antialt.minAge || 7} days)`);
            } else {
                checks.push(`<:Toggleoff:1521227763816595559> **Anti-Alt** — Disabled`);
                recommendations.push('**Enable anti-alt** — blocks newly made accounts used for raids');
            }

            // 5. Anti-spam (check both standalone antispam.json AND automod spam module)
            maxScore += 10;
            const automodSpamEnabled = automod?.spam?.enabled;
            // antispam config layout: { enabled, filters: { messageSpam: { maxMessages, interval, action }, ... } }
            const standaloneSpam = antispam?.filters?.messageSpam || {};
            if (antispam?.enabled) {
                score += 10;
                const limit = standaloneSpam.maxMessages || antispam.maxMessages || 5;
                const interval = (standaloneSpam.interval || antispam.interval || 5000) / 1000;
                checks.push(`<:Toggleon:1521227758011809964> **Anti-Spam** — Active (${limit} msg/${interval}s)`);
            } else if (automodSpamEnabled) {
                score += 10;
                const spamLimit = automod.spam?.messageLimit || 5;
                const spamWindow = (automod.spam?.timeWindow || 5000) / 1000;
                checks.push(`<:Toggleon:1521227758011809964> **Anti-Spam** — Active via AutoMod (${spamLimit} msg/${spamWindow}s)`);
            } else {
                checks.push(`<:Toggleoff:1521227763816595559> **Anti-Spam** — Disabled`);
                recommendations.push('**Enable antispam** — prevents message flooding (`/antispam enable`)');
            }

            // 6. Logging
            maxScore += 15;
            if (logs) {
                const LOG_CATEGORIES = ['message', 'member', 'voice', 'server', 'moderation', 'automod', 'security', 'boost', 'commands', 'reactions', 'pins'];
                const activeLogTypes = LOG_CATEGORIES.filter(t => logs[t]).length;
                if (activeLogTypes > 0) {
                    score += Math.min(15, activeLogTypes * 1.5);
                    checks.push(`<:Checkedbox:1521227734943269077> **Logging** — ${activeLogTypes}/${LOG_CATEGORIES.length} types configured`);
                    if (activeLogTypes < LOG_CATEGORIES.length) recommendations.push('Configure all log types for complete audit trail');
                } else {
                    checks.push(`<:Cancel:1521227723916181644> **Logging** — No log channels set`);
                    recommendations.push('**Set up logging** — critical for tracking moderation actions');
                }
            } else {
                checks.push(`<:Cancel:1521227723916181644> **Logging** — Not configured`);
                recommendations.push('**Set up logging** — critical for tracking moderation actions');
            }

            // 7. Verification
            maxScore += 5;
            if (verification?.enabled) {
                score += 5;
                checks.push(`<:Toggleon:1521227758011809964> **Verification** — Active`);
            } else {
                checks.push(`<:Toggleoff:1521227763816595559> **Verification** — Disabled`);
                recommendations.push('Consider enabling verification for new members');
            }

            // 8. Guild-level checks
            maxScore += 5;
            const verificationLevel = guild.verificationLevel;
            const verLevels = ['None', 'Low', 'Medium', 'High', 'Very High'];
            if (verificationLevel >= 2) {
                score += 5;
                checks.push(`<:Checkedbox:1521227734943269077> **Discord Verification** — ${verLevels[verificationLevel] || verificationLevel}`);
            } else {
                checks.push(`<:Cancel:1521227723916181644> **Discord Verification** — ${verLevels[verificationLevel] || 'Low'}`);
                recommendations.push('Set Discord verification level to **Medium** or higher (Server Settings → Safety)');
            }

            // ── Calculate grade ──
            const percentage = Math.round((score / maxScore) * 100);
            let grade, gradeColor, gradeEmoji;
            if (percentage >= 90) { grade = 'A+'; gradeColor = 0x57F287; gradeEmoji = '<:online:1521228065752088576>'; }
            else if (percentage >= 80) { grade = 'A'; gradeColor = 0x57F287; gradeEmoji = '<:online:1521228065752088576>'; }
            else if (percentage >= 70) { grade = 'B'; gradeColor = 0xFEE75C; gradeEmoji = '<:idle:1521228053936603257>'; }
            else if (percentage >= 60) { grade = 'C'; gradeColor = 0xE67E22; gradeEmoji = '<:idle:1521228053936603257>'; }
            else if (percentage >= 40) { grade = 'D'; gradeColor = 0xED4245; gradeEmoji = '<:dnd:1521228070701502486>'; }
            else { grade = 'F'; gradeColor = 0xED4245; gradeEmoji = '<:dnd:1521228070701502486>'; }

            // ── Build progress bar ──
            const filled = Math.round(percentage / 10);
            const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

            // ── Build response ──
            const headerText = `# <:Shield:1521227694677692467> Security Audit — ${guild.name}\n\n` +
                `${gradeEmoji} **Grade: ${grade}** — ${percentage}% secured\n` +
                `\`${bar}\` ${score}/${maxScore} points`;

            const checksText = `### <:Document:1521227875016114266> Security Modules\n${checks.join('\n')}`;

            let recsText = '';
            if (recommendations.length > 0) {
                const topRecs = recommendations.slice(0, 5);
                recsText = `### <:Lightbulbalt:1521227880703463675> Recommendations\n` +
                    topRecs.map((r, i) => `**${i + 1}.** ${r}`).join('\n');
                if (recommendations.length > 5) {
                    recsText += `\n-# ...and ${recommendations.length - 5} more`;
                }
            } else {
                recsText = `### <:Lightbulbalt:1521227880703463675> Recommendations\n<:Checkedbox:1521227734943269077> **Excellent!** Your server security is fully configured.`;
            }

            const container = new ContainerBuilder()
                .setAccentColor(gradeColor)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(checksText))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(recsText))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Run this command periodically to ensure your server stays protected`))
;

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[SecurityCheck] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while running the security audit.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
