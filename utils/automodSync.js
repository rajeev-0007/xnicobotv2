/**
 * Syncs bot automod config to Discord's native AutoMod rules.
 * When users configure automod via the bot panel, this pushes the config
 * to Discord's server-level AutoMod so it works at the API level (real-time,
 * even if the bot is offline).
 * 
 * Discord AutoMod Limits:
 * - Max 6 rules per guild total
 * - Max 1 rule per Spam trigger
 * - Max 1 rule per KeywordPreset trigger  
 * - Max 1 rule per MentionSpam trigger
 * - Max 6 rules per Keyword trigger (we use 3: Bad Words, Invites, Links)
 * 
 * Our 6 native rules: Bad Words, Anti-Spam, Invite Blocker, Mass Mentions, Link Filter, Content Filter
 * Caps Lock filter = bot-side only (no Discord AutoMod equivalent)
 */

const { AutoModerationRuleTriggerType, AutoModerationRuleEventType, AutoModerationActionType, AutoModerationRuleKeywordPresetType } = require('discord.js');
const log = require('./logger-styled');

const BOT_RULE_PREFIX = 'XnicoBot: ';

// Old rule names to clean up (from before combining presets)
const LEGACY_RULE_NAMES = ['Anti-Profanity', 'Sexual Content', 'Anti-Slurs'];

/**
 * Map bot action names to Discord AutoMod action objects
 */
/**
 * Discord's AutoMod API rejects `Timeout` actions on Spam-trigger
 * rules with `AUTO_MODERATION_ACTION_TYPE_DISALLOWED`. Timeout is
 * only valid on Keyword, KeywordPreset, and MentionSpam triggers.
 *
 * `triggerType` is optional — when omitted we keep the legacy
 * "always allow timeout" behaviour, matching the existing call sites
 * for Keyword/MentionSpam/KeywordPreset rules. When the caller does
 * pass it, we silently downgrade timeout → block message for the
 * unsupported trigger types instead of crashing the upsert.
 */
function mapAction(action, logChannelId, triggerType) {
    const actions = [];

    // Block message for destructive actions
    if (['delete', 'timeout', 'kick', 'ban'].includes(action)) {
        actions.push({
            type: AutoModerationActionType.BlockMessage,
            metadata: { customMessage: '<:Shield:1521227694677692467> Message blocked by xNico AutoMod' }
        });
    }

    // Add timeout for timeout action — but only on triggers Discord allows.
    // Spam (1) and HarmfulLink (4) cannot accept Timeout actions.
    const timeoutAllowedTriggers = new Set([
        AutoModerationRuleTriggerType.Keyword,         // 1
        AutoModerationRuleTriggerType.KeywordPreset,   // 4
        AutoModerationRuleTriggerType.MentionSpam,     // 5
        AutoModerationRuleTriggerType.MemberProfile    // 6
    ]);
    const timeoutAllowed = triggerType === undefined || timeoutAllowedTriggers.has(triggerType);

    if (action === 'timeout' && timeoutAllowed) {
        actions.push({
            type: AutoModerationActionType.Timeout,
            metadata: { durationSeconds: 300 }
        });
    }

    // Send alert to log channel if configured
    if (logChannelId) {
        actions.push({
            type: AutoModerationActionType.SendAlertMessage,
            metadata: { channelId: logChannelId }
        });
    }

    // Warn = just alert, no block (unless no log channel)
    if (action === 'warn' && !logChannelId) {
        actions.push({
            type: AutoModerationActionType.BlockMessage,
            metadata: { customMessage: '<:Infotriangle:1521227710381428926> Your message was flagged by AutoMod' }
        });
    }

    // Fallback: must have at least one action
    if (actions.length === 0) {
        actions.push({
            type: AutoModerationActionType.BlockMessage,
            metadata: { customMessage: '<:Shield:1521227694677692467> Message blocked by xNico AutoMod' }
        });
    }

    return actions;
}

/**
 * Build exempt roles and channels arrays from config
 */
function buildExemptions(config) {
    const isSnowflake = id => typeof id === 'string' && /^\d{17,20}$/.test(id);
    const exemptRoles = [];
    const exemptChannels = [];

    if (config.ignoredRoles?.length) {
        exemptRoles.push(...config.ignoredRoles.filter(isSnowflake));
    }
    if (isSnowflake(config.bypassRoleId)) {
        exemptRoles.push(config.bypassRoleId);
    }
    if (config.ignoredChannels?.length) {
        exemptChannels.push(...config.ignoredChannels.filter(isSnowflake));
    }

    return {
        exemptRoles: [...new Set(exemptRoles)].slice(0, 20),
        exemptChannels: [...new Set(exemptChannels)].slice(0, 50)
    };
}

/**
 * Find ALL existing bot-managed rules in the guild (including legacy names)
 */
async function findBotRules(guild) {
    try {
        const rules = await guild.autoModerationRules.fetch();
        const botRules = {};
        for (const [, rule] of rules) {
            if (rule.name.startsWith(BOT_RULE_PREFIX)) {
                const type = rule.name.replace(BOT_RULE_PREFIX, '');
                botRules[type] = rule;
            }
        }
        return botRules;
    } catch (e) {
        log.error('[AutoMod Sync] Failed to fetch rules for ' + guild.name + ': ' + e.message);
        return {};
    }
}

/**
 * Fetch the guild's AutoMod rules once and split them into:
 *   - botRules:         our own rules, keyed by short name (e.g. "Anti-Spam")
 *   - foreignByTrigger: the FIRST non-bot rule for each trigger type
 *
 * The foreign map lets us detect when a singleton trigger type
 * (Spam / KeywordPreset / MentionSpam — Discord allows only one rule
 * of each per guild) is already occupied by a rule we don't own, so we
 * can skip creating a duplicate instead of spamming API errors.
 */
async function fetchRuleMaps(guild) {
    const botRules = {};
    const foreignByTrigger = {};
    try {
        const rules = await guild.autoModerationRules.fetch();
        for (const [, rule] of rules) {
            if (rule.name.startsWith(BOT_RULE_PREFIX)) {
                botRules[rule.name.replace(BOT_RULE_PREFIX, '')] = rule;
            } else if (foreignByTrigger[rule.triggerType] === undefined) {
                foreignByTrigger[rule.triggerType] = rule;
            }
        }
    } catch (e) {
        log.error('[AutoMod Sync] Failed to fetch rules for ' + guild.name + ': ' + e.message);
    }
    return { botRules, foreignByTrigger };
}

// Discord AutoMod error code for "too many rules of this trigger type".
const MAX_RULES_OF_TYPE_CODE = 200000;

/**
 * Create or update a Discord AutoMod rule.
 *
 * @param {object} foreignRule - When creating (no existing bot rule) a
 *   pre-existing NON-bot rule of the same singleton trigger type. If set,
 *   we skip creation quietly because Discord caps these trigger types at
 *   one rule per guild. Bot-side enforcement still runs in real time.
 */
async function upsertRule(guild, existingRule, name, options, foreignRule = null) {
    const fullName = BOT_RULE_PREFIX + name;
    try {
        if (existingRule) {
            await existingRule.edit({ ...options, name: fullName });
            log.info('[AutoMod Sync] Updated rule "' + fullName + '" in ' + guild.name);
            return true;
        }

        // A non-bot rule already owns this singleton trigger type — skip
        // quietly instead of triggering AUTO_MODERATION_MAX_RULES_OF_TYPE_EXCEEDED
        // on every sync cycle.
        if (foreignRule) {
            log.warning('[AutoMod Sync] Skipped "' + fullName + '" in ' + guild.name +
                ' — native rule "' + foreignRule.name + '" already uses this trigger type (Discord limit: 1). Bot-side enforcement remains active.');
            return false;
        }

        await guild.autoModerationRules.create({
            ...options,
            name: fullName,
            eventType: AutoModerationRuleEventType.MessageSend
        });
        log.info('[AutoMod Sync] Created rule "' + fullName + '" in ' + guild.name);
        return true;
    } catch (e) {
        const msg = (e && e.message) ? e.message : String(e);
        // Trigger-type / total-rule limit reached — Discord allows only one
        // Spam/KeywordPreset/MentionSpam rule per guild (and 6 total).
        if (e.code === MAX_RULES_OF_TYPE_CODE || /MAX_RULES(_OF_TYPE)?_EXCEEDED/i.test(msg)) {
            log.warning('[AutoMod Sync] Skipped "' + fullName + '" in ' + guild.name +
                ' — Discord already has the maximum rules for this trigger type. Bot-side enforcement remains active.');
            return false;
        }
        // Any OTHER rejection (Invalid Form Body, validation, missing access,
        // unsupported regex, etc.) is non-fatal: xNico's own message pipeline
        // still enforces this filter in real time. Downgrade to ONE concise
        // warning so the console is never spammed with red error boxes.
        log.warning('[AutoMod Sync] Could not deploy native rule "' + fullName + '" in ' + guild.name +
            ' — ' + msg.split('\n')[0].slice(0, 120) + '. Bot-side enforcement remains active.');
        return false;
    }
}

/**
 * Delete a rule if it exists
 */
async function deleteRuleIfExists(existingRule) {
    if (existingRule) {
        try {
            await existingRule.delete();
            return true;
        } catch (e) {
            // Ignore — rule may have already been deleted
        }
    }
    return false;
}

/**
 * Clean up old legacy rules that were created before combining presets
 */
async function cleanupLegacyRules(botRules) {
    for (const legacyName of LEGACY_RULE_NAMES) {
        if (botRules[legacyName]) {
            await deleteRuleIfExists(botRules[legacyName]);
            log.info('[AutoMod Sync] Cleaned up legacy rule: ' + legacyName);
            delete botRules[legacyName];
        }
    }
}

/**
 * Main sync function — call this whenever automod config is saved
 * Deploys up to 6 Discord AutoMod rules:
 *   1. Bad Words (Keyword)
 *   2. Anti-Spam (Spam)
 *   3. Invite Blocker (Keyword)
 *   4. Mass Mentions (MentionSpam)
 *   5. Link Filter (Keyword)
 *   6. Content Filter (KeywordPreset — combines Profanity + Sexual + Slurs)
 */
async function syncToDiscord(guild, config) {
    if (!guild || !config) return;

    const me = guild.members.me;
    if (!me?.permissions?.has('ManageGuild')) {
        log.warning('[AutoMod Sync] Missing ManageGuild permission in ' + guild.name);
        return;
    }

    try {
        const { botRules, foreignByTrigger } = await fetchRuleMaps(guild);
        const { exemptRoles, exemptChannels } = buildExemptions(config);
        const logChannelId = config.logChannel || null;
        const on = config.enabled;

        // STEP 1: Clean up old legacy preset rules FIRST
        await cleanupLegacyRules(botRules);

        // RULE 1: Bad Words (Keyword)
        if (on && config.badWords?.enabled && config.badWords.words?.length > 0) {
            // Discord keywordFilter: each entry 1–60 chars, max 1000, deduped.
            const keywords = [...new Set(
                config.badWords.words
                    .map(w => String(w || '').trim())
                    .filter(w => w.length > 0 && w.length <= 60)
            )].slice(0, 1000);

            if (keywords.length > 0) {
                await upsertRule(guild, botRules['Bad Words'], 'Bad Words', {
                    triggerType: AutoModerationRuleTriggerType.Keyword,
                    triggerMetadata: { keywordFilter: keywords },
                    actions: mapAction(config.badWords.action || 'delete', logChannelId),
                    enabled: true,
                    exemptRoles,
                    exemptChannels
                });
            } else {
                await deleteRuleIfExists(botRules['Bad Words']);
            }
        } else {
            await deleteRuleIfExists(botRules['Bad Words']);
        }

        // RULE 2: Anti-Spam (Spam — singleton trigger type, Discord limit = 1)
        if (on && config.spam?.enabled) {
            await upsertRule(guild, botRules['Anti-Spam'], 'Anti-Spam', {
                triggerType: AutoModerationRuleTriggerType.Spam,
                triggerMetadata: {},
                // Spam-trigger rules cannot use Timeout actions — pass
                // the triggerType so mapAction() downgrades correctly.
                actions: mapAction(config.spam.action || 'delete', logChannelId, AutoModerationRuleTriggerType.Spam),
                enabled: true,
                exemptRoles,
                exemptChannels
            }, botRules['Anti-Spam'] ? null : foreignByTrigger[AutoModerationRuleTriggerType.Spam]);
        } else {
            await deleteRuleIfExists(botRules['Anti-Spam']);
        }

        // RULE 3: Invite Blocker (Keyword regex)
        if (on && config.invites?.enabled) {
            await upsertRule(guild, botRules['Invite Blocker'], 'Invite Blocker', {
                triggerType: AutoModerationRuleTriggerType.Keyword,
                triggerMetadata: {
                    regexPatterns: [
                        'discord\\.gg/[a-zA-Z0-9\\-]+',
                        'discord(app)?\\.com/invite/[a-zA-Z0-9\\-]+',
                        'dsc\\.gg/[a-zA-Z0-9\\-]+'
                    ]
                },
                actions: mapAction(config.invites.action || 'delete', logChannelId),
                enabled: true,
                exemptRoles,
                exemptChannels
            });
        } else {
            await deleteRuleIfExists(botRules['Invite Blocker']);
        }

        // RULE 4: Mass Mentions (MentionSpam — singleton trigger type, Discord limit = 1)
        if (on && config.massMention?.enabled) {
            // Discord requires an integer 1–50.
            const mentionLimit = Math.max(1, Math.min(50, parseInt(config.massMention.limit, 10) || 5));
            await upsertRule(guild, botRules['Mass Mentions'], 'Mass Mentions', {
                triggerType: AutoModerationRuleTriggerType.MentionSpam,
                triggerMetadata: { mentionTotalLimit: mentionLimit },
                actions: mapAction(config.massMention.action || 'delete', logChannelId),
                enabled: true,
                exemptRoles,
                exemptChannels
            }, botRules['Mass Mentions'] ? null : foreignByTrigger[AutoModerationRuleTriggerType.MentionSpam]);
        } else {
            await deleteRuleIfExists(botRules['Mass Mentions']);
        }

        // RULE 5: Link Filter (Keyword regex)
        if (on && config.links?.enabled) {
            await upsertRule(guild, botRules['Link Filter'], 'Link Filter', {
                triggerType: AutoModerationRuleTriggerType.Keyword,
                triggerMetadata: {
                    regexPatterns: [
                        'https?://[^\\s]+',
                        'www\\.[^\\s]+'
                    ],
                    // Discord allowList: each entry 1–60 chars, max 100, deduped.
                    allowList: [...new Set(
                        (config.links.whitelist || [])
                            .map(d => String(d || '').trim().toLowerCase())
                            .filter(d => d.length > 0 && d.length <= 60)
                    )].slice(0, 100)
                },
                actions: mapAction(config.links.action || 'delete', logChannelId),
                enabled: true,
                exemptRoles,
                exemptChannels
            });
        } else {
            await deleteRuleIfExists(botRules['Link Filter']);
        }

        // RULE 6: Content Filter (KeywordPreset — SINGLE rule, Discord limit = 1)
        // Combines Profanity + SexualContent + Slurs into one rule
        const enabledPresets = [];
        if (config.profanity?.enabled) {
            enabledPresets.push(AutoModerationRuleKeywordPresetType.Profanity);
        }
        if (config.sexualContent?.enabled) {
            enabledPresets.push(AutoModerationRuleKeywordPresetType.SexualContent);
        }
        if (config.slurs?.enabled) {
            enabledPresets.push(AutoModerationRuleKeywordPresetType.Slurs);
        }

        if (on && enabledPresets.length > 0) {
            await upsertRule(guild, botRules['Content Filter'], 'Content Filter', {
                triggerType: AutoModerationRuleTriggerType.KeywordPreset,
                triggerMetadata: { presets: enabledPresets },
                actions: mapAction('delete', logChannelId),
                enabled: true,
                exemptRoles,
                exemptChannels
            }, botRules['Content Filter'] ? null : foreignByTrigger[AutoModerationRuleTriggerType.KeywordPreset]);
        } else {
            await deleteRuleIfExists(botRules['Content Filter']);
        }

        // Caps Lock = bot-side only (no Discord AutoMod equivalent)

        log.info('[AutoMod Sync] Synced all rules for ' + guild.name);
    } catch (error) {
        log.error('[AutoMod Sync] Error syncing ' + guild.name + ': ' + error.message);
    }
}

/**
 * Remove all bot-managed AutoMod rules (when automod is fully disabled)
 */
async function removeAllBotRules(guild) {
    if (!guild) return;
    try {
        const botRules = await findBotRules(guild);
        for (const [name, rule] of Object.entries(botRules)) {
            await rule.delete().catch(() => {});
        }
        log.info('[AutoMod Sync] Removed all bot rules from ' + guild.name);
    } catch (e) {
        log.error('[AutoMod Sync] Error removing rules: ' + e.message);
    }
}

module.exports = { syncToDiscord, removeAllBotRules, BOT_RULE_PREFIX };
