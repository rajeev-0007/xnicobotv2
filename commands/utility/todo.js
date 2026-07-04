'use strict';

/**
 * Personal TODO system
 * ───────────────────────────────────────────────────────────────────
 * A minimal, per-user task list rendered through Components V2.
 *
 *   /todo add    <task>     — add a task
 *   /todo list              — view your tasks
 *   /todo remove <number>   — remove one task by its list number
 *   /todo clear             — remove all your tasks
 *
 * Prefix equivalents: `todo add …`, `todo list`, `todo remove <n>`, `todo clear`.
 *
 * Persistence (jsonStore):
 *   todos  { [userId]: [ { text, createdAt } ] }   // newest last
 */

const {
    SlashCommandBuilder, MessageFlags,
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
} = require('discord.js');

const jsonStore = require('../../utils/jsonStore');

const ACCENT = 0x5865F2;
const MAX_TODOS = 50;
const MAX_LEN = 200;
const SHOW_LIMIT = 25;

// Minimal custom-emoji palette (kept consistent with the rest of the bot).
const E = {
    list:   '<:Document:1521227875016114266>',
    add:    '<:Add:1521227828199293152>',
    remove: '<:Trash:1521227750420254820>',
    check:  '<:Checkedbox:1521227734943269077>',
    cancel: '<:Cancel:1521227723916181644>',
    bullet: '<:Caretright:1521227704953864202>',
    info:   '<:Inforect:1521228008285929532>',
};

/* ─────────────────────────── store helpers ─────────────────────── */

function loadStore() {
    const data = jsonStore.read('todos');
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
}

function getTodos(userId) {
    const store = loadStore();
    const arr = store[userId];
    return Array.isArray(arr) ? arr : [];
}

function setTodos(userId, todos) {
    const store = loadStore();
    if (todos.length) store[userId] = todos;
    else delete store[userId];
    jsonStore.write('todos', store);
}

/* ─────────────────────────── renderers ─────────────────────────── */

function panel(accent, text) {
    return new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

function buildListContainer(todos) {
    if (!todos.length) {
        return panel(ACCENT,
            `# ${E.list} Your To-Do List\n\n` +
            `Nothing here yet.\n` +
            `-# Add one with \`/todo add\` or \`todo add <task>\`.`
        );
    }

    const shown = todos.slice(0, SHOW_LIMIT);
    const lines = shown.map((t, i) => `${E.bullet} \`${String(i + 1).padStart(2, '0')}\` ${t.text}`);
    let body =
        `# ${E.list} Your To-Do List\n\n` +
        `${lines.join('\n')}`;
    if (todos.length > SHOW_LIMIT) {
        body += `\n\n-# +${todos.length - SHOW_LIMIT} more — remove some to see the rest.`;
    }
    body += `\n-# ${todos.length}/${MAX_TODOS} tasks · remove with \`/todo remove <number>\``;

    return panel(ACCENT, body);
}

/* ─────────────────────────── core actions ──────────────────────── */
// Each returns a ContainerBuilder so slash + prefix share the exact output.

function actionAdd(userId, rawText) {
    const text = String(rawText || '').trim().replace(/\s+/g, ' ').slice(0, MAX_LEN);
    if (!text) {
        return panel(0xED4245, `# ${E.cancel} Nothing to Add\n\nProvide the task text — e.g. \`todo add Finish the report\`.`);
    }

    const todos = getTodos(userId);
    if (todos.length >= MAX_TODOS) {
        return panel(0xFEE75C, `# ${E.info} List Full\n\nYou've reached the **${MAX_TODOS}** task limit. Remove or clear some first.`);
    }

    todos.push({ text, createdAt: Date.now() });
    setTodos(userId, todos);

    return panel(0x57F287,
        `# ${E.check} Task Added\n\n` +
        `${E.bullet} ${text}\n` +
        `-# You now have **${todos.length}** task${todos.length !== 1 ? 's' : ''}.`
    );
}

function actionRemove(userId, rawNumber) {
    const todos = getTodos(userId);
    if (!todos.length) {
        return panel(0xED4245, `# ${E.cancel} Nothing to Remove\n\nYour to-do list is already empty.`);
    }

    const num = parseInt(rawNumber, 10);
    if (isNaN(num) || num < 1 || num > todos.length) {
        return panel(0xED4245,
            `# ${E.cancel} Invalid Number\n\n` +
            `Pick a task number between **1** and **${todos.length}**.\n` +
            `-# Use \`/todo list\` to see the numbers.`
        );
    }

    const [removed] = todos.splice(num - 1, 1);
    setTodos(userId, todos);

    return panel(0x57F287,
        `# ${E.check} Task Removed\n\n` +
        `${E.remove} ~~${removed.text}~~\n` +
        `-# ${todos.length} task${todos.length !== 1 ? 's' : ''} remaining.`
    );
}

function actionClear(userId) {
    const todos = getTodos(userId);
    if (!todos.length) {
        return panel(0xED4245, `# ${E.cancel} Nothing to Clear\n\nYour to-do list is already empty.`);
    }
    const count = todos.length;
    setTodos(userId, []);
    return panel(0x57F287,
        `# ${E.check} List Cleared\n\n` +
        `Removed **${count}** task${count !== 1 ? 's' : ''}.`
    );
}

/* ─────────────────────────── command export ────────────────────── */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('todo')
        .setDescription('Manage your personal to-do list')
        .addSubcommand(s => s
            .setName('add')
            .setDescription('Add a task to your list')
            .addStringOption(o => o.setName('task').setDescription('What do you need to do?').setRequired(true).setMaxLength(MAX_LEN)))
        .addSubcommand(s => s
            .setName('list')
            .setDescription('View your to-do list'))
        .addSubcommand(s => s
            .setName('remove')
            .setDescription('Remove a task by its list number')
            .addIntegerOption(o => o.setName('number').setDescription('The task number from /todo list').setRequired(true).setMinValue(1)))
        .addSubcommand(s => s
            .setName('clear')
            .setDescription('Remove all of your tasks')),

    prefix: 'todo',
    aliases: ['todos', 'td'],
    description: 'Manage your personal to-do list (add, list, remove, clear)',
    usage: 'todo <add|list|remove|clear> [text|number]',
    category: 'utility',

    async execute(interaction) {
        const userId = interaction.user.id;
        const sub = interaction.options.getSubcommand();

        let container;
        switch (sub) {
            case 'add':
                container = actionAdd(userId, interaction.options.getString('task'));
                break;
            case 'remove':
                container = actionRemove(userId, interaction.options.getInteger('number'));
                break;
            case 'clear':
                container = actionClear(userId);
                break;
            case 'list':
            default:
                container = buildListContainer(getTodos(userId));
                break;
        }

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async executePrefix(message, args) {
        const userId = message.author.id;
        const sub = (args[0] || 'list').toLowerCase();
        const rest = args.slice(1);

        let container;
        switch (sub) {
            case 'add':
            case 'a':
                container = actionAdd(userId, rest.join(' '));
                break;
            case 'remove':
            case 'rm':
            case 'r':
            case 'delete':
            case 'del':
                container = actionRemove(userId, rest[0]);
                break;
            case 'clear':
            case 'reset':
                container = actionClear(userId);
                break;
            case 'list':
            case 'ls':
            default:
                container = buildListContainer(getTodos(userId));
                break;
        }

        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },
};
