const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');

function createContainer(accentColor = null) {
    const container = new ContainerBuilder();
    if (accentColor) {
        container.setAccentColor(accentColor);
    }
    return container;
}

function addTextDisplay(container, content) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    return container;
}

function addSeparator(container, spacing = SeparatorSpacingSize.Small) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(spacing).setDivider(true));
    return container;
}

function createSection(text, thumbnailUrl = null) {
    const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    if (thumbnailUrl) {
        section.setThumbnail(new ThumbnailBuilder().setURL(thumbnailUrl));
    }
    return section;
}

function createMediaGallery(items) {
    const gallery = new MediaGalleryBuilder();
    for (const item of items) {
        const galleryItem = new MediaGalleryItemBuilder().setURL(item.url);
        // Description is optional; an empty string throws "Invalid string length".
        const desc = String(item.description ?? '').trim().slice(0, 1024);
        if (desc) galleryItem.setDescription(desc);
        gallery.addItems(galleryItem);
    }
    return gallery;
}

function formatDuration(ms) {
    if (!ms || ms < 0) return '0s';
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    return parts.join(' ');
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function truncateText(text, maxLength = 100) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

/**
 * Discord caps a single TextDisplay component at 4000 characters. Lists
 * built from arbitrary user data (autoresponses, custom-shop items, level
 * roles, tracked accounts, etc.) can blow past that quickly.
 *
 * Joins `lines` with `separator`, prepends `header` and appends `footer`,
 * and stops adding lines once the next one would push past `maxLength`.
 * If anything was dropped, a "+N more" hint is appended to the footer so
 * users always know there's more.
 *
 * @param {object}   opts
 * @param {string}   [opts.header]      Optional title block
 * @param {string[]} opts.lines         Lines to render
 * @param {string}   [opts.separator]   String inserted between lines (default '\n')
 * @param {string}   [opts.footer]      Optional footer block
 * @param {number}   [opts.maxLength]   Max characters (default 3900 — leaves headroom under Discord's 4000 cap)
 * @param {string}   [opts.overflowHint] Template for the "more" hint, `${n}` is replaced with the dropped count
 * @returns {{ content: string, shown: number, dropped: number }}
 */
function buildSafeListText({
    header = '',
    lines = [],
    separator = '\n',
    footer = '',
    maxLength = 3900,
    overflowHint = '\n-# +${n} more not shown — narrow the list or use pagination',
} = {}) {
    const headerPart = header ? header + (header.endsWith('\n') ? '' : '\n') : '';
    const footerPart = footer ? (footer.startsWith('\n') ? '' : '\n') + footer : '';
    let body = '';
    let shown = 0;

    for (let i = 0; i < lines.length; i++) {
        const candidate = body ? body + separator + lines[i] : lines[i];
        const dropped = lines.length - (i);
        const hint = dropped > 0 ? overflowHint.replace('${n}', String(dropped)) : '';
        // Reserve room for the overflow hint in case the *next* iteration
        // can't fit. We re-check each step so the final shown count is accurate.
        if ((headerPart.length + candidate.length + footerPart.length + hint.length) > maxLength) {
            const droppedNow = lines.length - shown;
            const finalHint = droppedNow > 0 ? overflowHint.replace('${n}', String(droppedNow)) : '';
            return {
                content: headerPart + body + finalHint + footerPart,
                shown,
                dropped: droppedNow,
            };
        }
        body = candidate;
        shown++;
    }

    return {
        content: headerPart + body + footerPart,
        shown,
        dropped: 0,
    };
}

function parseTimeString(str) {
    if (!str) return null;
    const regex = /(\d+)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks)/gi;
    let totalMs = 0;
    let match;
    
    while ((match = regex.exec(str)) !== null) {
        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        
        if (unit.startsWith('s')) totalMs += value * 1000;
        else if (unit.startsWith('m') && !unit.startsWith('mo')) totalMs += value * 60 * 1000;
        else if (unit.startsWith('h')) totalMs += value * 60 * 60 * 1000;
        else if (unit.startsWith('d')) totalMs += value * 24 * 60 * 60 * 1000;
        else if (unit.startsWith('w')) totalMs += value * 7 * 24 * 60 * 60 * 1000;
    }
    
    return totalMs > 0 ? totalMs : null;
}

function getErrorContainer(message, emoji = '<:Cancel:1521227723916181644>') {
    return createContainer(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${emoji} ${message}`));
}

function getSuccessContainer(message, emoji = '<:Checkedbox:1521227734943269077>') {
    return createContainer()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${emoji} ${message}`));
}

function getInfoContainer(message, emoji = '<:Bookopen:1521227911137595605>') {
    return createContainer()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${emoji} ${message}`));
}

function getWarningContainer(message, emoji = '<:Infotriangle:1521227710381428926>') {
    return createContainer(0xFEE75C)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${emoji} ${message}`));
}

module.exports = {
    createContainer,
    addTextDisplay,
    addSeparator,
    createSection,
    createMediaGallery,
    formatDuration,
    formatNumber,
    truncateText,
    buildSafeListText,
    parseTimeString,
    getErrorContainer,
    getSuccessContainer,
    getInfoContainer,
    getWarningContainer,
    MessageFlags,
    SeparatorSpacingSize
};
