/* =========================================================
   xNico Dashboard — app.js v4.0
   - Hash-based router
   - Auth via Discord OAuth + JWT
   - Module pages auto-generated from modules.js schema
   ========================================================= */

console.log('[xNico] Dashboard v4.0 booting…');

const CFG = window.DASHBOARD_CONFIG || {};
const API_BASE = CFG.API_BASE_URL || '';

let state = {
    token: localStorage.getItem('token'),
    user: null,
    guilds: [],
    currentGuild: null,        // { id, name, icon, botPresent }
    channels: [],
    roles: [],
    premium: null,
    botInfo: null,
    stats: null,
    moduleStatus: {},          // guildId -> { moduleId -> enabled }
};

// â”€â”€â”€â”€â”€ utilities â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => (s == null ? '' : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

// â”€â”€ Discord-style message renderer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Turns raw Discord message content into HTML that approximates how Discord
// actually displays it in the dashboard previews: custom emojis as images,
// mentions/channels/roles as pills, timestamps, and markdown (bold, italic,
// underline, strike, spoiler, code, headers, quotes, masked links).
//
// The input is untrusted config text, so we HTML-escape FIRST and only emit
// generated markup with validated (numeric) IDs. Emojis/mentions/links/code
// are "stashed" as placeholders before markdown runs, then restored — so
// markdown regexes can never corrupt a generated tag (e.g. an emoji name or
// URL containing underscores).
function renderDiscord(input) {
    if (input == null) return '';
    let s = String(input);

    // 1) Escape HTML — everything after this only ADDS known-safe tags.
    s = s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // 2) Stash generated tags so markdown can't touch them.
    const store = [];
    const stash = html => `@@\u00a7${store.push(html) - 1}\u00a7@@`;

    // Fenced code blocks ```lang\n...```
    s = s.replace(/```(?:[a-zA-Z0-9+#.-]*\n)?([\s\S]*?)```/g, (m, code) =>
        stash(`<pre class="d-pre"><code>${code.replace(/^\n|\n$/g, '')}</code></pre>`));
    // Inline `code`
    s = s.replace(/`([^`\n]+?)`/g, (m, code) => stash(`<code class="d-code">${code}</code>`));
    // Custom emojis: <a:name:id> (animated) / <:name:id> (static) — escaped form.
    s = s.replace(/&lt;(a)?:(\w{2,32}):(\d{5,25})&gt;/g, (m, anim, name, id) =>
        stash(`<img class="d-emoji" src="https://cdn.discordapp.com/emojis/${id}.${anim ? 'gif' : 'png'}" alt=":${name}:" title=":${name}:" draggable="false" onerror="this.replaceWith(document.createTextNode(':${name}:'))">`));
    // Role / user / channel mentions (order: role before user, both use @).
    s = s.replace(/&lt;@&amp;(\d{5,25})&gt;/g, () => stash(`<span class="d-mention">@role</span>`));
    s = s.replace(/&lt;@!?(\d{5,25})&gt;/g, () => stash(`<span class="d-mention">@user</span>`));
    s = s.replace(/&lt;#(\d{5,25})&gt;/g, () => stash(`<span class="d-mention">#channel</span>`));
    s = s.replace(/@(everyone|here)\b/g, (m, w) => stash(`<span class="d-mention">@${w}</span>`));
    // Timestamps <t:unix[:style]>
    s = s.replace(/&lt;t:(\d{1,15})(?::[tTdDfFR])?&gt;/g, (m, unix) => {
        try { return stash(`<span class="d-mention">${new Date(Number.parseInt(unix, 10) * 1000).toLocaleString()}</span>`); }
        catch { return m; }
    });
    // Masked links [text](https://url)
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, text, url) => // nosonar
        stash(`<a class="d-link" href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`));

    // 3) Line-level: headers (### / ## / #), subtext (-#), blockquotes (>).
    s = s.replace(/^###\s+(.+)$/gm, (m, t) => `<span class="d-h d-h3">${t}</span>`); // nosonar
    s = s.replace(/^##\s+(.+)$/gm, (m, t) => `<span class="d-h d-h2">${t}</span>`); // nosonar
    s = s.replace(/^#\s+(.+)$/gm, (m, t) => `<span class="d-h d-h1">${t}</span>`); // nosonar
    s = s.replace(/^-#\s+(.+)$/gm, (m, t) => `<span class="d-subtext">${t}</span>`); // nosonar
    s = s.replace(/^&gt;\s?(.+)$/gm, (m, t) => `<span class="d-quote">${t}</span>`);

    // 4) Inline markdown (order matters).
    s = s.replace(/\*\*\*([^*]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+?)__/g, '<u>$1</u>');
    s = s.replace(/~~([^~]+?)~~/g, '<s>$1</s>');
    s = s.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="d-spoiler" onclick="this.classList.add(\'shown\')">$1</span>');
    s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
    s = s.replace(/(^|[^_])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');

    // 5) Newlines -> <br>.
    s = s.replaceAll('\n', '<br>');

    // 6) Restore stashed tags. 
    s = s.replace(/@@\u00a7(\d+)\u00a7@@/g, (m, i) => store[+i] || '');
    return s;
}

// —— Advanced Discord Message Simulator ——
function buildDiscordPreview(cfg, botInfo) {
    const avatar = botInfo?.avatar || null;
    const username = botInfo?.username || 'xNico';
    
    // Components Builder
    let componentsHtml = '';
    
    // Custom Buttons (Message Builder / Welcomer Action Buttons)
    if (cfg.actionButtons && cfg.actionButtons.length > 0) {
        componentsHtml += `<div class="d-action-row">`;
        cfg.actionButtons.forEach(btnId => {
            const btn = state.customBtns?.[btnId];
            if (!btn) return;
            const styleClass = `d-btn-${btn.style || 'primary'}`;
            componentsHtml += `<button class="d-button ${styleClass}">${btn.emoji ? esc(btn.emoji) + ' ' : ''}${esc(btn.label)}</button>`;
        });
        componentsHtml += `</div>`;
    }
    
    // Legacy/Direct buttons array (Welcomer)
    if (cfg.buttons && cfg.buttons.length > 0) {
        componentsHtml += `<div class="d-action-row">`;
        cfg.buttons.forEach(b => {
            componentsHtml += `<button class="d-button d-btn-link">${b.emoji ? esc(b.emoji) + ' ' : ''}${esc(b.label || 'Link')} ↗</button>`;
        });
        componentsHtml += `</div>`;
    }

    // Action Menus
    if (cfg.actionMenus && cfg.actionMenus.length > 0) {
        cfg.actionMenus.forEach(menuId => {
            const menu = state.customMenus?.[menuId];
            if (!menu) return;
            componentsHtml += `<div class="d-action-row"><div class="d-select"><div class="d-select-value">${esc(menu.placeholder || 'Make a selection...')}</div><div class="d-select-icon">▼</div></div></div>`;
        });
    }

    // Embed Builder
    let embedHtml = '';
    let msgContent = '';
    let embedDesc = cfg.description || '';
    
    // In welcomer, if mode is 'components', content goes to embed description usually.
    // In message-builder, embed mode means content is outside, description is inside.
    const mode = cfg.mode || 'components';
    
    if (mode === 'text') {
        msgContent = cfg.content || 'Welcome to the server!';
    } else if (cfg._isWelcomer) {
        // Welcomer logic: content is the embed description, no external content usually
        embedDesc = cfg.content || 'Welcome @User to **Server**!';
    } else {
        // Message builder logic
        msgContent = cfg.content || '';
        embedDesc = cfg.description || '';
    }

    const hasEmbed = !!cfg.title || !!embedDesc || !!cfg.footer || !!cfg.author || !!cfg.image || (cfg.images && cfg.images.length > 0) || !!cfg.thumbnail || (!!cfg.color && !cfg.colorless) || (cfg.fields && cfg.fields.length > 0);

    if (hasEmbed && mode !== 'text') {
        const color = cfg.colorless ? 'transparent' : (cfg.color || '#bcf1e4');
        
        let fieldsHtml = '';
        if (cfg.fields && cfg.fields.length > 0) {
            fieldsHtml = `<div class="d-embed-fields">`;
            cfg.fields.forEach(f => {
                fieldsHtml += `<div class="d-embed-field ${f.inline ? 'd-embed-field-inline' : ''}">
                    <div class="d-embed-field-name">${renderDiscord(f.name || '\u200B')}</div>
                    <div class="d-embed-field-value">${renderDiscord(f.value || '\u200B')}</div>
                </div>`;
            });
            fieldsHtml += `</div>`;
        }

        let imagesHtml = '';
        if (cfg.image) {
            imagesHtml += `<img class="d-embed-image" src="${esc(cfg.image)}">`;
        } else if (cfg.images && cfg.images.length > 0) {
            cfg.images.forEach(img => {
                imagesHtml += `<img class="d-embed-image" src="${esc(img)}">`;
            });
        }

        embedHtml = `<div class="d-embed-wrapper">
            <div class="d-embed-color" style="background-color: ${esc(color)}"></div>
            <div class="d-embed-inner">
                ${cfg.author ? `<div class="d-embed-author">${renderDiscord(cfg.author)}</div>` : ''}
                ${cfg.title ? `<div class="d-embed-title">${renderDiscord(cfg.title)}</div>` : ''}
                ${embedDesc ? `<div class="d-embed-description">${renderDiscord(embedDesc)}</div>` : ''}
                ${fieldsHtml}
                ${imagesHtml}
                ${cfg.footer ? `<div class="d-embed-footer">${renderDiscord(cfg.footer)}</div>` : ''}
            </div>
            ${cfg.thumbnail ? `<img class="d-embed-thumbnail" src="${esc(cfg.thumbnail)}">` : ''}
        </div>`;
    }

    const today = new Date().toLocaleDateString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });

    return `
    <div class="d-message">
        <div class="d-avatar" style="background-color: #5865F2;">
            ${avatar ? `<img src="${avatar}">` : username.charAt(0)}
        </div>
        <div class="d-message-body">
            <div class="d-msg-header">
                <span class="d-username">${esc(username)}</span>
                <span class="d-bot-tag"><span class="d-bot-check">✓</span> APP</span>
                <span class="d-timestamp">Today at ${today}</span>
            </div>
            ${msgContent ? `<div class="d-message-content">${renderDiscord(msgContent)}</div>` : ''}
            ${embedHtml}
            ${componentsHtml ? `<div class="d-components">${componentsHtml}</div>` : ''}
        </div>
    </div>
    `;
}

const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${window.XNICO_ICONS[name] || window.XNICO_ICONS.grid}</svg>`;
const toast = (msg, type = 'info') => {
    const c = $('#toasts'); if (!c) return;
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, 2800);
};

function getDeep(obj, path) {
    if (!path) return obj;
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setDeep(obj, path, val) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
        o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = val;
}

window.premLock = (html, reason = 'Premium Required') => {
    const isPrem = !!state.premium?.hasPremium;
    if (isPrem) return html;
    return `
        <div class="premium-lock-container is-locked premium-glow" style="margin-bottom:20px;">
            <div style="pointer-events:none">${html}</div>
            <a href="https://discord.gg/Zs35X7Umak" target="_blank" class="premium-lock-overlay">
                ${icon('crown')} ${esc(reason)}
            </a>
        </div>
    `;
};

// â”€â”€â”€â”€â”€ API layer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function api(path, opts = {}) {
    const url = (API_BASE || '') + path;
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }; // nosonar
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    try {
        const r = await fetch(url, { credentials: 'include', cache: 'no-store', ...opts, headers });
        const ct = r.headers.get('content-type') || '';
        const data = ct.includes('application/json') ? await r.json() : { _text: await r.text() };
        if (r.status === 401) return { _unauth: true, error: data?.error || 'Unauthorized' };
        if (!r.ok) return { _error: true, status: r.status, ...data };
        return data;
    } catch (e) {
        console.error('[api]', path, e);
        return { _error: true, error: e.message };
    }
}

// â”€â”€â”€â”€â”€ token capture from redirect â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Friendly, actionable messages for the ?error= codes the server sends
// back from the OAuth flow (see dashboard/server.js callback/redirect).
const AUTH_ERROR_MESSAGES = {
    oauth_not_configured: 'Discord login isn\'t fully set up on the server yet. The CLIENT_ID and DISCORD_CLIENT_SECRET environment variables need to be configured.',
    token_failed: 'Discord rejected the login. This usually means the client secret is wrong, or this exact callback URL isn\'t added under OAuth2 -> Redirects in the Discord Developer Portal.',
    oauth_failed: 'Something went wrong while talking to Discord. Please try again in a moment.',
    no_code: 'Login was interrupted before Discord sent an authorization code. Please try again.',
    access_denied: 'You cancelled the Discord authorization. Click "Login with Discord" to try again.',
};

function showAuthError(code) {
    const box = document.getElementById('auth-error');
    if (!box) return;
    box.textContent = AUTH_ERROR_MESSAGES[code] || ('Login failed: ' + code);
    box.classList.remove('hidden');
}

(function captureToken() {
    const u = new URLSearchParams(location.search);
    if (u.has('token')) {
        const t = u.get('token');
        if (t && t.length > 20) {
            state.token = t;
            localStorage.setItem('token', t);
        }
        history.replaceState({}, '', location.pathname + location.hash);
    }
    if (u.has('error')) {
        const err = u.get('error');
        // Render a persistent, readable banner on the landing page instead
        // of a toast that vanishes before the user can read it.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => showAuthError(err));
        } else {
            showAuthError(err);
        }
        history.replaceState({}, '', location.pathname + location.hash);
    }
    // Stamp the current year in the landing footer.
    const yearEl = () => { const y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', yearEl);
    else yearEl();
})();

// â”€â”€â”€â”€â”€ auth screen helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadAuthStats() {
    // Public bot info
    const bot = await api('/api/bot-info');
    if (bot && !bot._error) {
        state.botInfo = bot;
        if (bot.avatar) {
            $('#bot-logo').innerHTML = `<img src="${esc(bot.avatar)}" alt="Bot">`;
            $('#sb-logo').innerHTML = `<img src="${esc(bot.avatar)}" alt="Bot">`;
        }
    }
    const stats = await api('/api/stats');
    if (stats && !stats._error) {
        $('#stat-guilds').textContent = stats.totalGuilds ?? '—';
        if (stats.totalCommands) $('#stat-cmds').textContent = (stats.totalCommands + '+').replace(/\.\d+/, '');
        if (stats.uptime) $('#stat-uptime').textContent = (stats.uptime).toFixed ? stats.uptime.toFixed(1) + '%' : stats.uptime + '%';
    }
}

// â”€â”€â”€â”€â”€ session bootstrap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Order matters here. The previous version `await`ed loadAuthStats()
// (two sequential network calls) BEFORE deciding whether the visitor
// was logged in. That meant a logged-in user — and, worse, a user who
// had JUST authorized and arrived on `/?token=…` — stared at the full
// landing/login page for the whole round-trip before the dashboard
// appeared. It looked exactly like "login didn't work".
//
// Now we decide the auth state FIRST:
//   • If a token exists, show the connecting loader immediately and
//     verify it. On success we go straight to the dashboard and let
//     the public stats load in the background (non-blocking).
//   • Only when there's no token (or it's invalid) do we render the
//     landing page, and only then do we await the public stats that
//     populate it.
async function bootstrap() {
    if (state.token) {
        // Show the connecting loader right away — no landing flash.
        $('#auth-screen').classList.add('hidden');
        $('#auth-loading').classList.remove('hidden');

        const me = await api('/api/auth/me');
        if (me && !me._unauth && me.user) {
            state.user = me.user;
            // Public bot info / stats aren't needed to render the
            // dashboard — load them in the background so the logo and
            // counters fill in without blocking the transition.
            loadAuthStats().catch(() => { });
            return showDashboard();
        }

        // Token is missing/expired/invalid — clear it and fall through
        // to the landing page.
        state.token = null;
        localStorage.removeItem('token');
    }

    // Not logged in: render the landing page, then populate its public
    // stats. showAuth() first so the page is visible immediately even
    // if the stats call is slow.
    showAuth();
    await loadAuthStats();
}

function showAuth() {
    $('#auth-screen').classList.remove('hidden');
    $('#dashboard').classList.add('hidden');
    $('#auth-loading').classList.add('hidden');
}

async function showDashboard() {
    $('#auth-loading').classList.remove('hidden');
    $('#auth-screen').classList.add('hidden');

    try {
        // Sidebar render
        renderSidebar();
        renderUserBadge();

        // Load user guilds (tolerate failure — the rest of the UI still works)
        const guilds = await api('/api/guilds/me');
        state.guilds = Array.isArray(guilds) ? guilds : [];

        // Apply saved theme 
        const theme = localStorage.getItem('theme');
        if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light'); // nosonar
        updateThemeIcon();

        $('#dashboard').classList.remove('hidden');
        $('#auth-loading').classList.add('hidden');

        // Start router
        window.addEventListener('hashchange', handleRoute);
        if (!location.hash) location.hash = '#/servers';
        else handleRoute();
    } catch (e) {
        // A render error must never leave the user stuck on the spinner.
        // Surface it and drop back to a usable state.
        console.error('[xNico] Dashboard failed to render:', e);
        $('#auth-loading').classList.add('hidden');
        $('#dashboard').classList.remove('hidden');
        toast('Something went wrong loading the dashboard. ' + (e.message || String(e)), 'error');
    }
}

// â”€â”€â”€â”€â”€ sidebar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderSidebar() { // nosonar
    const nav = $('#sb-nav');
    const groups = {};
    // Main group
    groups.Main = [
        { id: '__home', name: 'Servers', route: '#/servers', icon: 'home' },
        { id: '__profile', name: 'Profile', route: '#/profile', icon: 'user' },
        { id: '__commands', name: 'Commands', route: '#/commands', icon: 'code' },
    ];

    // Owner-only entries — only inserted if the JWT actually carries
    // `isOwner: true`. Server-side endpoints reject these requests for
    // anyone else, but hiding the link keeps the UI clean.
    if (state.user?.isOwner) {
        groups.Main.push({ id: '__premium', name: 'Premium Keys', route: '#/premium', icon: 'crown' });
    }

    // Modules grouped — skip premium-only modules entirely for users
    // who don't have premium (and aren't owner). This prevents the
    // "click -> 403 -> bounce" UX. A locked card is still rendered on
    // the server overview so users know the feature exists.
    const viewerHasPremium = !!(state.user?.isOwner || state.user?.hasPremium);
    for (const m of (window.XNICO_MODULES || [])) {
        if (m.premium && !viewerHasPremium) continue;
        if (m.ownerOnly && !state.user?.isOwner) continue;
        (groups[m.group] ||= []).push(m); // nosonar
    }

    let html = '';
    for (const grp of Object.keys(groups)) {
        html += `<div class="sb-section"><span>${esc(grp)}</span></div>`;
        for (const m of groups[grp]) {
            const route = m.route
                ? m.route
                : (state.currentGuild ? `#/server/${state.currentGuild.id}/${m.id}` : `#/servers`); // nosonar
            const badge = m.premium ? '<span class="badge">PRO</span>' : '';
            const disabled = (!m.route && !state.currentGuild) ? 'locked' : '';
            html += `<a class="sb-item ${disabled}" href="${route}" data-route="${esc(route)}" data-page="${esc(m.id)}">${icon(m.icon || 'grid')}<span>${esc(m.name)}</span>${badge}</a>`;
        }
    }
    nav.innerHTML = html;
    markActiveNav();
}

function markActiveNav() {
    const r = location.hash || '#/servers';
    $$('.sb-item').forEach(el => {
        const match = r === el.dataset.route || (el.dataset.page && r.endsWith('/' + el.dataset.page));
        el.classList.toggle('active', !!match);
    });
}

function renderUserBadge() {
    if (!state.user) return;
    const av = $('#sb-user-av');
    if (state.user.avatar) av.innerHTML = `<img src="${esc(state.user.avatar)}" alt="">`;
    else av.innerHTML = `<span>${esc((state.user.username || 'U')[0].toUpperCase())}</span>`;
    $('#sb-user-nm').textContent = state.user.username || 'User';
    $('#sb-user-role').textContent = (state.user.role || 'member').replace(/^./, c => c.toUpperCase());
}

// â”€â”€â”€â”€â”€ guild picker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderGuildPicker() {
    const wrap = $('#guild-picker');
    if (!state.currentGuild) {
        wrap.classList.add('hidden');
        return;
    }
    wrap.classList.remove('hidden');
    const g = state.currentGuild;
    $('#gp-ic').innerHTML = g.icon ? `<img src="${esc(g.icon)}">` : `<span>${esc((g.name || 'S')[0])}</span>`;
    $('#gp-nm').textContent = g.name;

    const drop = $('#guild-drop');
    drop.innerHTML = state.guilds.map(x => `
        <div class="gi" onclick="selectGuild('${esc(x.id)}')">
            <div class="ic">${x.icon ? `<img src="${esc(x.icon)}">` : `<span>${esc((x.name || 'S')[0])}</span>`}</div>
            <div class="nm">${esc(x.name)}</div>
            <div class="st ${x.botPresent ? 'ok' : 'warn'}">${x.botPresent ? 'Manage' : 'Invite'}</div>
        </div>`).join('') || '<div class="gi"><div class="nm text-mute">No servers</div></div>';
}

function toggleGuildDropdown() {
    $('#guild-drop').classList.toggle('hidden');
}
document.addEventListener('click', (e) => {
    if (!e.target.closest('#guild-picker')) $('#guild-drop')?.classList.add('hidden');
    if (!e.target.closest('#sb-user') && !e.target.closest('#sb-menu')) $('#sb-menu')?.classList.add('hidden');
});

function selectGuild(id) {
    const g = state.guilds.find(x => x.id === id);
    if (!g) return;
    state.currentGuild = g;
    // If no module in URL, go to server dashboard
    location.hash = `#/server/${g.id}`;
    $('#guild-drop').classList.add('hidden');
}

// â”€â”€â”€â”€â”€ theme / sidebar / menu â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon();
}
function updateThemeIcon() {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    $('#theme-icon-dark').classList.toggle('hidden', cur === 'light');
    $('#theme-icon-light').classList.toggle('hidden', cur !== 'light');
}
function toggleSidebar(force) {
    const sb = $('#sidebar'), ov = $('#overlay');
    const open = force !== undefined ? force : !sb.classList.contains('open');
    sb.classList.toggle('open', open);
    ov.classList.toggle('hidden', !open);
}
function toggleUserMenu() { $('#sb-menu').classList.toggle('hidden'); }
function closeUserMenu() { $('#sb-menu').classList.add('hidden'); }

function logout() {
    api('/api/auth/logout', { method: 'POST' }).catch(() => { });
    state.token = null; state.user = null; state.currentGuild = null;
    localStorage.removeItem('token');
    location.hash = '';
    showAuth();
}

// expose globals used inline
window.toggleGuildDropdown = toggleGuildDropdown;
window.selectGuild = selectGuild;
window.toggleTheme = toggleTheme;
window.toggleSidebar = toggleSidebar;
window.toggleUserMenu = toggleUserMenu;
window.closeUserMenu = closeUserMenu;
window.logout = logout;

// Expose api / icon / toast / state for extras.js and other module files.
// Without this, extras.js falls back to its own fetch wrapper but loses
// the centralized 401-handling, draft tracking, and toast styling.
window.api = api;
window.icon = icon;
window.toast = toast;
window.esc = esc;
window.renderDiscord = renderDiscord;

// â”€â”€ Panel deployment helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Enqueues a panel deployment action on the bot (verification/tickets/music)
// and polls for the result. The bot posts the real panel into Discord; this
// just triggers it and surfaces success/failure. Returns true/false/null.
async function deployPanel(guildId, panel, channelId, opts = {}) {
    const body = Object.assign({ channelId: channelId || null }, opts); // nosonar
    const r = await api(`/api/guild/${guildId}/panel/${panel}/deploy`, {
        method: 'POST', body: JSON.stringify(body)
    });
    if (!r || r._error || r._unauth || !r.actionId) {
        toast(r?.error || 'Could not queue the deployment', 'error');
        return false;
    }
    toast('Deploying… the bot is posting the panel now.', 'info');
    const actionId = r.actionId;
    // Poll ~30s (bot picks it up within ~5-8s via the PG poll).
    for (let i = 0; i < 20; i++) {
        await new Promise(res => setTimeout(res, 1500));
        const s = await api(`/api/guild/${guildId}/panel/action/${actionId}`);
        if (!s || s._error) continue;
        if (s.status === 'done') {
            toast('Panel posted to Discord! âœ…', 'success');
            return true;
        }
        if (s.status === 'error') {
            toast('Deploy failed: ' + (s.error || 'unknown error'), 'error');
            return false;
        }
    }
    toast('Still deploying — check the channel in a moment.', 'info');
    return null;
}
window.deployPanel = deployPanel;

// â”€â”€ Emoji picker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// A Discord-style emoji picker that auto-attaches to message fields (all
// textareas + inputs marked data-emoji) across the dashboard. Lets admins
// insert their server's CUSTOM emojis (as <:name:id> / <a:name:id>) and common
// standard emojis at the cursor. Guild emojis are fetched once per guild.
const STD_EMOJIS = ('😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😋 😛 🤪 😝 🤗 '
    + '🤔 🤨 😐 😑 😶 🙄 😏 😴 😎 🥳 😤 😢 😭 😠 😡 🤬 😱 😨 😰 🥺 👀 👍 👎 👏 🙌 🙏 💪 '
    + '🔥 ✨ 🎉 🎊 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💯 ✅ ❌ ⭐ 🌟 💫 ⚡ 💥 💦 🎵 🎶 🚀 🏆 🎁 📢 🔔 '
    + '💎 👑 🎯 ✔️ ➡️ ⬅️ ⬆️ ⬇️ ❓ ❗ 💬 📌 📎 🔗 🔒 🔓 🎮 🕹️ 🍀 🌈 ☀️ 🌙 💤 🎂 🍕 ☕').split(/\s+/).filter(Boolean);

let _emojiPanel = null;
let _emojiTarget = null;

function ensureEmojiPanel() {
    if (_emojiPanel) return _emojiPanel;
    const p = document.createElement('div');
    p.className = 'emoji-pop';
    p.style.display = 'none';
    p.innerHTML = `
        <input type="text" class="emoji-search" placeholder="Search emoji…">
        <div class="emoji-scroll">
            <div class="emoji-sec-t">Server Emojis</div>
            <div class="emoji-grid" id="emoji-custom"></div>
            <div class="emoji-sec-t">Standard</div>
            <div class="emoji-grid" id="emoji-standard"></div>
        </div>`;
    document.body.appendChild(p);
    p.querySelector('#emoji-standard').innerHTML = STD_EMOJIS
        .map(e => `<button type="button" class="emoji-item" data-insert="${esc(e)}" data-name="${esc(e)}" title="${esc(e)}">${e}</button>`).join('');
    const search = p.querySelector('.emoji-search');
    search.addEventListener('input', () => filterEmojiPanel(search.value.trim().toLowerCase()));
    p.addEventListener('mousedown', (ev) => {
        // mousedown (not click) so the target field doesn't lose selection first
        const btn = ev.target.closest('.emoji-item');
        if (!btn) return;
        ev.preventDefault();
        if (btn.dataset.insert && _emojiTarget) insertAtCursor(_emojiTarget, btn.dataset.insert);
    });
    document.addEventListener('click', (ev) => {
        if (_emojiPanel && _emojiPanel.style.display !== 'none'
            && !_emojiPanel.contains(ev.target) && !ev.target.closest('.emoji-btn')) {
            hideEmojiPanel();
        }
    });
    _emojiPanel = p;
    return p;
}

function renderCustomEmojis() {
    const grid = _emojiPanel && _emojiPanel.querySelector('#emoji-custom'); // nosonar
    if (!grid) return;
    const list = state.guildEmojis || [];
    if (!list.length) {
        grid.innerHTML = '<div class="emoji-empty">No custom emojis in this server.</div>';
        return;
    }
    grid.innerHTML = list.map(e => {
        const code = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
        const url = `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'png'}?size=44`;
        return `<button type="button" class="emoji-item" data-insert="${esc(code)}" data-name="${esc(e.name)}" title=":${esc(e.name)}:"><img src="${url}" loading="lazy" alt=":${esc(e.name)}:"></button>`;
    }).join('');
}

function filterEmojiPanel(q) {
    if (!_emojiPanel) return;
    _emojiPanel.querySelectorAll('.emoji-item').forEach(btn => {
        const name = (btn.dataset.name || '').toLowerCase();
        btn.style.display = (!q || name.includes(q)) ? '' : 'none';
    });
}

function insertAtCursor(el, text) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    const pos = start + text.length;
    try { el.selectionStart = el.selectionEnd = pos; } catch { }
    el.focus();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}

function showEmojiPanel(anchorBtn, target) {
    ensureEmojiPanel();
    _emojiTarget = target;
    renderCustomEmojis();
    const p = _emojiPanel;
    p.style.display = 'block';
    const r = anchorBtn.getBoundingClientRect();
    const pw = 300;
    let left = r.left + window.scrollX;
    if (left + pw > window.innerWidth + window.scrollX) left = window.innerWidth + window.scrollX - pw - 10;
    p.style.top = (r.bottom + window.scrollY + 4) + 'px';
    p.style.left = Math.max(8, left) + 'px';
    const s = p.querySelector('.emoji-search');
    if (s) { s.value = ''; filterEmojiPanel(''); setTimeout(() => s.focus(), 0); }
}

function hideEmojiPanel() {
    if (_emojiPanel) _emojiPanel.style.display = 'none';
    _emojiTarget = null;
}

function attachEmojiButton(el) {
    if (!el || el.__emojiBtn) return;
    el.__emojiBtn = true;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emoji-btn';
    btn.title = 'Insert emoji';
    btn.textContent = '😊';
    btn.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (_emojiPanel && _emojiPanel.style.display !== 'none' && _emojiTarget === el) { hideEmojiPanel(); return; }
        showEmojiPanel(btn, el);
    });
    el.insertAdjacentElement('afterend', btn); // nosonar
    el.classList.add('has-emoji-btn');
}

function enhanceEmojiInputs(root) {
    const scope = root || document.getElementById('page');
    if (!scope) return;
    scope.querySelectorAll('textarea:not(.no-emoji), input[data-emoji]').forEach(attachEmojiButton);
}
window.enhanceEmojiInputs = enhanceEmojiInputs;

function initEmojiObserver() {
    const page = document.getElementById('page');
    if (!page || page.__emojiObserver) return;
    page.__emojiObserver = true;
    const mo = new MutationObserver(() => {
        clearTimeout(page.__emojiT);
        page.__emojiT = setTimeout(() => enhanceEmojiInputs(page), 80);
    });
    mo.observe(page, { childList: true, subtree: true });
    enhanceEmojiInputs(page);
}
window.initEmojiObserver = initEmojiObserver;
window.state = state;
window.handleRoute = handleRoute;

// â”€â”€â”€â”€â”€ Router â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/* Routes:
   #/servers                                   â€“ server list
   #/profile                                   â€“ user profile
   #/commands                                  â€“ bot command list
   #/premium                                   â€“ premium keys
   #/server/:id                                â€“ server dashboard
   #/server/:id/setup                          â€“ invite bot prompt
   #/server/:id/analytics                      â€“ analytics
   #/server/:id/:module                        â€“ module config page
*/
async function handleRoute() { // nosonar
    const hash = location.hash || '#/servers';
    const parts = hash.replace(/^#\/?/, '').split('/');
    // Close mobile sidebar on nav
    if (window.innerWidth <= 1024) toggleSidebar(false);

    const page = $('#page');
    page.innerHTML = `<div style="display:flex;justify-content:center;padding:4rem 0"><div class="spinner"></div></div>`;
    markActiveNav();
    window.__renderModule = null;
    try { initEmojiObserver(); } catch { }

    try {
        if (parts[0] === '' || parts[0] === 'servers') {
            state.currentGuild = null;
            renderGuildPicker();
            setCrumb('Servers');
            await pageServers();
        } else if (parts[0] === 'profile') {
            setCrumb('Profile');
            await pageProfile();
        } else if (parts[0] === 'commands') {
            setCrumb('Commands');
            await pageCommands();
        } else if (parts[0] === 'premium') {
            // Owner-only — anyone else gets a friendly redirect to
            // /servers. Server-side endpoints also reject non-owners.
            if (!state.user?.isOwner) {
                toast('Owner only', 'error');
                location.hash = '#/servers';
                return;
            }
            setCrumb('Premium Keys');
            await pagePremium();
        } else if (parts[0] === 'server' && parts[1]) {
            const gid = parts[1];
            await ensureGuild(gid);
            if (!state.currentGuild) return pageNotFound('Server not found.');
            renderGuildPicker();
            renderSidebar();

            if (!state.currentGuild.botPresent) {
                setCrumb(state.currentGuild.name, 'Setup');
                return pageSetup();
            }

            const module = parts[2];
            if (!module) { setCrumb(state.currentGuild.name, 'Overview'); return pageServerOverview(); }
            if (module === 'analytics') { setCrumb(state.currentGuild.name, 'Analytics'); return pageAnalytics(); }
            const mod = (window.XNICO_MODULES || []).find(m => m.id === module);
            if (!mod) return pageNotFound('Unknown module.');
            setCrumb(state.currentGuild.name, mod.name);
            if (mod.custom && mod.id === 'welcomer') return pageWelcomer();
            if (mod.custom && mod.id === 'leveling') return pageLeveling();
            if (mod.custom && mod.id === 'economy') return pageEconomy();
            if (mod.custom && mod.id === 'tickets') return pageTickets();
            if (mod.custom && mod.id === 'autorole') return pageAutorole();
            if (mod.custom && mod.id === 'suggestions') return pageSuggestions();
            if (mod.custom && mod.id === 'feedback') return pageFeedback();
            if (mod.custom && mod.id === 'automod') return pageAutomod();
            if (mod.custom && mod.id === 'antinuke') return pageAntinuke();
            if (mod.custom && mod.id === 'trust') return pageTrust();
            if (mod.custom && mod.id === 'starboard') return pageStarboard();
            if (mod.custom && mod.id === 'counting') return pageCounting();
            if (mod.custom && mod.id === 'autoreact') return pageAutoreact();
            if (mod.custom && mod.id === 'giveaway') return pageGiveaway();
            if (mod.custom && mod.id === 'voice') return pageVoice();
            if (mod.custom && mod.id === 'reactionroles') return pageReactionRoles();
            if (mod.custom && mod.id === 'media-only') return pageMediaOnly();
            if (mod.custom && mod.id === 'afk') return pageAfk();
            if (mod.custom && mod.id === 'sticky') return pageSticky();
            if (mod.custom && mod.id === 'invites') return pageInvites();
            if (mod.custom && mod.id === 'serverstats') return pageServerStats();
            if (mod.custom && mod.id === 'backups') return pageBackups();
            if (mod.custom && mod.id === 'bot-customize') return pageBotCustomize();
            if (mod.custom && mod.id === 'message-builder') return pageMessageBuilder();
            if (mod.custom && mod.id === 'button-commands') return pageButtonCreator();
            if (mod.custom && mod.id === 'select-menus') return pageMenuCreator();
            // Newer modules — dedicated render functions live in extras.js
            if (mod.custom && mod.id === 'aichat') return pageAiChat();
            if (mod.custom && mod.id === 'birthdays') return pageBirthdays();
            if (mod.custom && mod.id === 'applications') return pageApplications();
            if (mod.custom && mod.id === 'warn-config') return pageWarnConfig();
            if (mod.custom && mod.id === 'warnings') return pageWarningsLog();
            if (mod.custom && mod.id === 'statusrole') return pageStatusRole();
            if (mod.custom && mod.id === 'botblock') return pageBotBlock();
            if (mod.custom && mod.id === 'vanityguard') return pageVanityGuard();
            if (mod.custom && mod.id === 'confessions') return pageConfessions();
            if (mod.custom && mod.id === 'ignored-channels') return pageIgnoredChannels();
            if (mod.custom && mod.id === 'modlogs') return pageModLogs();
            // Parity additions — dedicated pages in webhook-botignore.js
            if (mod.custom && mod.id === 'webhook') return pageWebhook();
            if (mod.custom && mod.id === 'botignore') return pageBotIgnore();
            return pageModule(mod);
        } else {
            pageNotFound();
        }
    } catch (err) {
        console.error('[router]', err);
        page.innerHTML = `<div class="empty"><h2>Error</h2><p>${esc(err.message || 'Something broke.')}</p></div>`;
    }
}

function setCrumb(primary, secondary) {
    const el = $('#crumb-now');
    el.textContent = secondary ? `${primary} → ${secondary}` : primary;
}

async function ensureGuild(gid) {
    if (!state.guilds.length) {
        const g = await api('/api/guilds/me');
        if (Array.isArray(g)) state.guilds = g;
    }
    state.currentGuild = state.guilds.find(g => g.id === gid) || null;

    // Load this guild's custom emojis once for the emoji picker (best-effort).
    if (gid && state.guildEmojisGuildId !== gid) {
        state.guildEmojisGuildId = gid;
        state.guildEmojis = [];
        api(`/api/guild/${gid}/emojis`).then(e => { if (Array.isArray(e)) state.guildEmojis = e; }).catch(() => { });
    }
}

// â”€â”€â”€â”€â”€ Page: server list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function pageServers() {
    const page = $('#page');
    const guilds = state.guilds;

    if (!guilds.length) {
        page.innerHTML = `
            <div class="page-h">
                <div><h1>Select a Server</h1><p>No servers found where you have Manage Server permission.</p></div>
            </div>
            <div class="empty">
                ${icon('server')}
                <p>You don't manage any servers yet. Invite xNico to a server you own and return here.</p>
                <a class="btn primary mt-2" href="${inviteUrl()}" target="_blank">Invite xNico</a>
            </div>`;
        return;
    }

    const withBot = guilds.filter(g => g.botPresent);
    const withoutBot = guilds.filter(g => !g.botPresent);

    page.innerHTML = `
        <div class="page-h">
            <div>
                <h1>Your Servers</h1>
                <p>Pick a server to manage. Servers you manage with xNico appear first.</p>
            </div>
            <div class="flex gap-2">
                <button class="btn" id="server-list-refresh-btn" title="Re-check which servers xNico is in">${icon('refresh')} Refresh</button>
                <a class="btn primary" href="${inviteUrl()}" target="_blank">${icon('user-plus')} Add to Server</a>
            </div>
        </div>

        ${withBot.length ? `<h3 class="mb-2">Managed</h3>
        <div class="servers-grid mb-3">
            ${withBot.map(g => serverCard(g)).join('')}
        </div>` : ''}

        ${withoutBot.length ? `<h3 class="mb-2">Not Invited Yet</h3>
        <div class="servers-grid">
            ${withoutBot.map(g => serverCard(g)).join('')}
        </div>` : ''}
    `;

    // Manual refresh button — bypasses both the user's saved-guild cache
    // and the bot-guild-ids cache so a freshly-invited bot flips to
    // "Managed" immediately. Without this users had to either wait out
    // the TTL or hard-reload the page.
    const refreshBtn = document.getElementById('server-list-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            const original = refreshBtn.innerHTML;
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = `${icon('refresh')} Checking…`;
            try {
                await api('/api/guilds/refresh', { method: 'POST' }).catch(() => { });
                const fresh = await api('/api/guilds/me?refresh=1');
                if (Array.isArray(fresh)) {
                    state.guilds = fresh;
                    pageServers();
                    return;
                }
            } catch { }
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = original;
        });
    }
}

function serverCard(g) {
    const cls = g.botPresent ? '' : 'notin';
    const status = g.botPresent ? 'Click to manage' : 'Invite required';
    return `
        <div class="server-card ${cls}" onclick="location.hash='#/server/${esc(g.id)}'">
            <div class="ic">${g.icon ? `<img src="${esc(g.icon)}">` : `<span>${esc((g.name || 'S')[0])}</span>`}</div>
            <div class="nm">${esc(g.name)}</div>
            <div class="st">${status}</div>
        </div>`;
}

function inviteUrl(gid) {
    const cid = state.botInfo?.id || '';
    if (!cid) return '#';
    return `https://discord.com/oauth2/authorize?client_id=${cid}&permissions=8&scope=bot%20applications.commands${gid ? `&guild_id=${gid}` : ''}`; // nosonar
}

// â”€â”€â”€â”€â”€ Page: server setup (bot not present) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function pageSetup() {
    const g = state.currentGuild;
    $('#page').innerHTML = `
        <div class="page-h">
            <div><h1>${esc(g.name)}</h1><p>xNico isn't in this server yet.</p></div>
        </div>
        <div class="empty">
            <div class="server-card" style="margin:0 auto 1.5rem;max-width:220px;pointer-events:none">
                <div class="ic">${g.icon ? `<img src="${esc(g.icon)}">` : `<span>${esc((g.name || 'S')[0])}</span>`}</div>
                <div class="nm">${esc(g.name)}</div>
                <div class="st" style="color:var(--warning)">Not invited</div>
            </div>
            <p>Invite xNico to start configuring modules.</p>
            <a class="btn primary mt-2" href="${inviteUrl(g.id)}" target="_blank" id="setup-invite-btn">${icon('user-plus')} Invite xNico</a>
            <button class="btn mt-2" id="setup-recheck-btn" style="margin-left:.5rem">${icon('refresh')} Already invited? Recheck</button>
            <p class="text-xs mt-2" id="setup-status">The dashboard will reload automatically after inviting.</p>
        </div>
    `;

    let cancelled = false;
    let attempts = 0;

    async function recheck(force = false) {
        try {
            if (force) {
                await api('/api/guilds/refresh', { method: 'POST' }).catch(() => { });
            }
            const fresh = await api('/api/guilds/me' + (force ? '?refresh=1' : ''));
            if (Array.isArray(fresh)) {
                state.guilds = fresh;
                const updated = fresh.find(x => x.id === g.id);
                if (updated?.botPresent) {
                    location.reload();
                    return true;
                }
            }
        } catch { }
        return false;
    }

    // Manual recheck button — forces an immediate cache-bypass refresh.
    const btn = document.getElementById('setup-recheck-btn');
    if (btn) {
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            const status = document.getElementById('setup-status');
            if (status) status.textContent = 'Checking…';
            const found = await recheck(true);
            if (!found) {
                if (status) status.textContent = 'xNico is still not in this server. Make sure the invite was completed and try again in a few seconds.';
                btn.disabled = false;
            }
        });
    }

    // Auto-poll: tight schedule for the first ~30 seconds (the typical
    // window where a user has just clicked "Invite", finished the
    // OAuth flow, and is staring at the dashboard waiting for it to
    // catch up). Every poll forces a cache-bypass refresh so we beat
    // both our local cache and any stale Discord API edge.
    function poll() {
        if (cancelled) return;
        attempts++;
        // Always force-refresh during the first 10 attempts (~30s).
        // After that the user has likely walked away — back off.
        const force = attempts < 10 ? true : (attempts % 3 === 0);
        const delay = attempts < 6 ? 3000 : (attempts < 15 ? 5000 : 15000); // nosonar
        setTimeout(async () => {
            const found = await recheck(force);
            if (!found) poll();
        }, delay);
    }
    poll();

    // Stop polling if the user navigates away.
    window.addEventListener('hashchange', function stop() {
        cancelled = true;
        window.removeEventListener('hashchange', stop);
    }, { once: true });
}

// â”€â”€â”€â”€â”€ Page: server overview (module grid) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function pageServerOverview() {
    const g = state.currentGuild;
    // Fetch each module's enabled state (best-effort)
    const mods = window.XNICO_MODULES || [];
    const statuses = {};
    await Promise.all(mods.map(async (m) => {
        const cfg = await api(`/api/guild/${g.id}/${m.id}`);
        statuses[m.id] = !!(cfg && cfg.enabled); // nosonar
    }));
    state.moduleStatus[g.id] = statuses;

    // Analytics snapshot
    const a = await api(`/api/guild/${g.id}/analytics`) || {};

    const premium = await api(`/api/guild/${g.id}/premium-status`);
    state.premium = premium;

    $('#page').innerHTML = `
        <div class="page-h">
            <div>
                <h1>${esc(g.name)}</h1>
                <p>Overview of all modules active on this server.</p>
            </div>
            <div class="row wrap">
                <a class="btn" href="#/server/${esc(g.id)}/analytics">${icon('chart')} Analytics</a>
                ${premium?.hasPremium ? `<span class="tag">${icon('crown')} Premium</span>` : ''}
            </div>
        </div>

        <div class="grid g-4 mb-3">
            <div class="stat purple"><div class="ic">${icon('code')}</div><div><div class="v">${(a.commandsUsed ?? 0).toLocaleString()}</div><div class="l">Commands</div></div></div>
            <div class="stat cyan"><div class="ic">${icon('chat')}</div><div><div class="v">${(a.messagesLogged ?? 0).toLocaleString()}</div><div class="l">Messages Logged</div></div></div>
            <div class="stat amber"><div class="ic">${icon('shield')}</div><div><div class="v">${(a.activeWarnings ?? 0).toLocaleString()}</div><div class="l">Warnings</div></div></div>
            <div class="stat green"><div class="ic">${icon('coin')}</div><div><div class="v">${(a.economyFlow ?? 0).toLocaleString()}</div><div class="l">Economy Flow</div></div></div>
        </div>

        <h3 class="mb-2">Modules</h3>
        <div class="grid g-3">
            ${mods.map(m => renderModCard(m, statuses[m.id])).join('')}
        </div>
    `;
}

function renderModCard(m, enabled) {
    const g = state.currentGuild;
    const locked = m.premium && !state.premium?.hasPremium;

    let sub = 'Click to configure';
    if (locked) sub = 'Premium required';
    else if (enabled) sub = 'Enabled';

    let statusHtml = '<span class="pro">PRO</span>';
    if (!m.premium) {
        statusHtml = `<span class="status ${enabled ? 'on' : ''}"></span>`;
    }

    return `
        <div class="mod" onclick="location.hash='#/server/${esc(g.id)}/${esc(m.id)}'">
            ${statusHtml}
            <div class="ic">${icon(m.icon || 'grid')}</div>
            <div class="t">${esc(m.name)}</div>
            <div class="d">${esc(m.description)}</div>
            <div class="mt-2 text-xs text-mute">${sub}</div>
        </div>`;
}

// â”€â”€â”€â”€â”€ Page: analytics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function pageAnalytics() {
    const g = state.currentGuild;
    const a = await api(`/api/guild/${g.id}/analytics`) || {};
    const feed = Array.isArray(a.recentActivity) ? a.recentActivity : [];

    $('#page').innerHTML = `
        <div class="page-h">
            <div><h1>Analytics</h1><p>Recent bot activity on ${esc(g.name)}.</p></div>
        </div>
        <div class="grid g-4 mb-3">
            <div class="stat purple"><div class="ic">${icon('code')}</div><div><div class="v">${(a.commandsUsed ?? 0).toLocaleString()}</div><div class="l">Commands Used</div></div></div>
            <div class="stat cyan"><div class="ic">${icon('chat')}</div><div><div class="v">${(a.messagesLogged ?? 0).toLocaleString()}</div><div class="l">Messages</div></div></div>
            <div class="stat amber"><div class="ic">${icon('shield')}</div><div><div class="v">${(a.activeWarnings ?? 0).toLocaleString()}</div><div class="l">Warnings</div></div></div>
            <div class="stat green"><div class="ic">${icon('coin')}</div><div><div class="v">${(a.economyFlow ?? 0).toLocaleString()}</div><div class="l">Economy</div></div></div>
        </div>
        <div class="card">
            <div class="card-h"><div class="ic">${icon('log')}</div><div class="tt"><div class="t">Recent Activity</div><div class="s">Latest module actions on this server</div></div></div>
            ${feed.length ? `
                <table class="tbl">
                    <thead><tr><th>Time</th><th>Module</th><th>Action</th><th>User</th></tr></thead>
                    <tbody>${feed.map(r => `<tr><td>${esc(r.time)}</td><td><span class="tag">${esc(r.module)}</span></td><td>${esc(r.action)}</td><td class="mono">${esc(r.user)}</td></tr>`).join('')}</tbody>
                </table>
            ` : `<div class="empty">No recent activity.</div>`}
        </div>
    `;
}

// â”€â”€â”€â”€â”€ Page: Welcomer — loaded from welcomer.js â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â”€â”€â”€â”€â”€ Page: Welcomer — loaded from welcomer.js â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// pageWelcomer() is defined in /welcomer.js

// â”€â”€â”€â”€â”€ Page: module config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function pageModule(mod) {
    const g = state.currentGuild;

    // Owner gate
    if (mod.ownerOnly && !state.user?.isOwner) {
        $('#page').innerHTML = `
            <div class="page-h">
                <div><h1>${esc(mod.name)} <span class="tag amber">Owner Only</span></h1><p>${esc(mod.description)}</p></div>
            </div>
            <div class="empty">
                <h3>Access Denied</h3>
                <p>This module is restricted to the bot owner.</p>
                <a class="btn primary mt-2" href="#/server/${esc(g.id)}">Go Back</a>
            </div>`;
        return;
    }

    // Premium gate (check status but don't hard block, use visual locks instead)
    if (mod.premium || true) { // Always fetch premium status just in case fields need it
        const premium = await api(`/api/guild/${g.id}/premium-status`);
        state.premium = premium;
    }

    // Fetch config, channels, roles in parallel
    const [cfg, channels, roles] = await Promise.all([
        api(`/api/guild/${g.id}/${mod.id}`),
        api(`/api/guild/${g.id}/channels`),
        api(`/api/guild/${g.id}/roles`),
    ]);
    if (cfg?._error || cfg?._unauth) {
        $('#page').innerHTML = `<div class="empty"><h3>Failed to load</h3><p>${esc(cfg?.error || 'Unknown error')}</p></div>`;
        return;
    }
    state.channels = Array.isArray(channels) ? channels : [];
    state.roles = Array.isArray(roles) ? roles.filter(r => r.name !== '@everyone') : [];

    const config = cfg || {};
    // mutable working copy so inputs update live
    const draftKey = `draft:${mod.id}:${g.id}`;
    let working = JSON.parse(JSON.stringify(config)); // nosonar
    let hasDraft = false;
    try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
            const draft = JSON.parse(raw);
            if (JSON.stringify(draft) !== JSON.stringify(config)) {
                working = draft;
                hasDraft = true;
            } else {
                localStorage.removeItem(draftKey);
            }
        }
    } catch { localStorage.removeItem(draftKey); }

    function render() {
        const header = `
            <div class="page-h">
                <div>
                    <h1>${esc(mod.name)} ${mod.premium ? '<span class="tag amber">Premium</span>' : ''}</h1>
                    <p>${esc(mod.description)}</p>
                </div>
                <div class="row wrap">
                    <a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a>
                </div>
            </div>
            ${hasDraft ? `<div id="gen-draft-indicator" class="row mb-2"><span class="tag amber">⚠ Unsaved draft</span><span class="text-sm text-mute">Auto-saved locally — won't be lost on refresh.</span></div>` : '<div id="gen-draft-indicator" class="row mb-2" style="display:none"><span class="tag amber">⚠ Unsaved draft</span><span class="text-sm text-mute">Auto-saved locally — won\'t be lost on refresh.</span></div>'}`; // nosonar

        const body = renderFieldGroups(mod.fields, working);

        const deployCard = mod.deploy ? renderDeployCard(mod, working) : '';

        const footer = `
            <div class="save-bar">
                <div class="row">
                    <span class="tag ${working.enabled ? 'green' : 'grey'}" id="mod-status-tag">${working.enabled ? 'Active' : 'Inactive'}</span>
                    <span class="text-sm text-mute">Changes apply instantly after save.</span>
                </div>
                <div class="row">
                    <button class="btn" id="reset-btn">${icon('log')} Reset</button>
                    <button class="btn primary" id="save-btn">${icon('check')} Save Changes</button>
                </div>
            </div>`;

        $('#page').innerHTML = header + body + deployCard + footer;

        // Bind inputs
        bindFormInputs(working);

        // Autosave draft on any change
        $('#page').addEventListener('input', () => {
            try {
                if (JSON.stringify(working) === JSON.stringify(config)) {
                    localStorage.removeItem(draftKey);
                    const ind = document.getElementById('gen-draft-indicator');
                    if (ind) ind.style.display = 'none';
                } else {
                    localStorage.setItem(draftKey, JSON.stringify(working));
                    const ind = document.getElementById('gen-draft-indicator');
                    if (ind) ind.style.display = '';
                }
            } catch { }
        });

        $('#reset-btn').onclick = () => {
            if (confirm('Discard your draft and reload saved config?')) {
                try { localStorage.removeItem(draftKey); } catch { }
                handleRoute();
            }
        };
        $('#save-btn').onclick = async () => {
            const btn = $('#save-btn');
            btn.disabled = true; btn.textContent = 'Saving…';
            const r = await api(`/api/guild/${g.id}/${mod.id}`, {
                method: 'PUT',
                body: JSON.stringify(working)
            });
            btn.disabled = false;
            btn.innerHTML = icon('check') + ' Save Changes';
            if (!r || r._error || r._unauth) {
                toast(r?.error || 'Save failed', 'error');
            } else {
                toast(mod.name + ' saved', 'success');
                try { localStorage.removeItem(draftKey); } catch { }
                const ind = document.getElementById('gen-draft-indicator');
                if (ind) ind.style.display = 'none';
                $('#mod-status-tag').className = 'tag ' + (working.enabled ? 'green' : 'grey');
                $('#mod-status-tag').textContent = working.enabled ? 'Active' : 'Inactive';
            }
        };

        // Deploy Panel button (verification / music / etc.)
        if (mod.deploy) {
            const dbtn = document.getElementById('deploy-panel-btn');
            if (dbtn) dbtn.onclick = async () => {
                const sel = document.getElementById('deploy-channel-sel');
                const chId = sel ? sel.value : (working[mod.deploy.channelKey || 'channelId'] || null);
                if (mod.deploy.needsChannel && !chId) { toast('Pick a channel first', 'error'); return; }
                const orig = dbtn.innerHTML;
                dbtn.disabled = true; dbtn.innerHTML = icon('refresh') + ' Deploying…';
                // Save the latest settings first so the bot builds the panel from them.
                await api(`/api/guild/${g.id}/${mod.id}`, { method: 'PUT', body: JSON.stringify(working) }).catch(() => { });
                try { localStorage.removeItem(draftKey); } catch { }
                await deployPanel(g.id, mod.deploy.panel, chId, mod.deploy.panel === 'music' ? { channelId: chId || null } : {});
                dbtn.disabled = false; dbtn.innerHTML = orig;
            };
        }
    }
    window.__renderModule = render;
    render();
}

// Deploy card for schema-driven modules whose config drives a live Discord
// panel (verification, music, …). Lets the admin post/refresh the panel from
// the dashboard via the bot action queue. `mod.deploy`:
//   { panel, label?, needsChannel?, optionalChannel?, channelKey? }
function renderDeployCard(mod, working) {
    const d = mod.deploy;
    const showChannel = d.needsChannel || d.optionalChannel;
    const selectedCh = working[d.channelKey || 'channelId'] || '';
    // type 0 = text, 5 = announcement
    const chans = (state.channels || []).filter(c => c.type === 0 || c.type === 5 || c.type === undefined);
    const chOptions = ['<option value="">— Select a channel —</option>']
        .concat(chans.map(c => `<option value="${esc(c.id)}" ${c.id === selectedCh ? 'selected' : ''}>#${esc(c.name)}</option>`))
        .join('');
    const note = d.panel === 'music'
        ? 'Leave the channel empty to auto-create a dedicated <code>nico-controller</code> channel.'
        : 'The bot posts the interactive panel into this channel right away.';

    let channelHtml = '';
    if (showChannel) {
        const optLabel = d.optionalChannel ? ' (optional)' : '';
        channelHtml = `<div class="form-row"><label>Panel Channel${optLabel}</label><select id="deploy-channel-sel">${chOptions}</select></div>`;
    }

    return `
        <div class="card mt-2">
            <div class="card-h">
                <div class="ic">${icon('chat')}</div>
                <div class="tt"><div class="t">Deploy ${esc(d.label || mod.name)} Panel</div><div class="s">${note}</div></div>
            </div>
            ${channelHtml}
            <div class="row"><button class="btn primary" id="deploy-panel-btn">${icon('check')} Send Panel to Discord</button></div>
        </div>`;
}

function renderFieldGroups(fields, working) {
    let html = '<div class="card">';
    let inSection = false;
    for (const f of fields) {
        if (f.section) {
            if (inSection) html += '</div>';
            html += `<hr><h3 class="mb-2">${esc(f.section)}</h3><div>`;
            inSection = true;
            continue;
        }
        html += renderField(f, working);
    }
    if (inSection) html += '</div>';
    html += '</div>';
    return html;
}

function renderField(f, working) {
    const val = getDeep(working, f.key);
    const desc = f.desc ? `<div class="hint">${esc(f.desc)}</div>` : '';
    let fieldHtml = '';
    switch (f.type) {
        case 'toggle':
            fieldHtml = `
                <div class="switch-row">
                    <div><div class="lbl">${esc(f.label)}</div>${f.desc ? `<div class="desc">${esc(f.desc)}</div>` : ''}</div>
                    <label class="switch"><input type="checkbox" data-key="${esc(f.key)}" ${val ? 'checked' : ''}><span class="slide"></span></label>
                </div>`;
            break;
        case 'text':
        case 'url':
        case 'email':
            fieldHtml = `<div class="form-row"><label>${esc(f.label)}</label><input type="${f.type === 'url' ? 'url' : 'text'}" data-key="${esc(f.key)}" value="${esc(val || '')}" placeholder="${esc(f.placeholder || '')}">${desc}</div>`;
            break;
        case 'number':
            fieldHtml = `<div class="form-row"><label>${esc(f.label)}</label><input type="number" data-key="${esc(f.key)}" value="${esc(val ?? 0)}" min="${f.min ?? ''}" max="${f.max ?? ''}">${desc}</div>`;
            break;
        case 'textarea':
            fieldHtml = `<div class="form-row"><label>${esc(f.label)}</label><textarea data-key="${esc(f.key)}">${esc(val || '')}</textarea>${desc}</div>`;
            break;
        case 'color':
            fieldHtml = `<div class="form-row"><label>${esc(f.label)}</label><div class="row"><input type="color" data-key="${esc(f.key)}" value="${esc(normalizeColor(val))}"><input type="text" data-key="${esc(f.key)}" value="${esc(val || '')}" placeholder="#6366f1" style="flex:1"></div>${desc}</div>`;
            break;
        case 'select': {
            const opts = (f.options || []).map(o => `<option value="${esc(o)}" ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('');
            fieldHtml = `<div class="form-row"><label>${esc(f.label)}</label><select data-key="${esc(f.key)}">${opts}</select>${desc}</div>`;
            break;
        }
        case 'channel':
            fieldHtml = `<div class="form-row"><label>${esc(f.label)}</label>${renderChannelSelect(f.key, val, f.channelType)}${desc}</div>`;
            break;
        case 'channels':
            fieldHtml = `<div class="form-row"><label>${esc(f.label)}</label>${renderMultiSelect(f.key, val || [], state.channels, 'channel')}${desc}</div>`;
            break;
        case 'role':
            fieldHtml = `<div class="form-row"><label>${esc(f.label)}</label>${renderRoleSelect(f.key, val)}${desc}</div>`;
            break;
        case 'roles':
            fieldHtml = `<div class="form-row"><label>${esc(f.label)}</label>${renderMultiSelect(f.key, val || [], state.roles, 'role')}${desc}</div>`;
            break;
        case 'tags':
            fieldHtml = `<div class="form-row"><label>${esc(f.label)}</label>${renderTags(f.key, Array.isArray(val) ? val : [])}${desc}</div>`;
            break;
        case 'jsonList':
            fieldHtml = `<div class="form-row"><label>${esc(f.label)}</label>${renderJsonList(f, val || [])}${desc}</div>`;
            break;
        default:
            fieldHtml = `<div class="form-row"><label>${esc(f.label)}</label><input type="text" data-key="${esc(f.key)}" value="${esc(val || '')}"></div>`;
            break;
    }
    
    if (f.premium) {
        return window.premLock(fieldHtml, 'Premium Feature');
    }
    return fieldHtml;
}

function normalizeColor(v) {
    if (!v) return '#6366f1';
    const s = String(v);
    if (s.startsWith('#') && (s.length === 7 || s.length === 4)) return s;
    return '#6366f1';
}

function renderChannelSelect(key, val, type) {
    const channels = state.channels || [];
    const filtered = type === 'voice' ? channels.filter(c => c.type === 2)
        : type === 'category' ? channels.filter(c => c.type === 4) // nosonar
            : channels.filter(c => c.type === 0 || c.type === 5);
    const opts = ['<option value="">— None —</option>']
        .concat(filtered.map(c => `<option value="${esc(c.id)}" ${val === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`))
        .join('');
    return `<select data-key="${esc(key)}">${opts}</select>`;
}

function renderRoleSelect(key, val) {
    const opts = ['<option value="">— None —</option>']
        .concat((state.roles || []).map(r => `<option value="${esc(r.id)}" ${val === r.id ? 'selected' : ''}>${esc(r.name)}</option>`))
        .join('');
    return `<select data-key="${esc(key)}">${opts}</select>`;
}

function renderMultiSelect(key, val, items, kind) {
    const ids = new Set(val);
    const opts = items.map(i => `<option value="${esc(i.id)}" ${ids.has(i.id) ? 'selected' : ''}>${kind === 'channel' ? '#' : ''}${esc(i.name)}</option>`).join('');
    return `<select multiple data-key="${esc(key)}" data-multi="1" size="5" style="min-height:120px">${opts}</select>`;
}

function renderTags(key, list) {
    const chips = list.map((t, i) => `<span class="chip" data-idx="${i}">${esc(t)}<button onclick="window.__rmTag('${esc(key)}', ${i})">×</button></span>`).join('');
    return `<div class="chips" id="chips-${cssKey(key)}">${chips}</div>
        <input class="mt-1" type="text" placeholder="Type and press Enter" data-tag-input="${esc(key)}">`;
}

function cssKey(k) { return k.replaceAll('.', '-'); }

function renderJsonList(f, list) {
    return `<div id="jlist-${cssKey(f.key)}">
        ${list.map((it, i) => jsonListItem(f, it, i)).join('')}
        <button class="btn sm mt-1" onclick="window.__jlistAdd('${esc(f.key)}')">${icon('user-plus')} Add</button>
    </div>`;
}
function jsonListItem(f, item, i) {
    const key = f.key;
    let html = `<div class="listi" style="display:block">`;
    html += `<div class="row mb-2"><span class="tag">#${i + 1}</span><span class="spacer"></span><button class="btn sm danger" onclick="window.__jlistRm('${esc(key)}', ${i})">Remove</button></div>`;
    for (const s of (f.schema || [])) {
        html += renderField({ ...s, key: `${key}[${i}].${s.key}` }, { [key.replaceAll('.', '_')]: null, __jlist_item: item });
    }
    html += `</div>`;
    return html;
}

// Helpers exposed for inline handlers
window.__rmTag = (key, idx) => {
    const arr = getDeep(window.__working, key) || [];
    arr.splice(idx, 1);
    setDeep(window.__working, key, arr);
    refreshTags(key);
};
window.__jlistAdd = (key) => {
    const arr = (getDeep(window.__working, key) || []).slice();
    arr.push({});
    setDeep(window.__working, key, arr);
    if (window.__renderModule) window.__renderModule();
};
window.__jlistRm = (key, idx) => {
    const arr = (getDeep(window.__working, key) || []).slice();
    arr.splice(idx, 1);
    setDeep(window.__working, key, arr);
    if (window.__renderModule) window.__renderModule();
};

function refreshTags(key) {
    const arr = getDeep(window.__working, key) || [];
    const node = $('#chips-' + cssKey(key));
    if (!node) return;
    node.innerHTML = arr.map((t, i) => `<span class="chip">${esc(t)}<button onclick="window.__rmTag('${esc(key)}', ${i})">×</button></span>`).join('');
}

function bindFormInputs(working) {
    window.__working = working;

    // Scalar inputs (checkbox, text, number, select, color, textarea)
    $$('#page [data-key]').forEach(el => {
        const key = el.dataset.key;
        // Handle bracketed (jsonList) paths: foo[0].bar
        const apply = (value) => {
            if (key.includes('[')) {
                const match = key.match(/^(.+?)\[(\d+)\]\.(.+)$/);
                if (match) {
                    const [, b, idx, sub] = match;
                    const arr = getDeep(working, b) || [];
                    arr[idx] = arr[idx] || {};
                    setDeep(arr[idx], sub, value);
                    setDeep(working, b, arr);
                }
            } else {
                setDeep(working, key, value);
            }
        };

        if (el.type === 'checkbox') {
            el.addEventListener('change', () => apply(el.checked));
        } else if (el.dataset.multi) {
            el.addEventListener('change', () => apply([...el.selectedOptions].map(o => o.value)));
        } else if (el.type === 'number') {
            el.addEventListener('input', () => apply(el.value === '' ? null : Number(el.value)));
        } else if (el.type === 'color') {
            el.addEventListener('input', () => {
                apply(el.value);
                // Sync paired text input(s) with same data-key
                $$(`#page [data-key="${CSS.escape(key)}"]`).forEach(pair => {
                    if (pair !== el && pair.type === 'text') pair.value = el.value;
                });
            });
        } else if (el.type === 'text' || el.type === 'url' || el.type === 'email') {
            el.addEventListener('input', () => {
                apply(el.value);
                // Sync paired color input if this looks like a hex color
                if (/^#[0-9a-fA-F]{6}$/.test(el.value)) {
                    $$(`#page [data-key="${CSS.escape(key)}"]`).forEach(pair => {
                        if (pair !== el && pair.type === 'color') pair.value = el.value;
                    });
                }
            });
        } else if (el.tagName === 'TEXTAREA') {
            el.addEventListener('input', () => apply(el.value));
        } else if (el.tagName === 'SELECT') {
            el.addEventListener('change', () => apply(el.value));
        } else {
            el.addEventListener('input', () => apply(el.value));
        }
    });

    // Tag inputs
    $$('#page [data-tag-input]').forEach(inp => {
        const key = inp.dataset.tagInput;
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && inp.value.trim()) {
                e.preventDefault();
                const arr = (getDeep(working, key) || []).slice();
                if (!arr.includes(inp.value.trim())) {
                    arr.push(inp.value.trim());
                    setDeep(working, key, arr);
                    inp.value = '';
                    refreshTags(key);
                }
            }
        });
    });
}

// â”€â”€â”€â”€â”€ Page: profile (professional, feature-rich) â”€â”€â”€â”€â”€â”€â”€
async function pageProfile() { // nosonar
    const page = $('#page');
    page.innerHTML = `<div style="display:flex;justify-content:center;padding:4rem 0"><div class="spinner"></div></div>`;

    const [profileData, analyticsData] = await Promise.all([
        api('/api/users/me/profile'),
        api('/api/users/me/analytics'),
    ]);

    if (!profileData || profileData._error || profileData._unauth) {
        page.innerHTML = `<div class="empty"><h3>Could not load profile</h3><p>${esc(profileData?.error || 'Server Error: Could not fetch profile data.')}</p></div>`;
        return;
    }

    const d = profileData;
    const a = analyticsData || { summary: {}, topGuilds: [], daily: [] };
    window.__profileData = d;

    const fmtNum = n => (Number(n) || 0).toLocaleString();
    const fmtTime = secs => { // nosonar
        const s = Number(secs) || 0;
        if (s < 60) return `${s}s`;
        if (s < 3600) return `${Math.round(s / 60)}m`;
        return `${Math.round(s / 3600 * 10) / 10}h`;
    };
    const since = ts => {
        if (!ts) return '—';
        const date = new Date(ts);
        return isNaN(date) ? '—' : date.toLocaleDateString(); // nosonar
    };

    // Build sparkline for 7-day messages
    const maxMsg = Math.max(1, ...a.daily.map(x => x.messages));
    const sparkline = a.daily.map(day => {
        const h = Math.round((day.messages / maxMsg) * 40) + 4;
        return `<div title="${esc(day.date)}: ${fmtNum(day.messages)} msgs" style="flex:1;height:${h}px;background:linear-gradient(to top, var(--accent), var(--accent-2));border-radius:3px;margin:0 2px;min-width:14px"></div>`;
    }).join('');

    // Top guilds table
    const topGuildsHtml = a.topGuilds.length ? a.topGuilds.map((g, i) => {
        const server = (state.guilds || []).find(x => x.id === g.guildId);
        return `<tr>
            <td><span class="tag">${i + 1}</span></td>
            <td class="row" style="gap:.5rem;align-items:center">
                <div class="ic" style="width:28px;height:28px;border-radius:50%;background:var(--accent-grad);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:.8rem;overflow:hidden">
                    ${server?.icon ? `<img src="${esc(server.icon)}" style="width:100%;height:100%;object-fit:cover">` : esc((server?.name || '?')[0])}
                </div>
                <span>${esc(server?.name || g.guildId)}</span>
            </td>
            <td><b>${g.level}</b></td>
            <td>${fmtNum(g.xp)}</td>
            <td>#${g.rank || '—'}${g.totalRanked ? ` <span class="text-xs text-mute">of ${fmtNum(g.totalRanked)}</span>` : ''}</td>
            <td>${fmtNum(g.messages)}</td>
        </tr>`;
    }).join('') : '<tr><td colspan="6" class="text-sm text-mute center">No server data yet. Start chatting in a server with xNico!</td></tr>';

    // Badges
    const badgesHtml = d.social.badges.length
        ? d.social.badges.map(b => `<span class="chip">${esc(b)}</span>`).join('')
        : '<span class="text-sm text-mute">No badges earned yet.</span>';

    // Avatar initial
    const avatarContent = d.user.avatar
        ? `<img src="${esc(d.user.avatar)}" style="width:100%;height:100%;object-fit:cover">`
        : esc((d.user.username || 'U')[0].toUpperCase());

    page.innerHTML = `
        <!-- PROFILE HEADER -->
        <div class="card mb-2" style="border:1px solid var(--border-2)">
            <div class="row wrap" style="gap:1.5rem;align-items:center">
                <div style="width:96px;height:96px;border-radius:50%;background:var(--accent-grad);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:2.5rem;overflow:hidden;border:3px solid rgba(255,255,255,.1)">
                    ${avatarContent}
                </div>
                <div style="flex:1;min-width:220px">
                    <div class="row wrap" style="gap:.5rem;align-items:center;margin-bottom:.5rem">
                        <h1 style="margin:0;font-size:1.6rem">${esc(d.user.username)}</h1>
                        ${d.user.isOwner ? '<span class="tag amber">Owner</span>' : ''}
                        ${d.user.hasPremium ? '<span class="tag green">Premium</span>' : ''}
                        <span class="tag grey">${esc(d.user.role)}</span>
                    </div>
                    <div class="text-sm text-mute mono">${esc(d.user.discordId || '—')}</div>
                    <div class="text-xs text-mute mt-1">
                        Member since ${since(d.user.memberSince)} • ${fmtNum(d.stats.serversWithData)} server${d.stats.serversWithData !== 1 ? 's' : ''} tracked
                    </div>
                    ${d.social.bio ? `<p class="mt-2" style="max-width:600px">${esc(d.social.bio)}</p>` : ''}
                </div>
                <div class="row" style="gap:.5rem">
                    <button class="btn" onclick="window.__profileEditBio()">${icon('user')} Edit Bio</button>
                    <button class="btn primary" onclick="window.__profileEditCard()">${icon('image')} Profile & Rank Cards</button>
                </div>
            </div>
        </div>

        <!-- KEY STATS -->
        <div class="grid g-4 mb-3">
            <div class="stat purple"><div class="ic">${icon('coin')}</div><div><div class="v">${fmtNum(d.economy.total)}</div><div class="l">Total Wealth</div></div></div>
            <div class="stat cyan"><div class="ic">${icon('trend')}</div><div><div class="v">${fmtNum(d.leveling.totalXp)}</div><div class="l">Total XP</div></div></div>
            <div class="stat green"><div class="ic">${icon('chat')}</div><div><div class="v">${fmtNum(d.leveling.totalMessages)}</div><div class="l">Messages</div></div></div>
            <div class="stat amber"><div class="ic">${icon('mic')}</div><div><div class="v">${d.leveling.totalVoiceHours}h</div><div class="l">Voice Time</div></div></div>
        </div>

        <div class="grid g-2 mb-2">
            <!-- ECONOMY CARD -->
            <div class="card">
                <div class="card-h"><div class="ic">${icon('coin')}</div><div class="tt"><div class="t">Economy</div><div class="s">Your wallet & bank.</div></div></div>
                <div class="grid g-2 mt-2">
                    <div style="padding:1rem;background:var(--bg-hover);border-radius:10px">
                        <div class="text-xs text-mute">Wallet</div>
                        <div style="font-size:1.4rem;font-weight:800">${fmtNum(d.economy.wallet)}</div>
                    </div>
                    <div style="padding:1rem;background:var(--bg-hover);border-radius:10px">
                        <div class="text-xs text-mute">Bank</div>
                        <div style="font-size:1.4rem;font-weight:800">${fmtNum(d.economy.bank)}</div>
                    </div>
                </div>
                <hr>
                <div class="text-xs">
                    <div class="row mb-1"><span class="text-mute">Last daily:</span><span class="spacer"></span><b>${since(d.economy.lastDaily)}</b></div>
                    <div class="row mb-1"><span class="text-mute">Last weekly:</span><span class="spacer"></span><b>${since(d.economy.lastWeekly)}</b></div>
                    <div class="row"><span class="text-mute">Last work:</span><span class="spacer"></span><b>${since(d.economy.lastWork)}</b></div>
                </div>
                <div class="text-xs text-mute mt-2">Inventory: ${d.economy.inventory.length} item${d.economy.inventory.length !== 1 ? 's' : ''}</div>
            </div>

            <!-- LEVELING CARD -->
            <div class="card">
                <div class="card-h"><div class="ic">${icon('trend')}</div><div class="tt"><div class="t">Leveling</div><div class="s">Highest level across all servers.</div></div></div>
                <div class="center mt-2" style="padding:1rem">
                    <div style="font-size:3rem;font-weight:900" class="grad-text">${d.leveling.highestLevel}</div>
                    <div class="text-xs text-mute">Highest Level</div>
                </div>
                <div class="grid g-3 mt-2">
                    <div class="center"><div class="text-xs text-mute">Global Lv</div><b>${d.leveling.globalLevel}</b></div>
                    <div class="center"><div class="text-xs text-mute">Rep</div><b>${fmtNum(d.social.reputation)}</b></div>
                    <div class="center"><div class="text-xs text-mute">Servers</div><b>${d.stats.serversWithData}</b></div>
                </div>
            </div>

            <!-- ACTIVITY CARD -->
            <div class="card">
                <div class="card-h"><div class="ic">${icon('chart')}</div><div class="tt"><div class="t">Activity (7d)</div><div class="s">Estimated daily messages.</div></div></div>
                <div class="row" style="height:60px;align-items:flex-end;margin-top:1rem">
                    ${sparkline}
                </div>
                <div class="row mt-2" style="justify-content:space-between">
                    <span class="text-xs text-mute">${a.daily[0]?.date || '—'}</span>
                    <span class="text-xs text-mute">Today</span>
                </div>
            </div>

            <!-- MODERATION CARD -->
            <div class="card">
                <div class="card-h"><div class="ic">${icon('shield')}</div><div class="tt"><div class="t">Moderation & Activity</div><div class="s">Warnings, invites, commands.</div></div></div>
                <div class="grid g-3 mt-2">
                    <div class="center"><div class="text-xs text-mute">Warnings</div><b style="color:${d.stats.totalWarnings > 0 ? 'var(--warning)' : 'inherit'}">${fmtNum(d.stats.totalWarnings)}</b></div>
                    <div class="center"><div class="text-xs text-mute">Invites</div><b>${fmtNum(d.stats.totalInvites)}</b></div>
                    <div class="center"><div class="text-xs text-mute">Commands</div><b>${fmtNum(d.stats.commandsUsed)}</b></div>
                </div>
                <hr>
                <div class="grid g-2 mt-2">
                    <div class="center"><div class="text-xs text-mute">Voice (hrs)</div><b>${d.leveling.totalVoiceHours}</b></div>
                    <div class="center"><div class="text-xs text-mute">Bot Interactions</div><b>${fmtNum(d.stats.botInteractions)}</b></div>
                </div>
            </div>
        </div>

        <!-- TOP GUILDS -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('server')}</div><div class="tt"><div class="t">Top Servers</div><div class="s">Your highest-ranked communities by XP.</div></div></div>
            <table class="tbl">
                <thead><tr><th>#</th><th>Server</th><th>Level</th><th>XP</th><th>Rank</th><th>Messages</th></tr></thead>
                <tbody>${topGuildsHtml}</tbody>
            </table>
        </div>

        <!-- BADGES & AFK -->
        <div class="grid g-2 mb-2">
            <div class="card">
                <div class="card-h"><div class="ic">${icon('star')}</div><div class="tt"><div class="t">Badges</div><div class="s">Achievements earned.</div></div></div>
                <div class="chips mt-2">${badgesHtml}</div>
                ${d.social.marriedTo ? `<hr><div class="text-sm"><b>Married to:</b> <code>${esc(d.social.marriedTo)}</code></div>` : ''}
            </div>
            <div class="card">
                <div class="card-h"><div class="ic">${icon('moon')}</div><div class="tt"><div class="t">AFK Status</div><div class="s">Let others know you're away.</div></div></div>
                <div id="afk-wrap">
                    <div class="switch-row"><div><div class="lbl">${d.afk.isAfk ? 'Currently AFK' : 'Available'}</div>${d.afk.isAfk && d.afk.since ? `<div class="desc">Since ${since(d.afk.since)}</div>` : ''}</div>
                        <label class="switch"><input type="checkbox" id="afk-toggle" ${d.afk.isAfk ? 'checked' : ''}><span class="slide"></span></label>
                    </div>
                    <div class="form-row mt-2" id="afk-reason-wrap" style="${d.afk.isAfk ? '' : 'display:none'}">
                        <label>AFK Reason</label>
                        <input type="text" id="afk-reason" value="${esc(d.afk.reason || '')}" placeholder="Out for lunch...">
                    </div>
                    <button class="btn sm primary mt-2" onclick="window.__profileSaveAfk()">${icon('check')} Save AFK</button>
                </div>
            </div>
        </div>

        <!-- SESSION -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('settings')}</div><div class="tt"><div class="t">Session</div><div class="s">Your login details.</div></div></div>
            <div class="grid g-3 mt-2">
                <div><div class="text-xs text-mute">Discord ID</div><div class="bold mono">${esc(d.user.discordId)}</div></div>
                <div><div class="text-xs text-mute">Role</div><div class="bold">${esc(d.user.role.toUpperCase())}</div></div>
                <div><div class="text-xs text-mute">Email</div><div class="bold">${esc(d.user.email || '—')}</div></div>
            </div>
            <hr>
            <div class="row">
                <button class="btn danger" onclick="logout()">${icon('user-x')} Log Out</button>
                <span class="spacer"></span>
                <a class="btn" href="https://discord.com/users/${esc(d.user.discordId)}" target="_blank">${icon('user')} View on Discord</a>
            </div>
        </div>
    `;

    // AFK toggle live visibility
    const afkToggle = document.getElementById('afk-toggle');
    if (afkToggle) {
        afkToggle.addEventListener('change', () => {
            const rw = document.getElementById('afk-reason-wrap');
            if (rw) rw.style.display = afkToggle.checked ? '' : 'none';
        });
    }
}

// Edit bio modal
window.__profileEditBio = () => {
    const d = window.__profileData;
    const currentBio = d?.social?.bio || '';
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
        <div class="modal">
            <h3>Edit Bio</h3>
            <p>Your bio shows on your rank card and profile.</p>
            <textarea id="pf-bio" rows="4" maxlength="500" placeholder="Tell others about yourself...">${esc(currentBio)}</textarea>
            <div class="row mt-2">
                <button class="btn" onclick="this.closest('.modal-wrap').remove()">Cancel</button>
                <span class="spacer"></span>
                <button class="btn primary" id="pf-bio-save">${icon('check')} Save</button>
            </div>
        </div>`;
    document.body.appendChild(wrap);
    document.getElementById('pf-bio-save').onclick = async () => {
        const bio = document.getElementById('pf-bio').value;
        const r = await api('/api/users/me/profile', { method: 'PUT', body: JSON.stringify({ bio }) });
        if (r && !r._error) { toast('Bio updated', 'success'); wrap.remove(); pageProfile(); }
        else toast(r?.error || 'Save failed', 'error');
    };
};

// Edit rank + profile card modal
window.__profileEditCard = () => {
    const d = window.__profileData;
    
    if (!d.user.hasPremium && !d.user.hasVoted && !d.user.isOwner) {
        const wrap = document.createElement('div');
        wrap.className = 'modal-wrap';
        const cid = state.botInfo?.id || '';
        wrap.innerHTML = `
            <div class="modal center" style="max-width:400px; padding: 2rem;">
                <div style="font-size:3rem; margin-bottom:1rem; color:var(--accent);">${icon('lock')}</div>
                <h3>Premium or Vote Required</h3>
                <p class="text-mute mt-1 mb-2">Customizing your profile and rank cards requires <strong>xNico Premium</strong> or an active <strong>Top.gg vote</strong>.</p>
                <div class="row center mt-2" style="gap:1rem;">
                    <button class="btn" onclick="this.closest('.modal-wrap').remove()">Close</button>
                    <a class="btn primary" href="https://top.gg/bot/${cid}/vote" target="_blank">Vote Now</a>
                </div>
            </div>`;
        document.body.appendChild(wrap);
        return;
    }

    const rc = d?.rankCard || {};
    const pc = d?.profileCard || {};
    const styles = ['default', 'minimal', 'neon', 'classic', 'modern'];
    const fonts = ['Inter', 'Poppins', 'Montserrat', 'Outfit', 'SpaceGrotesk', 'JetBrainsMono', 'Comfortaa', 'Orbitron', 'Rajdhani'];
    const badges = ['default', 'minimal', 'compact'];
    const banner = rc.bannerImage || pc.bannerImage || '';
    const bannerMode = rc.bannerMode || pc.bannerMode || 'strip';
    const accent = pc.accentColor || rc.progressBarColor || '#bcf1e4'; // nosonar

    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
        <div class="modal" style="max-width:560px">
            <h3>Customize Cards</h3>
            <p>Applies to your <code>/rank</code> card and your <code>/profile</code> card.</p>
            <div class="form-row"><label>Card Style</label>
                <select id="rc-style">${styles.map(s => `<option value="${s}" ${rc.cardStyle === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}</select>
            </div>
            <div class="form-row"><label>Font</label>
                <select id="rc-font">${fonts.map(f => `<option value="${f}" ${rc.fontFamily === f ? 'selected' : ''}>${f}</option>`).join('')}</select>
            </div>
            <div class="grid g-2">
                <div class="form-row"><label>Background Color</label>
                    <div class="row"><input type="color" id="rc-bg" value="${esc(rc.backgroundColor || '#2f3136')}"><input type="text" id="rc-bg-hex" value="${esc(rc.backgroundColor || '#2f3136')}" style="flex:1"></div>
                </div>
                <div class="form-row"><label>Progress / Accent Color</label>
                    <div class="row"><input type="color" id="rc-prog" value="${esc(rc.progressBarColor || '#bcf1e4')}"><input type="text" id="rc-prog-hex" value="${esc(rc.progressBarColor || '#bcf1e4')}" style="flex:1"></div>
                </div>
                <div class="form-row"><label>Text Color</label>
                    <div class="row"><input type="color" id="rc-text" value="${esc(rc.textColor || '#ffffff')}"><input type="text" id="rc-text-hex" value="${esc(rc.textColor || '#ffffff')}" style="flex:1"></div>
                </div>
                <div class="form-row"><label>Background Opacity</label>
                    <input type="number" id="rc-opacity" value="${rc.backgroundOpacity ?? 0.35}" min="0" max="1" step="0.05">
                </div>
                <div class="form-row"><label>Badge Style (profile)</label>
                    <select id="rc-badge">${badges.map(b => `<option value="${b}" ${pc.badgeStyle === b ? 'selected' : ''}>${b.charAt(0).toUpperCase() + b.slice(1)}</option>`).join('')}</select>
                </div>
                <div class="form-row"><label>Banner Mode</label>
                    <select id="rc-bmode">
                        <option value="strip" ${bannerMode === 'strip' ? 'selected' : ''}>Strip (top band)</option>
                        <option value="full" ${bannerMode === 'full' ? 'selected' : ''}>Full (whole card)</option>
                    </select>
                </div>
            </div>
            <div class="form-row"><label>Custom Background Image URL</label>
                <input type="url" id="rc-bgimg" value="${esc(rc.customBackground || '')}" placeholder="https://... (optional)">
            </div>
            <div class="form-row"><label>Banner Image URL</label>
                <input type="url" id="rc-banner" value="${esc(banner)}" placeholder="https://... (optional)">
            </div>
            <div class="row mt-2">
                <button class="btn" onclick="this.closest('.modal-wrap').remove()">Cancel</button>
                <span class="spacer"></span>
                <button class="btn primary" id="rc-save">${icon('check')} Save</button>
            </div>
        </div>`;
    document.body.appendChild(wrap);

    // Sync color pickers with hex inputs
    ['bg', 'prog', 'text'].forEach(k => {
        const picker = document.getElementById(`rc-${k}`);
        const hex = document.getElementById(`rc-${k}-hex`);
        picker.addEventListener('input', () => { hex.value = picker.value; });
        hex.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) picker.value = hex.value; });
    });

    document.getElementById('rc-save').onclick = async () => {
        const progress = document.getElementById('rc-prog-hex').value;
        // Unified payload — the server applies it to BOTH the rank card and
        // the profile card so /rank and /profile stay in sync.
        const payload = {
            card: {
                cardStyle: document.getElementById('rc-style').value,
                fontFamily: document.getElementById('rc-font').value,
                backgroundColor: document.getElementById('rc-bg-hex').value,
                progressBarColor: progress,
                accentColor: progress,
                textColor: document.getElementById('rc-text-hex').value,
                backgroundOpacity: parseFloat(document.getElementById('rc-opacity').value), // nosonar
                badgeStyle: document.getElementById('rc-badge').value,
                bannerMode: document.getElementById('rc-bmode').value,
                customBackground: document.getElementById('rc-bgimg').value || null,
                bannerImage: document.getElementById('rc-banner').value || null
            }
        };
        const r = await api('/api/users/me/profile', { method: 'PUT', body: JSON.stringify(payload) });
        if (r && !r._error) { toast('Cards saved', 'success'); wrap.remove(); pageProfile(); }
        else toast(r?.error || 'Save failed', 'error');
    };
};

// Save AFK
window.__profileSaveAfk = async () => {
    const isAfk = document.getElementById('afk-toggle').checked;
    const reason = document.getElementById('afk-reason').value || '';
    const r = await api('/api/users/me/profile', { method: 'PUT', body: JSON.stringify({ afk: { isAfk, reason } }) });
    if (r && !r._error) { toast(isAfk ? 'You are now AFK' : 'AFK cleared', 'success'); pageProfile(); }
    else toast(r?.error || 'Save failed', 'error');
};

// â”€â”€â”€â”€â”€ Page: commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function pageCommands() {
    const data = await api('/api/commands') || { categories: [], totalCommands: 0 };
    const cats = data.categories || [];
    const viewerHasPremium = !!(data.viewer?.isOwner || data.viewer?.hasPremium);
    let activeFilter = 'all'; // all | free | premium

    function render() {
        const filtered = cats.map(c => ({
            ...c,
            shown: c.commands.filter(cmd => activeFilter === 'all' || (activeFilter === 'premium') === !!cmd.premium)
        })).filter(c => c.shown.length);

        $('#page').innerHTML = `
            <div class="page-h">
                <div>
                    <h1>Commands</h1>
                    <p>
                        Browse <b>${data.totalCommands || 0}</b> commands across ${cats.length} categories.
                        ${data.premiumCommands ? `<span class="tag amber" style="margin-left:.5rem">${icon('crown')} ${data.premiumCommands} Premium</span>` : ''}
                        ${viewerHasPremium ? '<span class="tag green" style="margin-left:.5rem">You have Premium access</span>' : '<span class="tag grey" style="margin-left:.5rem">Free tier</span>'}
                    </p>
                </div>
                <div class="row gap-1">
                    <button class="btn ${activeFilter === 'all' ? 'primary' : ''}" data-filter="all">All</button>
                    <button class="btn ${activeFilter === 'free' ? 'primary' : ''}" data-filter="free">Free</button>
                    <button class="btn ${activeFilter === 'premium' ? 'primary' : ''}" data-filter="premium">${icon('crown')} Premium</button>
                </div>
            </div>
            <div class="grid g-3">
                ${filtered.map(c => `
                    <div class="card hover" data-cat="${esc(c.key)}">
                        <div class="card-h">
                            <div class="ic">${c.icon || icon('grid')}</div>
                            <div class="tt">
                                <div class="t">${esc(c.name)} ${c.premiumCount ? `<span class="tag amber" style="font-size:.65rem;padding:.1rem .4rem">${c.premiumCount} PRO</span>` : ''}</div>
                                <div class="s">${c.shown.length}${c.shown.length !== c.count ? ' / ' + c.count : ''} commands</div>
                            </div>
                        </div>
                        <p class="text-mute">${esc(c.desc || '')}</p>
                        <details>
                            <summary class="text-sm" style="cursor:pointer;color:var(--accent);user-select:none">Show commands</summary>
                            <div class="row wrap gap-1 mt-2">
                                ${c.shown.map(cmd => `
                                    <span class="tag ${cmd.premium ? 'amber' : 'grey'}" title="${esc(cmd.description || cmd.name)}">
                                        ${cmd.premium ? `${icon('crown')} ` : ''}${esc(cmd.name)}
                                    </span>
                                `).join('')}
                            </div>
                        </details>
                    </div>`).join('') || '<div class="empty"><p>No commands match this filter.</p></div>'}
            </div>
            ${!viewerHasPremium && data.premiumCommands ? `
                <div class="card mt-3 premium-glow" style="text-align:center">
                    ${icon('crown')}
                    <h3 style="margin-top:.5rem">Unlock ${data.premiumCommands} Premium Commands</h3>
                    <p class="text-mute">Premium tier includes loan, customshop, currency, 247 (24/7 music), bot-customize, AI chat setup, and more.</p>
                    <a class="btn primary mt-2" href="https://discord.gg/Zs35X7Umak" target="_blank">${icon('star')} Get Premium</a>
                </div>` : ''}
        `;
        $$('[data-filter]').forEach(b => b.onclick = () => { activeFilter = b.dataset.filter; render(); });
    }
    render();
}

// â”€â”€â”€â”€â”€ Page: premium key generator (owner only) â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function pagePremium() {
    if (!state.user?.isOwner) { location.hash = '#/servers'; return; }
    const data = await api('/api/premium');
    if (data?._error) {
        $('#page').innerHTML = `<div class="empty"><h3>Failed</h3><p>${esc(data.error || 'Could not load keys.')}</p></div>`;
        return;
    }
    const keys = data?.keys || [];

    const tierStats = keys.reduce((acc, k) => {
        const t = k.tier || 'user';
        acc[t] = (acc[t] || 0) + 1;
        if (k.redeemed) acc.redeemed++;
        else acc.unredeemed++;
        return acc;
    }, { user: 0, server: 0, redeemed: 0, unredeemed: 0 });

    $('#page').innerHTML = `
        <div class="page-h">
            <div><h1>${icon('crown')} Premium Keys <span class="tag amber">Owner</span></h1><p>Generate, audit, and revoke premium keys.</p></div>
            <a class="btn" href="#/servers">${icon('home')} Back</a>
        </div>

        <div class="grid g-4 mb-3">
            <div class="stat purple"><div class="ic">${icon('coin')}</div><div><div class="v">${keys.length}</div><div class="l">Total Keys</div></div></div>
            <div class="stat green"><div class="ic">${icon('check')}</div><div><div class="v">${tierStats.redeemed}</div><div class="l">Redeemed</div></div></div>
            <div class="stat amber"><div class="ic">${icon('star')}</div><div><div class="v">${tierStats.unredeemed}</div><div class="l">Available</div></div></div>
            <div class="stat cyan"><div class="ic">${icon('server')}</div><div><div class="v">${tierStats.server}</div><div class="l">Server-tier</div></div></div>
        </div>

        <div class="card">
            <div class="card-h"><div class="ic">${icon('star')}</div><div class="tt"><div class="t">Generate Key</div><div class="s">Creates a redeemable XNICO-XXXX-XXXX key.</div></div></div>
            <div class="form-grid mt-2">
                <label class="field"><span>Tier</span>
                    <select id="pk-tier">
                        <option value="user">User Premium</option>
                        <option value="server">Server Premium</option>
                    </select>
                </label>
                <label class="field"><span>Duration</span>
                    <select id="pk-dur">
                        <option value="7d">7 days</option>
                        <option value="30d" selected>30 days</option>
                        <option value="90d">90 days</option>
                        <option value="365d">1 year</option>
                        <option value="lifetime">Lifetime</option>
                    </select>
                </label>
            </div>
            <button class="btn primary mt-2" id="pk-gen">${icon('star')} Generate Key</button>
            <div id="pk-out" class="mt-2"></div>
        </div>

        <div class="card mt-3">
            <div class="card-h"><div class="ic">${icon('log')}</div><div class="tt"><div class="t">All Keys</div><div class="s">${keys.length} on record</div></div></div>
            ${keys.length ? `<table class="tbl">
                <thead><tr><th>Key</th><th>Tier</th><th>Duration</th><th>Status</th><th>Created</th><th></th></tr></thead>
                <tbody>${keys.map(k => `
                    <tr>
                        <td class="mono">${esc(k.key)}</td>
                        <td><span class="tag ${k.tier === 'server' ? 'cyan' : 'purple'}">${esc(k.tier || 'user')}</span></td>
                        <td>${esc(k.duration || '—')}</td>
                        <td>${k.redeemed
            ? `<span class="tag green">Redeemed${k.redeemedBy ? ' by ' + esc(k.redeemedBy) : ''}</span>` // nosonar
            : '<span class="tag amber">Available</span>'}</td>
                        <td class="text-sm text-mute">${k.createdAt ? new Date(k.createdAt).toLocaleDateString() : '—'}</td>
                        <td>${k.redeemed ? '' : `<button class="btn" data-revoke="${esc(k.key)}" title="Revoke key">${icon('user-x')}</button>`}</td>
                    </tr>`).join('')}</tbody>
            </table>` : '<div class="empty"><p>No keys generated yet.</p></div>'}
        </div>
    `;

    $('#pk-gen').onclick = async () => {
        const btn = $('#pk-gen'); btn.disabled = true;
        const r = await api('/api/premium/generate', {
            method: 'POST',
            body: JSON.stringify({ tier: $('#pk-tier').value, duration: $('#pk-dur').value })
        });
        btn.disabled = false;
        if (r?._error) return toast(r.error || 'Generation failed', 'error');
        $('#pk-out').innerHTML = `
            <div class="tag green" style="font-size:1rem;padding:.5rem 1rem;font-family:monospace;letter-spacing:.05em">${esc(r.key)}</div>
            <p class="text-sm text-mute mt-1">Copied to clipboard. Send via DM and tell the user to redeem with <code>/redeemkey</code>.</p>`;
        try { await navigator.clipboard.writeText(r.key); } catch { }
        toast('Key generated and copied', 'success');
        // Refresh after a short pause
        setTimeout(pagePremium, 800);
    };

    $('#page').addEventListener('click', async e => {
        const k = e.target.closest('[data-revoke]')?.dataset.revoke;
        if (!k) return;
        if (!confirm(`Revoke key ${k}? This cannot be undone.`)) return;
        const r = await api(`/api/premium/${encodeURIComponent(k)}`, { method: 'DELETE' });
        if (r?._error) return toast(r.error || 'Revoke failed', 'error');
        toast('Key revoked', 'success');
        pagePremium();
    });
}

// â”€â”€â”€â”€â”€ Page: 404 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function pageNotFound(msg) {
    $('#page').innerHTML = `
        <div class="empty">
            ${icon('grid')}
            <h3>Page not found</h3>
            <p>${esc(msg || 'That route does not exist.')}</p>
            <a class="btn primary mt-2" href="#/servers">Go to Servers</a>
        </div>`;
}

// â”€â”€â”€â”€â”€ Start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
document.addEventListener('DOMContentLoaded', bootstrap);
