// Hybrid command utility for slash and prefix commands compatibility
const { EmbedBuilder } = require('discord.js');

function componentPayload(title, description, ephemeral = false) {
    const embed = new EmbedBuilder()
        .setColor(0xBCF1E4)
        .setTitle(title)
        .setDescription(description);

    const payload = {
        embeds: [embed],
        allowedMentions: { parse: [], repliedUser: false }
    };

    if (ephemeral) {
        payload.ephemeral = true;
    }

    return payload;
}

function getUser(target) {
    return target.user || target.author;
}

async function sendError(target, message) {
    const payload = componentPayload('Error', message, true);
    if (target.reply) {
        return await target.reply(payload);
    }
    return await target.channel.send(payload);
}

async function sendSuccess(target, title, description) {
    const payload = componentPayload(title, description);
    if (target.reply) {
        return await target.reply(payload);
    }
    return await target.channel.send(payload);
}

async function replyWithMessage(target, payload) {
    if (target.deferred) {
        return await target.editReply(payload);
    }
    if (target.replied) {
        return await target.followUp(payload);
    }
    if (target.reply) {
        return await target.reply(payload);
    }
    return await target.channel.send(payload);
}

module.exports = {
    componentPayload,
    getUser,
    sendError,
    sendSuccess,
    replyWithMessage
};
