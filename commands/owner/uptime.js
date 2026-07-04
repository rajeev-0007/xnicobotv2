'use strict';

const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { isOwner } = require('../../utils/helpers');
const uptimeMonitor = require('../../utils/uptimeMonitor');

const E = {
    ok:     '<:Checkedbox:1521227734943269077>',
    no:     '<:Cancel:1521227723916181644>',
    gear:   '<:Settings:1521227767780343879>',
    bullet: '<:Caretright:1521227704953864202>',
    on:     '<:Toggleon:1521227758011809964>',
    off:    '<:Toggleoff:1521227763816595559>',
    bolt:   '<:Lightning:1521227915537285150>',
    clock:  '<:Clock:1521228110408847623>',
};

const WEBHOOK_RE = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/i;

function panel(title, body, accent = 0xCAD7E6) {
    return new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}\n\n${body}`));
}
function reply(message, container) {
    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

function statusPanel() {
    const cfg = uptimeMonitor.getConfig();
    const hb = uptimeMonitor.readHeartbeat();
    const name = cfg.displayName || hb?.botName || 'Bot';
    const uptimeStr = hb?.startTime ? uptimeMonitor.formatDuration(Date.now() - hb.startTime) : 'Unknown';

    const body =
        `### ${E.gear} Configuration\n` +
        `${E.bullet} **Status:** ${cfg.enabled ? `${E.on} Enabled` : `${E.off} Disabled`}\n` +
        `${E.bullet} **Webhook:** ${cfg.webhookUrl ? '`Configured`' : '*Not set*'}\n` +
        `${E.bullet} **Threshold:** \`${cfg.thresholdSec}s\` without heartbeat\n` +
        `${E.bullet} **Display Name:** ${cfg.displayName ? `\`${cfg.displayName}\`` : `*${name} (auto)*`}\n` +
        `${E.bullet} **Current Uptime:** \`${uptimeStr}\`\n\n` +
        `### ${E.bolt} Commands\n` +
        `${E.bullet} \`uptime set <webhook_url>\` — set the notify webhook\n` +
        `${E.bullet} \`uptime on\` / \`uptime off\` — enable / disable\n` +
        `${E.bullet} \`uptime threshold <seconds>\` — offline detection window (min 15)\n` +
        `${E.bullet} \`uptime name <text>\` — custom display name (\`reset\` to clear)\n` +
        `${E.bullet} \`uptime test\` — send a test notification\n` +
        `${E.bullet} \`uptime remove\` — clear the webhook\n\n` +
        `-# Offline/online notices are posted by the shard manager, so they fire even if the bot crashes.`;

    return panel(`${E.gear} Uptime Monitor`, body, cfg.enabled ? 0x57F287 : 0xCAD7E6);
}

module.exports = {
    name: 'uptimemonitor',
    prefix: 'uptimemonitor',
    description: 'Configure the offline/online uptime webhook notifications (owner only)',
    usage: 'uptimemonitor <set|on|off|threshold|name|test|remove|status>',
    category: 'owner',
    ownerOnly: true,
    aliases: ['uptimemon', 'statuswebhook'],

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            return reply(message, panel(`${E.no} Bot Owner Only`, 'This command can only be used by the bot owner.', 0xED4245));
        }

        const action = (args[0] || 'status').toLowerCase();

        // ── set webhook ──
        if (action === 'set') {
            const url = args[1];
            if (!url || !WEBHOOK_RE.test(url)) {
                return reply(message, panel(`${E.no} Invalid Webhook`, 'Provide a valid Discord webhook URL.\n\n-# `uptime set https://discord.com/api/webhooks/…`', 0xED4245));
            }
            uptimeMonitor.setConfig({ webhookUrl: url, enabled: true });
            // Best-effort delete of the invoking message so the URL isn't left in chat.
            if (message.deletable) message.delete().catch(() => {});
            const ok = await uptimeMonitor.sendTest();
            return reply(message, panel(`${E.ok} Webhook Configured`,
                `Uptime notifications are now **enabled**.\n` +
                `${ok ? `${E.bullet} A test message was sent to the webhook.` : `${E.bullet} ${E.no} Could not reach the webhook — double-check the URL.`}\n\n` +
                `-# Your message was deleted to keep the webhook URL private.`,
                ok ? 0x57F287 : 0xFEE75C));
        }

        // ── enable / disable ──
        if (action === 'on' || action === 'enable') {
            const cfg = uptimeMonitor.getConfig();
            if (!cfg.webhookUrl) return reply(message, panel(`${E.no} No Webhook`, 'Set a webhook first with `uptime set <url>`.', 0xED4245));
            uptimeMonitor.setConfig({ enabled: true });
            return reply(message, panel(`${E.ok} Enabled`, 'Uptime notifications are now **enabled**.', 0x57F287));
        }
        if (action === 'off' || action === 'disable') {
            uptimeMonitor.setConfig({ enabled: false });
            return reply(message, panel(`${E.no} Disabled`, 'Uptime notifications are now **disabled**.', 0xED4245));
        }

        // ── threshold ──
        if (action === 'threshold') {
            const sec = parseInt(args[1], 10);
            if (isNaN(sec) || sec < 15 || sec > 3600) {
                return reply(message, panel(`${E.no} Invalid Threshold`, 'Threshold must be between **15** and **3600** seconds.', 0xED4245));
            }
            uptimeMonitor.setConfig({ thresholdSec: sec });
            return reply(message, panel(`${E.ok} Threshold Updated`, `The bot is considered offline after \`${sec}s\` without a heartbeat.`, 0x57F287));
        }

        // ── display name ──
        if (action === 'name') {
            const val = args.slice(1).join(' ').trim();
            if (!val) return reply(message, panel(`${E.no} No Name`, 'Provide a display name, or use `uptime name reset`.', 0xED4245));
            if (/^reset$/i.test(val)) {
                uptimeMonitor.setConfig({ displayName: null });
                return reply(message, panel(`${E.ok} Name Reset`, 'Notifications will use the bot username.', 0x57F287));
            }
            uptimeMonitor.setConfig({ displayName: val.slice(0, 80) });
            return reply(message, panel(`${E.ok} Name Set`, `Notifications will now show **${val.slice(0, 80)}**.`, 0x57F287));
        }

        // ── test ──
        if (action === 'test') {
            const cfg = uptimeMonitor.getConfig();
            if (!cfg.webhookUrl) return reply(message, panel(`${E.no} No Webhook`, 'Set a webhook first with `uptime set <url>`.', 0xED4245));
            const ok = await uptimeMonitor.sendTest(cfg);
            return reply(message, ok
                ? panel(`${E.ok} Test Sent`, 'A test notification was posted to the webhook.', 0x57F287)
                : panel(`${E.no} Test Failed`, 'Could not reach the webhook. Check the URL with `uptime set <url>`.', 0xED4245));
        }

        // ── remove ──
        if (action === 'remove' || action === 'clear') {
            uptimeMonitor.setConfig({ webhookUrl: null, enabled: false });
            return reply(message, panel(`${E.ok} Webhook Removed`, 'The uptime webhook was cleared and notifications disabled.', 0x57F287));
        }

        // ── status (default) ──
        return reply(message, statusPanel());
    }
};
