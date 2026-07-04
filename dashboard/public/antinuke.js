/* =========================================================
   xNico Dashboard — antinuke.js
   8 protection modules + whitelist + bypass role + log channel.
   Syncs to jsonStore 'antinuke' read live by bot's event handlers.
   ========================================================= */

const ANTINUKE_MODULES = [
    { key: 'banProtection',  label: 'Ban Protection',   desc: 'Detect mass member bans.',        icon: 'shield', hasLimit: true  },
    { key: 'kickProtection', label: 'Kick Protection',  desc: 'Detect mass member kicks.',       icon: 'user-x', hasLimit: true  },
    { key: 'channelDelete',  label: 'Channel Delete',   desc: 'Detect mass channel deletions.',  icon: 'grid',   hasLimit: true  },
    { key: 'channelCreate',  label: 'Channel Create',   desc: 'Detect mass channel creation.',   icon: 'grid',   hasLimit: true  },
    { key: 'roleDelete',     label: 'Role Delete',      desc: 'Detect mass role deletions.',     icon: 'crown',  hasLimit: true  },
    { key: 'roleCreate',     label: 'Role Create',      desc: 'Detect mass role creation.',      icon: 'crown',  hasLimit: true  },
    { key: 'webhookCreate',  label: 'Webhook Protection', desc: 'Detect rogue webhook activity.', icon: 'link',  hasLimit: true  },
    { key: 'botAdd',         label: 'Bot Add',          desc: 'Block unauthorized bots joining.', icon: 'user-plus', hasLimit: false },
];

const ANTINUKE_PUNISH_OPTIONS = [
    { value: 'remove_roles', label: 'Strip all roles' },
    { value: 'kick',         label: 'Kick the offender' },
    { value: 'ban',          label: 'Ban the offender' },
    { value: 'timeout',      label: 'Timeout (24h)' },
];
const BOTADD_PUNISH_OPTIONS = [
    { value: 'kick_bot',  label: 'Kick the bot' },
    { value: 'kick_both', label: 'Kick bot & inviter' },
    { value: 'ban_bot',   label: 'Ban the bot' },
];

async function pageAntinuke() {
    const g = state.currentGuild;
    const [cfg, channels, roles] = await Promise.all([
        api(`/api/guild/${g.id}/antinuke`),
        api(`/api/guild/${g.id}/channels`),
        api(`/api/guild/${g.id}/roles`),
    ]);
    if (cfg?._error || cfg?._unauth) {
        $('#page').innerHTML = `<div class="empty"><h3>Failed to load</h3><p>${esc(cfg?.error || 'Unknown error')}</p></div>`;
        return;
    }
    state.channels = Array.isArray(channels) ? channels : [];
    state.roles    = Array.isArray(roles) ? roles.filter(r => r.name !== '@everyone') : [];

    const w = JSON.parse(JSON.stringify(cfg || {}));
    // Safety defaults
    for (const m of ANTINUKE_MODULES) {
        if (!w[m.key]) w[m.key] = m.hasLimit
            ? { enabled: false, limit: 3, timeWindow: 60000, action: 'remove_roles' }
            : { enabled: false, action: 'kick_bot' };
    }
    if (!Array.isArray(w.whitelistedUsers)) w.whitelistedUsers = [];

    // Draft recovery
    const draftKey = `draft:antinuke:${g.id}`;
    let hasDraft = false;
    try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
            const draft = JSON.parse(raw);
            if (JSON.stringify(draft) !== JSON.stringify(w)) {
                Object.assign(w, draft);
                hasDraft = true;
            } else localStorage.removeItem(draftKey);
        }
    } catch { localStorage.removeItem(draftKey); }

    window.__working = w;
    window.__anSnapshot = JSON.parse(JSON.stringify(cfg));
    window.__anDraftKey = draftKey;
    _renderAntinukeBody(g, w, hasDraft);
}

function _persistAnDraft() {
    try {
        if (!window.__anDraftKey || !window.__working) return;
        if (JSON.stringify(window.__working) === JSON.stringify(window.__anSnapshot)) {
            localStorage.removeItem(window.__anDraftKey);
            const i = document.getElementById('an-draft'); if (i) i.style.display = 'none';
        } else {
            localStorage.setItem(window.__anDraftKey, JSON.stringify(window.__working));
            const i = document.getElementById('an-draft'); if (i) i.style.display = '';
        }
    } catch {}
}

function _rerenderAnKeepScroll() {
    const y = window.scrollY;
    const g = state.currentGuild;
    const w = window.__working;
    const hasDraft = window.__anSnapshot && JSON.stringify(w) !== JSON.stringify(window.__anSnapshot);
    _renderAntinukeBody(g, w, hasDraft);
    requestAnimationFrame(() => window.scrollTo(0, y));
}

function _renderAntinukeBody(g, w, hasDraft) {
    const chSel = (key, val) => {
        const list = state.channels.filter(c => c.type === 0 || c.type === 5);
        return `<select data-key="${esc(key)}"><option value="">— None —</option>${list.map(c => `<option value="${esc(c.id)}" ${val === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select>`;
    };
    const roleSel = (key, val) => `<select data-key="${esc(key)}"><option value="">— None —</option>${state.roles.map(r => `<option value="${esc(r.id)}" ${val === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>`;
    const tog = (key, val, label, desc, extra) =>
        `<div class="switch-row"><div><div class="lbl">${esc(label)}</div>${desc ? `<div class="desc">${esc(desc)}</div>` : ''}</div><label class="switch"><input type="checkbox" data-key="${esc(key)}" ${val ? 'checked' : ''} ${extra || ''}><span class="slide"></span></label></div>`;
    const vis = (cond) => cond ? '' : 'style="display:none"';

    const activeCount = ANTINUKE_MODULES.filter(m => w[m.key]?.enabled).length;

    // Whitelist users as chips
    const wlHtml = (w.whitelistedUsers || []).map(id => `<span class="chip" style="font-family:monospace">${esc(id)} <button onclick="window.__anRmWlUser('${esc(id)}')">×</button></span>`).join('') || '<span class="text-sm text-mute">None</span>';

    // Each protection module card
    const modulesHtml = ANTINUKE_MODULES.map(m => {
        const cfg = w[m.key];
        const actionOpts = (m.key === 'botAdd' ? BOTADD_PUNISH_OPTIONS : ANTINUKE_PUNISH_OPTIONS);
        return `
            <div class="card mb-2">
                <div class="card-h">
                    <div class="ic">${icon(m.icon)}</div>
                    <div class="tt"><div class="t">${esc(m.label)}</div><div class="s">${esc(m.desc)}</div></div>
                    <label class="switch"><input type="checkbox" data-key="${m.key}.enabled" ${cfg.enabled?'checked':''} data-vis="anmod-${m.key}"><span class="slide"></span></label>
                </div>
                <div id="anmod-${m.key}" ${vis(cfg.enabled)}>
                    <div class="grid ${m.hasLimit ? 'g-3' : 'g-2'} mt-2">
                        ${m.hasLimit ? `
                            <div class="form-row"><label>Limit (actions)</label><input type="number" data-key="${m.key}.limit" value="${cfg.limit||3}" min="1" max="50"></div>
                            <div class="form-row"><label>Time Window (ms)</label><input type="number" data-key="${m.key}.timeWindow" value="${cfg.timeWindow||60000}" min="5000" max="600000" step="1000"><div class="hint">${Math.round((cfg.timeWindow||60000)/1000)}s</div></div>
                        ` : ''}
                        <div class="form-row"><label>Punishment</label>
                            <select data-key="${m.key}.action">${actionOpts.map(o => `<option value="${esc(o.value)}" ${cfg.action===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}</select>
                        </div>
                    </div>
                </div>
            </div>`;
    }).join('');

    const html = `
        <div class="page-h">
            <div><h1>Anti-Nuke</h1><p>Advanced security for ${esc(g.name)}. ${activeCount}/8 protections active.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div>
        </div>

        <div id="an-draft" class="row mb-2" style="${hasDraft?'':'display:none'}">
            <span class="tag amber">⚠ Unsaved draft</span>
            <span class="text-sm text-mute">Auto-saved locally.</span>
        </div>

        <!-- MASTER -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('shield')}</div><div class="tt"><div class="t">Master Switch</div><div class="s">Turn the whole protection system on/off.</div></div></div>
            ${tog('enabled', w.enabled, 'Enable Anti-Nuke', 'When off, no protection modules run.', 'data-vis="an-all"')}
        </div>

        <div id="an-all" ${vis(w.enabled)}>
            <!-- Shared settings -->
            <div class="card mb-2">
                <div class="card-h"><div class="ic">${icon('settings')}</div><div class="tt"><div class="t">Shared Settings</div><div class="s">Log channel, bypass role, user whitelist.</div></div></div>
                <div class="form-row"><label>Log Channel</label>${chSel('logChannel', w.logChannel)}<div class="hint">Where violations & punishments are logged.</div></div>
                <div class="form-row"><label>Bypass Role</label>${roleSel('bypassRoleId', w.bypassRoleId)}<div class="hint">Members with this role skip all anti-nuke checks.</div></div>
                <hr>
                <h4 class="mb-1">Whitelisted User IDs</h4>
                <p class="text-sm text-mute mb-2">Trusted users that bypass all protections. Server owner and bot are automatically exempt.</p>
                <div class="chips mb-2">${wlHtml}</div>
                <div class="row">
                    <input type="text" id="an-wl-input" placeholder="Discord User ID" style="flex:1;font-family:monospace">
                    <button class="btn sm" onclick="window.__anAddWlUser()">${icon('user-plus')} Add</button>
                </div>
            </div>

            <!-- Protection modules -->
            <h3 class="mb-2 mt-2">Protection Modules</h3>
            <p class="text-sm text-mute mb-2">Each module tracks one Discord event. Limit = max actions before punishment, time window = how long the counter resets.</p>
            ${modulesHtml}
        </div>

        <div class="save-bar">
            <div class="row">
                <span class="tag ${w.enabled?'green':'grey'}" id="mod-status-tag">${w.enabled?'Armed':'Offline'}</span>
                <span class="text-sm text-mute">Changes live instantly after save.</span>
            </div>
            <div class="row">
                <button class="btn" id="an-reset-btn">${icon('log')} Reset Draft</button>
                <button class="btn primary" id="an-save-btn">${icon('check')} Save</button>
            </div>
        </div>
    `;

    $('#page').innerHTML = html;
    bindFormInputs(w);

    // Progressive disclosure
    $$('#page [data-vis]').forEach(inp => {
        inp.addEventListener('change', () => {
            const t = document.getElementById(inp.dataset.vis);
            if (t) t.style.display = inp.checked ? '' : 'none';
        });
    });

    // Autosave
    let pt;
    $('#page').addEventListener('input', () => { clearTimeout(pt); pt = setTimeout(_persistAnDraft, 250); });
    $('#page').addEventListener('change', () => { clearTimeout(pt); pt = setTimeout(_persistAnDraft, 100); });

    $('#an-reset-btn').onclick = () => {
        if (confirm('Discard draft and reload saved config?')) {
            try { localStorage.removeItem(window.__anDraftKey); } catch {}
            handleRoute();
        }
    };
    $('#an-save-btn').onclick = async () => {
        const btn = $('#an-save-btn');
        btn.disabled = true; btn.textContent = 'Saving…';
        const r = await api(`/api/guild/${g.id}/antinuke`, { method: 'PUT', body: JSON.stringify(w) });
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (!r || r._error || r._unauth) toast(r?.error || 'Save failed', 'error');
        else {
            toast('Anti-Nuke saved — protections live!', 'success');
            try { localStorage.removeItem(window.__anDraftKey); } catch {}
            window.__anSnapshot = JSON.parse(JSON.stringify(w));
            const i = document.getElementById('an-draft'); if (i) i.style.display = 'none';
            $('#mod-status-tag').className = 'tag ' + (w.enabled ? 'green' : 'grey');
            $('#mod-status-tag').textContent = w.enabled ? 'Armed' : 'Offline';
        }
    };
}

// Whitelist user handlers
window.__anAddWlUser = () => {
    const inp = $('#an-wl-input');
    const v = (inp.value || '').trim();
    if (!/^\d{17,20}$/.test(v)) return toast('Enter a valid Discord user ID', 'error');
    if (!window.__working.whitelistedUsers.includes(v)) window.__working.whitelistedUsers.push(v);
    inp.value = '';
    _persistAnDraft();
    _rerenderAnKeepScroll();
};
window.__anRmWlUser = (id) => {
    window.__working.whitelistedUsers = window.__working.whitelistedUsers.filter(x => x !== id);
    _persistAnDraft();
    _rerenderAnKeepScroll();
};
