
const jsonStore = require('./jsonStore');
const log = require('./logger-styled');

function loadRegistry() {
    if (!jsonStore.has('panel-registry')) {
        jsonStore.write('panel-registry', {});
        return {};
    }
    return jsonStore.read('panel-registry');
}

function saveRegistry(registry) {
    jsonStore.write('panel-registry', registry);
}

function registerPanel(guildId, panelType, channelId, messageId) {
    const registry = loadRegistry();
    
    if (!registry[guildId]) {
        registry[guildId] = {};
    }
    
    registry[guildId][panelType] = {
        channelId,
        messageId,
        timestamp: Date.now()
    };
    
    saveRegistry(registry);
}

function getPanel(guildId, panelType) {
    const registry = loadRegistry();
    return registry[guildId]?.[panelType] || null;
}

function removePanel(guildId, panelType) {
    const registry = loadRegistry();
    
    if (registry[guildId]?.[panelType]) {
        delete registry[guildId][panelType];
        
        if (Object.keys(registry[guildId]).length === 0) {
            delete registry[guildId];
        }
        
        saveRegistry(registry);
    }
}

async function updatePanel(client, guildId, panelType, updateFunction) {
    const panelInfo = getPanel(guildId, panelType);
    
    if (!panelInfo) {
        return { success: false, reason: 'Panel not registered' };
    }
    
    try {
        const channel = client.channels.cache.get(panelInfo.channelId);
        if (!channel) {
            removePanel(guildId, panelType);
            return { success: false, reason: 'Channel not found' };
        }
        
        const message = await channel.messages.fetch(panelInfo.messageId).catch(() => null);
        if (!message) {
            removePanel(guildId, panelType);
            return { success: false, reason: 'Message not found' };
        }
        
        await updateFunction(message);
        return { success: true, message };
    } catch (error) {
        log.error(`Error updating ${panelType} panel for guild ${guildId}:`, error);
        return { success: false, reason: error.message };
    }
}

module.exports = {
    registerPanel,
    getPanel,
    removePanel,
    updatePanel,
    loadRegistry,
    saveRegistry
};
