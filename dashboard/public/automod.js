/* =========================================================
   xNico Dashboard — automod.js
   9 content filters + ignored channels/roles + bypass role.
   Syncs to jsonStore 'automod' read live by bot's message handler.
   ========================================================= */

const AUTOMOD_ACTIONS = [
    { value: 'warn',    label: 'Warn user' },
    { value: 'delete',  label: 'Delete message' },
    { value: 'timeout', label: 'Timeout (5 min)' },
    { value: 'kick',    label: 'Kick user' },
    { value: 'ban',     label: 'Ban user' },
];

async function pageAutomod() {
    const g = state.currentGuild;
    const [cfg, channels, roles] = await Promise.all([
        api(`/api/guild/${g.id}/automod`),
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
    // Safety defaults for arrays
    if (!Array.isArray(w.ignoredRoles))    w.ignoredRoles = [];
    if (!Array.isArray(w.ignoredChannels)) w.ignoredChannels = [];
    if (!w.badWords?.words || !Array.isArray(w.badWords.words)) {
        w.badWords = w.badWords || {};
        w.badWords.words = [];
    }
    if (!w.links?.whitelist || !Array.isArray(w.links.whitelist)) {
        w.links = w.links || {};
        w.links.whitelist = [];
    }

    // Draft recovery
    const draftKey = `draft:automod:${g.id}`;
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
    window.__amSnapshot = JSON.parse(JSON.stringify(cfg));
    window.__amDraftKey = draftKey;
    _renderAutomodBody(g, w, hasDraft);
}

function _persistAmDraft() {
    try {
        if (!window.__amDraftKey || !window.__working) return;
        if (JSON.stringify(window.__working) === JSON.stringify(window.__amSnapshot)) {
            localStorage.removeItem(window.__amDraftKey);
            const i = document.getElementById('am-draft'); if (i) i.style.display = 'none';
        } else {
            localStorage.setItem(window.__amDraftKey, JSON.stringify(window.__working));
            const i = document.getElementById('am-draft'); if (i) i.style.display = '';
        }
    } catch {}
}

function _rerenderAmKeepScroll() {
    const y = window.scrollY;
    const g = state.currentGuild;
    const w = window.__working;
    const hasDraft = window.__amSnapshot && JSON.stringify(w) !== JSON.stringify(window.__amSnapshot);
    _renderAutomodBody(g, w, hasDraft);
    requestAnimationFrame(() => window.scrollTo(0, y));
}

function _renderAutomodBody(g, w, hasDraft) {
    const chSel = (key, val) => {
        const list = state.channels.filter(c => c.type === 0 || c.type === 5);
        return `<select data-key="${esc(key)}"><option value="">— None —</option>${list.map(c => `<option value="${esc(c.id)}" ${val === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select>`;
    };
    const roleSel = (key, val) => `<select data-key="${esc(key)}"><option value="">— None —</option>${state.roles.map(r => `<option value="${esc(r.id)}" ${val === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>`;
    const tog = (key, val, label, desc, extra) =>
        `<div class="switch-row"><div><div class="lbl">${esc(label)}</div>${desc ? `<div class="desc">${esc(desc)}</div>` : ''}</div><label class="switch"><input type="checkbox" data-key="${esc(key)}" ${val ? 'checked' : ''} ${extra || ''}><span class="slide"></span></label></div>`;
    const actSel = (key, val) =>
        `<select data-key="${esc(key)}">${AUTOMOD_ACTIONS.map(a => `<option value="${esc(a.value)}" ${val === a.value ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select>`;
    const vis = (cond) => cond ? '' : 'style="display:none"';

    // Ignored lists
    const ignChHtml = (w.ignoredChannels || []).map(id => {
        const c = state.channels.find(x => x.id === id);
        return `<span class="chip">#${esc(c?.name || id)} <button onclick="window.__amRmIgnCh('${esc(id)}')">×</button></span>`;
    }).join('') || '<span class="text-sm text-mute">None</span>';
    const ignRoHtml = (w.ignoredRoles || []).map(id => {
        const r = state.roles.find(x => x.id === id);
        return `<span class="chip">${esc(r?.name || id)} <button onclick="window.__amRmIgnRo('${esc(id)}')">×</button></span>`;
    }).join('') || '<span class="text-sm text-mute">None</span>';

    // Bad words list
    const bwHtml = (w.badWords?.words || []).map(word => `<span class="chip red">${esc(word)} <button onclick="window.__amRmBadWord('${esc(word.replace(/'/g, "\\'"))}')">×</button></span>`).join('') || '<span class="text-sm text-mute">No words added yet.</span>';

    // Link whitelist
    const linkWlHtml = (w.links?.whitelist || []).map(dom => `<span class="chip green">${esc(dom)} <button onclick="window.__amRmLinkWl('${esc(dom)}')">×</button></span>`).join('') || '<span class="text-sm text-mute">No whitelisted domains — all links blocked.</span>';

    // Active filter count
    const filters = ['badWords','spam','links','invites','massMention','caps','profanity','sexualContent','slurs'];
    const activeFilters = filters.filter(f => w[f]?.enabled).length;

    const html = `
        <div class="page-h">
            <div><h1>AutoMod</h1><p>Content filters for ${esc(g.name)}. ${activeFilters}/${filters.length} filters active.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div>
        </div>

        <div id="am-draft" class="row mb-2" style="${hasDraft?'':'display:none'}">
            <span class="tag amber">⚠ Unsaved draft</span>
            <span class="text-sm text-mute">Auto-saved locally.</span>
        </div>

        <!-- MASTER -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('shield')}</div><div class="tt"><div class="t">Master Switch</div><div class="s">Scan every message against enabled filters.</div></div></div>
            ${tog('enabled', w.enabled, 'Enable AutoMod', 'When off, no filters run.', 'data-vis="am-all"')}
        </div>

        <div id="am-all" ${vis(w.enabled)}>
            <!-- Shared settings -->
            <div class="card mb-2">
                <div class="card-h"><div class="ic">${icon('settings')}</div><div class="tt"><div class="t">Shared Settings</div><div class="s">Log channel, bypass role, global ignore lists.</div></div></div>
                <div class="form-row"><label>Log Channel</label>${chSel('logChannel', w.logChannel)}<div class="hint">Where violations & actions are logged.</div></div>
                <div class="form-row"><label>Bypass Role</label>${roleSel('bypassRoleId', w.bypassRoleId)}<div class="hint">Members with this role skip all filters. Administrators always skip.</div></div>
                <hr>
                <h4 class="mb-1">Ignored Channels</h4>
                <div class="chips mb-2">${ignChHtml}</div>
                <div class="row mb-2">
                    <select id="am-add-ign-ch" style="flex:1"><option value="">— Pick channel —</option>${state.channels.filter(c => c.type === 0 || c.type === 5).map(c => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`).join('')}</select>
                    <button class="btn sm" onclick="window.__amAddIgnCh()">${icon('user-plus')} Add</button>
                </div>
                <hr>
                <h4 class="mb-1">Ignored Roles</h4>
                <div class="chips mb-2">${ignRoHtml}</div>
                <div class="row">
                    <select id="am-add-ign-ro" style="flex:1"><option value="">— Pick role —</option>${state.roles.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>
                    <button class="btn sm" onclick="window.__amAddIgnRo()">${icon('user-plus')} Add</button>
                </div>
            </div>

            <!-- Bad Words Filter -->
            <div class="card mb-2">
                <div class="card-h">
                    <div class="ic" style="background:rgba(239,68,68,.15);color:#f87171">${icon('shield')}</div>
                    <div class="tt"><div class="t">Bad Words Filter</div><div class="s">Block messages containing banned words.</div></div>
                    <label class="switch"><input type="checkbox" data-key="badWords.enabled" ${w.badWords?.enabled?'checked':''} data-vis="am-bw"><span class="slide"></span></label>
                </div>
                <div id="am-bw" ${vis(w.badWords?.enabled)}>
                    <div class="form-row mt-2"><label>Action</label>${actSel('badWords.action', w.badWords?.action || 'delete')}</div>
                    <h4 class="mb-1">Banned Words</h4>
                    <div class="chips mb-2">${bwHtml}</div>
                    <div class="row">
                        <input type="text" id="am-bw-input" placeholder="word or phrase" style="flex:1">
                        <button class="btn sm" onclick="window.__amAddBadWord()">${icon('user-plus')} Add</button>
                    </div>
                    <div class="hint mt-1">Case insensitive. Whole-word matches (so "hell" won't block "hello" unless added as exact).</div>
                </div>
            </div>

            <!-- Spam Filter -->
            <div class="card mb-2">
                <div class="card-h">
                    <div class="ic">${icon('chat')}</div>
                    <div class="tt"><div class="t">Spam Filter</div><div class="s">Detect users sending too many messages too fast.</div></div>
                    <label class="switch"><input type="checkbox" data-key="spam.enabled" ${w.spam?.enabled?'checked':''} data-vis="am-sp"><span class="slide"></span></label>
                </div>
                <div id="am-sp" ${vis(w.spam?.enabled)}>
                    <div class="grid g-3 mt-2">
                        <div class="form-row"><label>Message Limit</label><input type="number" data-key="spam.messageLimit" value="${w.spam?.messageLimit||5}" min="2" max="50"></div>
                        <div class="form-row"><label>Time Window (ms)</label><input type="number" data-key="spam.timeWindow" value="${w.spam?.timeWindow||5000}" min="1000" max="60000" step="500"></div>
                        <div class="form-row"><label>Action</label>${actSel('spam.action', w.spam?.action || 'timeout')}</div>
                    </div>
                </div>
            </div>

            <!-- Links Filter -->
            <div class="card mb-2">
                <div class="card-h">
                    <div class="ic">${icon('link')}</div>
                    <div class="tt"><div class="t">Link Filter</div><div class="s">Block URLs except whitelisted domains.</div></div>
                    <label class="switch"><input type="checkbox" data-key="links.enabled" ${w.links?.enabled?'checked':''} data-vis="am-lk"><span class="slide"></span></label>
                </div>
                <div id="am-lk" ${vis(w.links?.enabled)}>
                    <div class="form-row mt-2"><label>Action</label>${actSel('links.action', w.links?.action || 'delete')}</div>
                    <h4 class="mb-1">Whitelisted Domains</h4>
                    <p class="text-sm text-mute mb-2">If empty, ALL links are blocked. Add a domain to allow it.</p>
                    <div class="chips mb-2">${linkWlHtml}</div>
                    <div class="row">
                        <input type="text" id="am-lk-input" placeholder="example.com" style="flex:1">
                        <button class="btn sm" onclick="window.__amAddLinkWl()">${icon('user-plus')} Add</button>
                    </div>
                </div>
            </div>

            <!-- Invites Filter -->
            <div class="card mb-2">
                <div class="card-h">
                    <div class="ic">${icon('link')}</div>
                    <div class="tt"><div class="t">Discord Invites</div><div class="s">Block discord.gg / invite links.</div></div>
                    <label class="switch"><input type="checkbox" data-key="invites.enabled" ${w.invites?.enabled?'checked':''} data-vis="am-inv"><span class="slide"></span></label>
                </div>
                <div id="am-inv" ${vis(w.invites?.enabled)}>
                    <div class="form-row mt-2"><label>Action</label>${actSel('invites.action', w.invites?.action || 'delete')}</div>
                </div>
            </div>

            <!-- Mass Mention -->
            <div class="card mb-2">
                <div class="card-h">
                    <div class="ic">${icon('user-plus')}</div>
                    <div class="tt"><div class="t">Mass Mention</div><div class="s">Block messages with too many mentions.</div></div>
                    <label class="switch"><input type="checkbox" data-key="massMention.enabled" ${w.massMention?.enabled?'checked':''} data-vis="am-mm"><span class="slide"></span></label>
                </div>
                <div id="am-mm" ${vis(w.massMention?.enabled)}>
                    <div class="grid g-2 mt-2">
                        <div class="form-row"><label>Max Mentions</label><input type="number" data-key="massMention.limit" value="${w.massMention?.limit||5}" min="1" max="50"></div>
                        <div class="form-row"><label>Action</label>${actSel('massMention.action', w.massMention?.action || 'delete')}</div>
                    </div>
                    <div class="hint">Counts user + role mentions + @everyone/@here combined.</div>
                </div>
            </div>

            <!-- Caps Filter -->
            <div class="card mb-2">
                <div class="card-h">
                    <div class="ic">${icon('chat')}</div>
                    <div class="tt"><div class="t">Excessive Caps</div><div class="s">Block messages that are mostly uppercase.</div></div>
                    <label class="switch"><input type="checkbox" data-key="caps.enabled" ${w.caps?.enabled?'checked':''} data-vis="am-cp"><span class="slide"></span></label>
                </div>
                <div id="am-cp" ${vis(w.caps?.enabled)}>
                    <div class="grid g-3 mt-2">
                        <div class="form-row"><label>Caps % Threshold</label><input type="number" data-key="caps.percentage" value="${w.caps?.percentage||70}" min="10" max="100"></div>
                        <div class="form-row"><label>Min Length</label><input type="number" data-key="caps.minLength" value="${w.caps?.minLength||10}" min="3" max="500"></div>
                        <div class="form-row"><label>Action</label>${actSel('caps.action', w.caps?.action || 'delete')}</div>
                    </div>
                    <div class="hint">Only counts letters. A 100-char message with 70%+ caps triggers the filter.</div>
                </div>
            </div>

            <!-- Profanity / Slurs -->
            <div class="card mb-2">
                <div class="card-h">
                    <div class="ic" style="background:rgba(239,68,68,.15);color:#f87171">${icon('shield')}</div>
                    <div class="tt"><div class="t">Built-in Filters</div><div class="s">Pre-configured word lists for common abuse patterns.</div></div>
                </div>
                <div class="form-row">
                    ${tog('profanity.enabled', w.profanity?.enabled, 'Profanity Filter', 'Block common profanity.')}
                    <div class="form-row mt-1" ${vis(w.profanity?.enabled)}><label>Action</label>${actSel('profanity.action', w.profanity?.action || 'delete')}</div>
                </div>
                <hr>
                <div class="form-row">
                    ${tog('sexualContent.enabled', w.sexualContent?.enabled, 'Sexual Content Filter')}
                    <div class="form-row mt-1" ${vis(w.sexualContent?.enabled)}><label>Action</label>${actSel('sexualContent.action', w.sexualContent?.action || 'delete')}</div>
                </div>
                <hr>
                <div class="form-row">
                    ${tog('slurs.enabled', w.slurs?.enabled, 'Slurs Filter', 'Block slurs and hateful terms.')}
                    <div class="form-row mt-1" ${vis(w.slurs?.enabled)}><label>Action</label>${actSel('slurs.action', w.slurs?.action || 'delete')}</div>
                </div>
            </div>
        </div>

        <div class="save-bar">
            <div class="row">
                <span class="tag ${w.enabled?'green':'grey'}" id="mod-status-tag">${w.enabled?'Active':'Inactive'}</span>
                <span class="text-sm text-mute">Filters active on every message instantly after save.</span>
            </div>
            <div class="row">
                <button class="btn" id="am-reset-btn">${icon('log')} Reset Draft</button>
                <button class="btn primary" id="am-save-btn">${icon('check')} Save</button>
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
    $('#page').addEventListener('input', () => { clearTimeout(pt); pt = setTimeout(_persistAmDraft, 250); });
    $('#page').addEventListener('change', () => { clearTimeout(pt); pt = setTimeout(_persistAmDraft, 100); });

    $('#am-reset-btn').onclick = () => {
        if (confirm('Discard draft and reload saved config?')) {
            try { localStorage.removeItem(window.__amDraftKey); } catch {}
            handleRoute();
        }
    };
    $('#am-save-btn').onclick = async () => {
        const btn = $('#am-save-btn');
        btn.disabled = true; btn.textContent = 'Saving…';
        const r = await api(`/api/guild/${g.id}/automod`, { method: 'PUT', body: JSON.stringify(w) });
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (!r || r._error || r._unauth) toast(r?.error || 'Save failed', 'error');
        else {
            toast('AutoMod saved — filters live!', 'success');
            try { localStorage.removeItem(window.__amDraftKey); } catch {}
            window.__amSnapshot = JSON.parse(JSON.stringify(w));
            const i = document.getElementById('am-draft'); if (i) i.style.display = 'none';
            $('#mod-status-tag').className = 'tag ' + (w.enabled ? 'green' : 'grey');
            $('#mod-status-tag').textContent = w.enabled ? 'Active' : 'Inactive';
        }
    };
}

// Bad word handlers
window.__amAddBadWord = () => {
    const inp = $('#am-bw-input');
    const v = (inp.value || '').trim().toLowerCase();
    if (!v) return toast('Enter a word or phrase', 'error');
    if (!window.__working.badWords) window.__working.badWords = { enabled: true, words: [], action: 'delete' };
    if (!window.__working.badWords.words.includes(v)) window.__working.badWords.words.push(v);
    inp.value = '';
    _persistAmDraft();
    _rerenderAmKeepScroll();
};
window.__amRmBadWord = (word) => {
    if (window.__working.badWords?.words) {
        window.__working.badWords.words = window.__working.badWords.words.filter(w => w !== word);
    }
    _persistAmDraft();
    _rerenderAmKeepScroll();
};

// Link whitelist handlers
window.__amAddLinkWl = () => {
    const inp = $('#am-lk-input');
    const v = (inp.value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!v) return toast('Enter a domain (e.g. youtube.com)', 'error');
    if (!window.__working.links) window.__working.links = { enabled: true, action: 'delete', whitelist: [] };
    if (!window.__working.links.whitelist.includes(v)) window.__working.links.whitelist.push(v);
    inp.value = '';
    _persistAmDraft();
    _rerenderAmKeepScroll();
};
window.__amRmLinkWl = (domain) => {
    if (window.__working.links?.whitelist) {
        window.__working.links.whitelist = window.__working.links.whitelist.filter(d => d !== domain);
    }
    _persistAmDraft();
    _rerenderAmKeepScroll();
};

// Ignored lists handlers
window.__amAddIgnCh = () => {
    const v = $('#am-add-ign-ch').value;
    if (!v) return;
    if (!window.__working.ignoredChannels.includes(v)) window.__working.ignoredChannels.push(v);
    _persistAmDraft();
    _rerenderAmKeepScroll();
};
window.__amRmIgnCh = (id) => {
    window.__working.ignoredChannels = window.__working.ignoredChannels.filter(x => x !== id);
    _persistAmDraft();
    _rerenderAmKeepScroll();
};
window.__amAddIgnRo = () => {
    const v = $('#am-add-ign-ro').value;
    if (!v) return;
    if (!window.__working.ignoredRoles.includes(v)) window.__working.ignoredRoles.push(v);
    _persistAmDraft();
    _rerenderAmKeepScroll();
};
window.__amRmIgnRo = (id) => {
    window.__working.ignoredRoles = window.__working.ignoredRoles.filter(x => x !== id);
    _persistAmDraft();
    _rerenderAmKeepScroll();
};
