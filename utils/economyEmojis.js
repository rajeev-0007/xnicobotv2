'use strict';

/**
 * Centralized emoji map for all economy commands.
 * Use these instead of hardcoded Unicode emojis for consistency.
 */
const EMOJIS = {
    // Currency & Money
    coin:       '<:Money:1521228266957045900>',
    money:      '<:Money:1521228266957045900>',
    wallet:     '<:Money:1521228266957045900>',
    bank:       '<:Invoice:1521227903956811836>',
    invoice:    '<:Invoice:1521227903956811836>',
    present:    '<:Present:1521228115655917659>',
    crown:      '<:Crown:1521227739988889764>',
    sketch:     '<:Sketch:1521228025365004471>',

    // Status & Feedback
    check:      '<:Checkedbox:1521227734943269077>',
    cancel:     '<:Cancel:1521227723916181644>',
    fire:       '<:Fire:1521227907647668374>',
    star:       '<:Star:1521227981685526568>',
    lightning:  '<:Lightning:1521227915537285150>',
    clock:      '<:Clock:1521228110408847623>',
    sandwatch:  '<:Clock:1521228110408847623>',
    alarm:      '<:Alarm:1521227869047750689>',

    // Actions
    award:      '<:Award:1521228119640375336>',
    shield:     '<:Shield:1521227694677692467>',
    gamepad:    '<:Gamepad:1521228035213230090>',
    music:      '<:Music:1521228141543165982>',
    dice:       '<:Gamepad:1521228035213230090>',

    // UI
    info:       '<:Inforect:1521228008285929532>',
    settings:   '<:Settings:1521227767780343879>',
    edit:       '<:Editalt:1521227921673556019>',
    trash:      '<:Trash:1521227750420254820>',
    history:    '<:History:1521227863079256278>',
    bookopen:   '<:Bookopen:1521227911137595605>',
    document:   '<:Document:1521227875016114266>',
    eye:        '<:Eye:1521227940480815156>',
    lock:       '<:Lock:1521227892770734120>',
    user:       '<:User:1521227714227343380>',
    add:        '<:Add:1521227828199293152>',
    caretright: '<:Caretright:1521227704953864202>',

    // Shop & Items
    shop:       '<:Folder:1521228095225331765>',
    cart:       '<:Attach:1521228039135170722>',
    bag:        '<:Folder:1521228095225331765>',
    craft:      '<:Palette:1521227950601539755>',

    // Social
    heart:      '<:Heart:1521228100652765247>',
    chat:       '<:Hashtag:1521227771957870604>',
    bullhorn:   '<:Bullhorn:1521227936575914016>',
};

function buildCooldownBar(elapsed, total, length = 20) {
    const progress = Math.min(Math.floor((elapsed / total) * length), length);
    return '█'.repeat(progress) + '░'.repeat(length - progress);
}

function buildProgressBar(current, max, length = 15) {
    const filled = Math.min(Math.floor((current / max) * length), length);
    return '▓'.repeat(filled) + '░'.repeat(length - filled);
}

module.exports = { EMOJIS, buildCooldownBar, buildProgressBar };
