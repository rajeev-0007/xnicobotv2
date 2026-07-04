/* =========================================================
   xNico Dashboard — leveling.js
   Full leveling control: XP settings, level roles, ignore
   lists, announcements, role multipliers, and leaderboard.
   Syncs to the bot's guilds store + mirror stores
   (levelingtoggle, levelroles, levelchannel, levelmultiplier).
   ========================================================= */

async function pageLeveling() {
    const g = state.currentGuild;
    const [cfg, channels, roles, board] = await Promise.all([
        api(`/api/guild/${g.id}/leveling`),
        api(`/api/guild/${g.id}/channels`),
        api(`/api/guild/${g.id}/roles`),
        api(`/api/guild/${g.id}/leveling/leaderboard`),
    ]);
    if (cfg?._error || cfg?._unauth) {
        $('#page').innerHTML = `<div class="empty"><h3>Failed to load</h3><p>${esc(cfg?.error || 'Unknown error')}</p></div>`;
        return;
    }
    state.channels = Array.isArray(channels) ? channels : [];
    state.roles    = Array.isArray(roles) ? roles.filter(r => r.name !== '@everyone') : [];
    state.lvBoard  = Array.isArray(board) ? board : [];

    // Ensure defaults
    const w = JSON.parse(JSON.stringify(cfg || {}));
    w.xpSettings = w.xpSettings || { minXp: 15, maxXp: 25, cooldown: 60 };
    w.announcements = w.announcements || { enabled: true, channel: 'same', customChannelId: null, message: '' };
    w.roles = Array.isArray(w.roles) ? w.roles : [];
    w.ignoreChannels = Array.isArray(w.ignoreChannels) ? w.ignoreChannels : [];
    w.ignoreRoles = Array.isArray(w.ignoreRoles) ? w.ignoreRoles : [];
    w.disabledChannels = Array.isArray(w.disabledChannels) ? w.disabledChannels : [];
    w.roleMultipliers = w.roleMultipliers || {};

    // Draft recovery
    const draftKey = `draft:leveling:${g.id}`;
    let hasDraft = false;
    try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
            const draft = JSON.parse(raw);
            if (JSON.stringify(draft) !== JSON.stringify(w)) {
                Object.assign(w, draft);
                hasDraft = true;
            } else {
                localStorage.removeItem(draftKey);
            }
        }
    } catch { localStorage.removeItem(draftKey); }

    window.__working = w;
    window.__lvSavedSnapshot = JSON.parse(JSON.stringify(cfg));
    window.__lvDraftKey = draftKey;
    _renderLevelingBody(g, w, hasDraft);
}

function _persistLevelingDraft() {
    try {
        if (!window.__lvDraftKey || !window.__working) return;
        if (JSON.stringify(window.__working) === JSON.stringify(window.__lvSavedSnapshot)) {
            localStorage.removeItem(window.__lvDraftKey);
            const ind = document.getElementById('lv-draft-indicator');
            if (ind) ind.style.display = 'none';
        } else {
            localStorage.setItem(window.__lvDraftKey, JSON.stringify(window.__working));
            const ind = document.getElementById('lv-draft-indicator');
            if (ind) ind.style.display = '';
        }
    } catch {}
}

function _rerenderLevelingKeepScroll() {
    const scrollY = window.scrollY;
    const g = state.currentGuild;
    const w = window.__working;
    if (!g || !w) return;
    const hasDraft = window.__lvSavedSnapshot && JSON.stringify(w) !== JSON.stringify(window.__lvSavedSnapshot);
    _renderLevelingBody(g, w, hasDraft);
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

function _renderLevelingBody(g, w, hasDraft) {
    const chSel = (key, val) => {
        const list = state.channels.filter(c => c.type === 0 || c.type === 5);
        return `<select data-key="${esc(key)}"><option value="">— None —</option>${list.map(c => `<option value="${esc(c.id)}" ${val === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select>`;
    };
    const roleSel = (key, val) => `<select data-key="${esc(key)}"><option value="">— None —</option>${state.roles.map(r => `<option value="${esc(r.id)}" ${val === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>`;
    const tog = (key, val, label, desc, extra) =>
        `<div class="switch-row"><div><div class="lbl">${esc(label)}</div>${desc ? `<div class="desc">${esc(desc)}</div>` : ''}</div><label class="switch"><input type="checkbox" data-key="${esc(key)}" ${val ? 'checked' : ''} ${extra || ''}><span class="slide"></span></label></div>`;
    const sel = (key, val, opts) =>
        `<select data-key="${esc(key)}">${opts.map(o => typeof o === 'object'
            ? `<option value="${esc(o.value)}" ${val === o.value ? 'selected' : ''}>${esc(o.label)}</option>`
            : `<option value="${esc(o)}" ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    const vis = (cond) => cond ? '' : 'style="display:none"';

    const ann = w.announcements || {};
    const announceMode = ann.channel || 'same';

    // Level roles editor
    const levelRolesHtml = (w.roles || []).map((r, i) => {
        const role = state.roles.find(x => x.id === r.roleId);
        return `
            <div class="listi" style="display:block;margin-bottom:.4rem">
                <div class="row">
                    <span class="tag">Level ${r.level}</span>
                    <span>→</span>
                    ${role ? `<span style="color:#${(role.color||0).toString(16).padStart(6,'0')};font-weight:600">${esc(role.name)}</span>` : `<span class="text-mute">Deleted role</span>`}
                    <span class="spacer"></span>
                    <button class="btn sm danger" onclick="window.__rmLvRole(${i})">×</button>
                </div>
            </div>`;
    }).join('') || '<div class="text-sm text-mute">No level roles configured.</div>';

    // Role multipliers editor
    const multsHtml = Object.entries(w.roleMultipliers || {}).map(([rid, mult]) => {
        const role = state.roles.find(x => x.id === rid);
        return `
            <div class="listi" style="display:block;margin-bottom:.4rem">
                <div class="row">
                    ${role ? `<span style="color:#${(role.color||0).toString(16).padStart(6,'0')};font-weight:600">${esc(role.name)}</span>` : `<span class="text-mute">Deleted</span>`}
                    <span class="text-mute">→</span>
                    <span class="tag green">${mult}x XP</span>
                    <span class="spacer"></span>
                    <button class="btn sm danger" onclick="window.__rmLvMult('${esc(rid)}')">×</button>
                </div>
            </div>`;
    }).join('') || '<div class="text-sm text-mute">No role multipliers.</div>';

    // Ignore lists: render as chip lists
    const ignChHtml = (w.ignoreChannels || []).map(id => {
        const c = state.channels.find(x => x.id === id);
        return `<span class="chip">#${esc(c?.name || id)} <button onclick="window.__rmIgnCh('${esc(id)}')">×</button></span>`;
    }).join('') || '<span class="text-sm text-mute">None</span>';
    const ignRoHtml = (w.ignoreRoles || []).map(id => {
        const r = state.roles.find(x => x.id === id);
        return `<span class="chip">${esc(r?.name || id)} <button onclick="window.__rmIgnRo('${esc(id)}')">×</button></span>`;
    }).join('') || '<span class="text-sm text-mute">None</span>';
    const disChHtml = (w.disabledChannels || []).map(id => {
        const c = state.channels.find(x => x.id === id);
        return `<span class="chip">#${esc(c?.name || id)} <button onclick="window.__rmDisCh('${esc(id)}')">×</button></span>`;
    }).join('') || '<span class="text-sm text-mute">None</span>';

    // Leaderboard preview (top 10)
    const board = (state.lvBoard || []).slice(0, 10);
    const boardHtml = board.length ? `
        <table class="tbl">
            <thead><tr><th>#</th><th>User ID</th><th>Level</th><th>XP</th><th>Messages</th><th></th></tr></thead>
            <tbody>
                ${board.map((u, i) => `<tr>
                    <td><span class="tag">${i+1}</span></td>
                    <td class="mono text-xs">${esc(u.userId)}</td>
                    <td><b>${u.level}</b></td>
                    <td>${u.xp.toLocaleString()}</td>
                    <td>${(u.messages||0).toLocaleString()}</td>
                    <td class="row" style="gap:.3rem">
                        <button class="btn sm" onclick="window.__setUserLevel('${esc(u.userId)}')" title="Set level">✏</button>
                        <button class="btn sm danger" onclick="window.__resetUserLv('${esc(u.userId)}')" title="Reset">×</button>
                    </td>
                </tr>`).join('')}
            </tbody>
        </table>
    ` : '<div class="empty"><p class="text-sm text-mute">No XP data yet. Members will appear here once they start chatting.</p></div>';

    const html = `
        <div class="page-h">
            <div><h1>Leveling</h1><p>XP system for ${esc(g.name)}. Syncs live to the bot's message handler.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div>
        </div>

        <div id="lv-draft-indicator" class="row mb-2" style="${hasDraft ? '' : 'display:none'}">
            <span class="tag amber">⚠ Unsaved draft</span>
            <span class="text-sm text-mute">Auto-saved locally — won't be lost on refresh.</span>
        </div>

        <!-- ═══ MASTER TOGGLE ═══ -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('trend')}</div><div class="tt"><div class="t">Leveling System</div><div class="s">Reward active members with XP, levels and roles.</div></div></div>
            ${tog('enabled', w.enabled, 'Enable Leveling', 'Turn the leveling system on/off.', 'data-vis="lv-all"')}
        </div>

        <div id="lv-all" ${vis(w.enabled)}>
            <!-- XP Settings -->
            <div class="card mb-2">
                <div class="card-h"><div class="ic">${icon('star')}</div><div class="tt"><div class="t">XP Settings</div><div class="s">How much XP members earn per message.</div></div></div>
                <div class="grid g-3">
                    <div class="form-row"><label>Min XP per message</label><input type="number" data-key="xpSettings.minXp" value="${w.xpSettings.minXp}" min="1" max="1000"></div>
                    <div class="form-row"><label>Max XP per message</label><input type="number" data-key="xpSettings.maxXp" value="${w.xpSettings.maxXp}" min="1" max="1000"></div>
                    <div class="form-row"><label>Cooldown (seconds)</label><input type="number" data-key="xpSettings.cooldown" value="${w.xpSettings.cooldown}" min="1" max="3600"></div>
                </div>
                <div class="form-row"><label>Global XP Multiplier</label><input type="number" step="0.1" data-key="multiplier" value="${w.multiplier}" min="0.1" max="10"><div class="hint">1 = normal, 2 = 2x XP for everyone. Per-role multipliers below override this.</div></div>
            </div>

            <!-- Announcement -->
            <div class="card mb-2">
                <div class="card-h"><div class="ic">${icon('chat')}</div><div class="tt"><div class="t">Level-Up Announcement</div><div class="s">How and where the level-up card is sent.</div></div></div>
                ${tog('announcements.enabled', ann.enabled, 'Enable Announcements', '', 'data-vis="lv-ann-body"')}
                <div id="lv-ann-body" ${vis(ann.enabled)}>
                    <div class="form-row mt-2"><label>Announcement Location</label>${sel('announcements.channel', announceMode, [
                        {value:'same', label:'Same channel as message'},
                        {value:'dm', label:'Direct message'},
                        {value:'custom', label:'Custom channel'}
                    ])}</div>
                    <div class="form-row" id="lv-ann-custom" ${vis(announceMode === 'custom')}>
                        <label>Custom Channel</label>
                        ${chSel('announcements.customChannelId', ann.customChannelId)}
                    </div>
                    <div class="form-row"><label>Fallback Message (used only if canvas fails)</label>
                        <textarea data-key="announcements.message" rows="2" placeholder="GG {user}, you just advanced to **Level {level}**!">${esc(ann.message || '')}</textarea>
                        <div class="hint">Variables: {user}, {level}, {xp}. The bot normally sends a PNG card; this text is only a fallback.</div>
                    </div>
                </div>
            </div>

            <!-- Level Roles -->
            <div class="card mb-2">
                <div class="card-h"><div class="ic">${icon('crown')}</div><div class="tt"><div class="t">Level Roles</div><div class="s">Auto-assign roles at specific levels.</div></div></div>
                ${tog('stackRoles', w.stackRoles, 'Stack Roles', 'On: keep every earned role. Off: keep only the highest.')}
                <hr>
                ${levelRolesHtml}
                <hr>
                <h4 class="mb-1">Add Level Role</h4>
                <div class="grid g-2">
                    <div class="form-row"><label>Level</label><input type="number" id="lv-add-level" min="1" max="1000" value="5"></div>
                    <div class="form-row"><label>Role</label><select id="lv-add-role"><option value="">— Pick —</option>${state.roles.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></div>
                </div>
                <button class="btn sm" onclick="window.__addLvRole()">${icon('user-plus')} Add</button>
            </div>

            <!-- Role Multipliers -->
            <div class="card mb-2">
                <div class="card-h"><div class="ic">${icon('coin')}</div><div class="tt"><div class="t">Role XP Multipliers</div><div class="s">Give specific roles boosted XP (e.g. VIP, Booster).</div></div></div>
                ${multsHtml}
                <hr>
                <h4 class="mb-1">Add Multiplier</h4>
                <div class="grid g-2">
                    <div class="form-row"><label>Role</label><select id="lv-add-mult-role"><option value="">— Pick —</option>${state.roles.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></div>
                    <div class="form-row"><label>Multiplier (0.1 – 10)</label><input type="number" step="0.1" id="lv-add-mult-value" value="1.5" min="0.1" max="10"></div>
                </div>
                <button class="btn sm" onclick="window.__addLvMult()">${icon('user-plus')} Add</button>
            </div>

            <!-- Ignore Lists -->
            <div class="card mb-2">
                <div class="card-h"><div class="ic">${icon('user-x')}</div><div class="tt"><div class="t">Exclusions</div><div class="s">Channels and roles that earn no XP.</div></div></div>
                <h4 class="mb-1">Ignored Channels</h4>
                <div class="chips mb-2" id="lv-ign-ch">${ignChHtml}</div>
                <div class="form-row"><select id="lv-add-ign-ch"><option value="">— Pick channel —</option>${state.channels.filter(c => c.type === 0 || c.type === 5).map(c => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`).join('')}</select></div>
                <button class="btn sm" onclick="window.__addIgnCh()">${icon('user-plus')} Add</button>
                <hr>
                <h4 class="mb-1">Ignored Roles</h4>
                <div class="chips mb-2" id="lv-ign-ro">${ignRoHtml}</div>
                <div class="form-row"><select id="lv-add-ign-ro"><option value="">— Pick role —</option>${state.roles.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></div>
                <button class="btn sm" onclick="window.__addIgnRo()">${icon('user-plus')} Add</button>
                <hr>
                <h4 class="mb-1">Per-Channel Disable</h4>
                <p class="text-sm text-mute mb-2">Alternative to ignoring — disables XP gain but keeps the system on.</p>
                <div class="chips mb-2" id="lv-dis-ch">${disChHtml}</div>
                <div class="form-row"><select id="lv-add-dis-ch"><option value="">— Pick channel —</option>${state.channels.filter(c => c.type === 0 || c.type === 5).map(c => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`).join('')}</select></div>
                <button class="btn sm" onclick="window.__addDisCh()">${icon('user-plus')} Add</button>
            </div>

            <!-- Leaderboard -->
            <div class="card mb-2">
                <div class="card-h"><div class="ic">${icon('chart')}</div><div class="tt"><div class="t">Top Members</div><div class="s">Live XP leaderboard. Click ✏ to set level, × to reset.</div></div></div>
                ${boardHtml}
                <hr>
                <button class="btn danger" onclick="window.__resetAllLv()">${icon('user-x')} Reset All XP for This Server</button>
            </div>
        </div>

        <!-- SAVE -->
        <div class="save-bar">
            <div class="row">
                <span class="tag ${w.enabled ? 'green' : 'grey'}" id="mod-status-tag">${w.enabled ? 'Active' : 'Inactive'}</span>
                <span class="text-sm text-mute">Saves directly to bot. Changes live instantly.</span>
            </div>
            <div class="row">
                <button class="btn" id="lv-reset-btn">${icon('log')} Reset Draft</button>
                <button class="btn primary" id="lv-save-btn">${icon('check')} Save</button>
            </div>
        </div>
    `;

    $('#page').innerHTML = html;

    // Bind all inputs
    bindFormInputs(w);

    // Progressive disclosure
    $$('#page [data-vis]').forEach(inp => {
        inp.addEventListener('change', () => {
            const t = document.getElementById(inp.dataset.vis);
            if (t) t.style.display = inp.checked ? '' : 'none';
        });
    });

    // Announcement mode select → show custom channel picker
    const annSel = document.querySelector('#page select[data-key="announcements.channel"]');
    if (annSel) annSel.addEventListener('change', () => {
        const el = document.getElementById('lv-ann-custom');
        if (el) el.style.display = annSel.value === 'custom' ? '' : 'none';
    });

    // Autosave on every change
    let pt;
    $('#page').addEventListener('input', () => { clearTimeout(pt); pt = setTimeout(_persistLevelingDraft, 250); });
    $('#page').addEventListener('change', () => { clearTimeout(pt); pt = setTimeout(_persistLevelingDraft, 100); });

    // Save / Reset
    $('#lv-reset-btn').onclick = () => {
        if (confirm('Discard your draft and reload saved config?')) {
            try { localStorage.removeItem(window.__lvDraftKey); } catch {}
            handleRoute();
        }
    };
    $('#lv-save-btn').onclick = async () => {
        const btn = $('#lv-save-btn');
        btn.disabled = true; btn.textContent = 'Saving…';
        const r = await api(`/api/guild/${g.id}/leveling`, { method: 'PUT', body: JSON.stringify(w) });
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (!r || r._error || r._unauth) toast(r?.error || 'Save failed', 'error');
        else {
            toast('Leveling saved — live now!', 'success');
            try { localStorage.removeItem(window.__lvDraftKey); } catch {}
            window.__lvSavedSnapshot = JSON.parse(JSON.stringify(w));
            const ind = document.getElementById('lv-draft-indicator');
            if (ind) ind.style.display = 'none';
            $('#mod-status-tag').className = 'tag ' + (w.enabled ? 'green' : 'grey');
            $('#mod-status-tag').textContent = w.enabled ? 'Active' : 'Inactive';
        }
    };
}

// ── Level role handlers ──
window.__addLvRole = () => {
    const level = parseInt($('#lv-add-level').value);
    const roleId = $('#lv-add-role').value;
    if (!Number.isInteger(level) || level < 1) return toast('Level must be ≥ 1', 'error');
    if (!roleId) return toast('Pick a role', 'error');
    const w = window.__working;
    const existing = w.roles.findIndex(r => r.level === level);
    if (existing >= 0) w.roles[existing].roleId = roleId;
    else w.roles.push({ level, roleId });
    w.roles.sort((a, b) => a.level - b.level);
    _persistLevelingDraft();
    _rerenderLevelingKeepScroll();
};
window.__rmLvRole = (idx) => {
    window.__working.roles.splice(idx, 1);
    _persistLevelingDraft();
    _rerenderLevelingKeepScroll();
};

// ── Role multiplier handlers ──
window.__addLvMult = () => {
    const roleId = $('#lv-add-mult-role').value;
    const mult = parseFloat($('#lv-add-mult-value').value);
    if (!roleId) return toast('Pick a role', 'error');
    if (!(mult >= 0.1 && mult <= 10)) return toast('Multiplier must be between 0.1 and 10', 'error');
    if (!window.__working.roleMultipliers) window.__working.roleMultipliers = {};
    window.__working.roleMultipliers[roleId] = mult;
    _persistLevelingDraft();
    _rerenderLevelingKeepScroll();
};
window.__rmLvMult = (roleId) => {
    if (window.__working.roleMultipliers) delete window.__working.roleMultipliers[roleId];
    _persistLevelingDraft();
    _rerenderLevelingKeepScroll();
};

// ── Ignore list handlers ──
window.__addIgnCh = () => {
    const v = $('#lv-add-ign-ch').value;
    if (!v) return;
    if (!window.__working.ignoreChannels.includes(v)) window.__working.ignoreChannels.push(v);
    _persistLevelingDraft();
    _rerenderLevelingKeepScroll();
};
window.__rmIgnCh = (id) => {
    window.__working.ignoreChannels = window.__working.ignoreChannels.filter(x => x !== id);
    _persistLevelingDraft();
    _rerenderLevelingKeepScroll();
};
window.__addIgnRo = () => {
    const v = $('#lv-add-ign-ro').value;
    if (!v) return;
    if (!window.__working.ignoreRoles.includes(v)) window.__working.ignoreRoles.push(v);
    _persistLevelingDraft();
    _rerenderLevelingKeepScroll();
};
window.__rmIgnRo = (id) => {
    window.__working.ignoreRoles = window.__working.ignoreRoles.filter(x => x !== id);
    _persistLevelingDraft();
    _rerenderLevelingKeepScroll();
};
window.__addDisCh = () => {
    const v = $('#lv-add-dis-ch').value;
    if (!v) return;
    if (!window.__working.disabledChannels.includes(v)) window.__working.disabledChannels.push(v);
    _persistLevelingDraft();
    _rerenderLevelingKeepScroll();
};
window.__rmDisCh = (id) => {
    window.__working.disabledChannels = window.__working.disabledChannels.filter(x => x !== id);
    _persistLevelingDraft();
    _rerenderLevelingKeepScroll();
};

// ── User XP actions (immediate API calls, not drafts) ──
window.__setUserLevel = async (userId) => {
    const level = prompt(`Set level for user ${userId}:`, '10');
    if (level === null) return;
    const n = parseInt(level);
    if (!(n >= 0 && n <= 1000)) return toast('Level must be 0–1000', 'error');
    const g = state.currentGuild;
    const r = await api(`/api/guild/${g.id}/leveling/user/${userId}/set-level`, { method: 'POST', body: JSON.stringify({ level: n }) });
    if (r && !r._error) { toast(`User set to level ${n}`, 'success'); pageLeveling(); }
    else toast(r?.error || 'Failed', 'error');
};
window.__resetUserLv = async (userId) => {
    if (!confirm(`Reset XP for user ${userId}?`)) return;
    const g = state.currentGuild;
    const r = await api(`/api/guild/${g.id}/leveling/user/${userId}`, { method: 'DELETE' });
    if (r && !r._error) { toast('User reset', 'success'); pageLeveling(); }
    else toast(r?.error || 'Failed', 'error');
};
window.__resetAllLv = async () => {
    if (!confirm('Wipe ALL XP data for this server? This cannot be undone.')) return;
    const g = state.currentGuild;
    const r = await api(`/api/guild/${g.id}/leveling/reset-all`, { method: 'DELETE' });
    if (r && !r._error) { toast('All XP reset', 'success'); pageLeveling(); }
    else toast(r?.error || 'Failed', 'error');
};
