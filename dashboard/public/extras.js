/* =========================================================
   xNico Dashboard — extras.js
   Page renderers for newly-surfaced bot features:
     • AI Chat
     • Birthdays
     • Applications
     • Warning Thresholds + Warnings Log
     • Status Roles
     • Bot Block
     • Vanity Guard
     • Confessions
     • Ignored Channels
     • Moderation Logs (real bot store)

   Each page reads from /api/guild/:id/<module>-config (or the
   purpose-built endpoint), edits in place, and PUTs back. The
   bot's storeSync listener picks up the jsonStore 'update' event
   and invalidates any in-memory caches the bot owns.
   ========================================================= */

(function () {
    if (typeof window === 'undefined') return;

    // Reuse helpers exposed by app.js. These are global because app.js
    // doesn't ship as an ES module.
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const esc = s => (s == null ? '' : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const icon = name => (window.icon ? window.icon(name) : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`);

    function getApi() {
        // app.js declares api() in module scope, but exposes it via window.api.
        // We fall back to a fetch wrapper so this file works even if app.js
        // hasn't promoted it yet.
        if (typeof window.api === 'function') return window.api;
        return async function api(path, opts = {}) {
            const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
            const tok = localStorage.getItem('token');
            if (tok) headers['Authorization'] = 'Bearer ' + tok;
            try {
                const r = await fetch(path, { credentials: 'include', cache: 'no-store', ...opts, headers });
                const ct = r.headers.get('content-type') || '';
                const data = ct.includes('application/json') ? await r.json() : { _text: await r.text() };
                if (r.status === 401) return { _unauth: true, error: data?.error || 'Unauthorized' };
                if (!r.ok) return { _error: true, status: r.status, ...data };
                return data;
            } catch (e) {
                return { _error: true, error: e.message };
            }
        };
    }
    const api = getApi();
    const toast = (msg, type = 'info') => {
        if (typeof window.toast === 'function') return window.toast(msg, type);
        const c = $('#toasts'); if (!c) return;
        const el = document.createElement('div');
        el.className = 'toast ' + type;
        el.textContent = msg;
        c.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, 2800);
    };

    function gid() { return window.state?.currentGuild?.id; }
    function pageEl() { return $('#page'); }

    // Shared header + save-bar template (matches app.js pageModule UI).
    function header(title, desc, extraTags = '') {
        return `
            <div class="page-h">
                <div>
                    <h1>${esc(title)} ${extraTags}</h1>
                    <p>${esc(desc)}</p>
                </div>
                <div class="row wrap">
                    <a class="btn" href="#/server/${esc(gid())}">${icon('home')} Overview</a>
                </div>
            </div>`;
    }
    function saveBar(enabled, label = 'Save Changes') {
        return `
            <div class="save-bar">
                <div class="row">
                    <span class="tag ${enabled ? 'green' : 'grey'}" id="ext-status-tag">${enabled ? 'Active' : 'Inactive'}</span>
                </div>
                <div class="row">
                    <button class="btn" id="ext-reset">${icon('log')} Reload</button>
                    <button class="btn primary" id="ext-save">${icon('check')} ${esc(label)}</button>
                </div>
            </div>`;
    }
    function loadingScreen() {
        pageEl().innerHTML = `<div style="display:flex;justify-content:center;padding:4rem 0"><div class="spinner"></div></div>`;
    }
    function errorScreen(msg) {
        pageEl().innerHTML = `<div class="empty"><h3>Failed to load</h3><p>${esc(msg)}</p></div>`;
    }
    function loadGuildContext() {
        return Promise.all([
            api(`/api/guild/${gid()}/channels`),
            api(`/api/guild/${gid()}/roles`)
        ]).then(([channels, roles]) => ({
            channels: Array.isArray(channels) ? channels : [],
            roles: Array.isArray(roles) ? roles.filter(r => r.name !== '@everyone') : []
        }));
    }

    function channelOptions(channels, selected, includeNone = true, types = [0, 5]) {
        const filtered = channels.filter(c => types.includes(c.type));
        let opts = includeNone ? '<option value="">— None —</option>' : '';
        for (const c of filtered) {
            opts += `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>#${esc(c.name)}</option>`;
        }
        return opts;
    }
    function roleOptions(roles, selected, includeNone = true) {
        let opts = includeNone ? '<option value="">— None —</option>' : '';
        for (const r of roles.sort((a, b) => (b.position || 0) - (a.position || 0))) {
            opts += `<option value="${esc(r.id)}" ${r.id === selected ? 'selected' : ''}>${esc(r.name)}</option>`;
        }
        return opts;
    }

    // ── AI Chat ──────────────────────────────────────────────────────
    async function pageAiChat() {
        loadingScreen();
        const [cfg, ctx] = await Promise.all([
            api(`/api/guild/${gid()}/aichat-config`),
            loadGuildContext()
        ]);
        if (cfg?._error) return errorScreen(cfg.error);
        const w = { ...cfg };
        const models = [
            { v: 'llama-3.3-70b-versatile', l: 'Llama 3.3 70B Versatile (Best)' },
            { v: 'llama-3.1-70b-versatile', l: 'Llama 3.1 70B Versatile' },
            { v: 'llama-3.1-8b-instant',    l: 'Llama 3.1 8B Instant (Fast)' },
            { v: 'mixtral-8x7b-32768',      l: 'Mixtral 8x7B (32k context)' },
            { v: 'gemma2-9b-it',            l: 'Gemma 2 9B' }
        ];
        pageEl().innerHTML = `
            ${header('AI Chat', 'Conversational AI in a dedicated channel.')}
            <div class="card">
                <div class="form-grid">
                    <label class="field"><span>Enabled</span>
                        <label class="toggle"><input type="checkbox" id="ai-en" ${w.enabled ? 'checked' : ''}><span class="slider"></span></label>
                    </label>
                    <label class="field"><span>Channel</span>
                        <select id="ai-ch">${channelOptions(ctx.channels, w.channelId)}</select>
                    </label>
                    <label class="field"><span>Model</span>
                        <select id="ai-model">${models.map(m => `<option value="${m.v}" ${m.v === w.model ? 'selected' : ''}>${esc(m.l)}</option>`).join('')}</select>
                    </label>
                    <label class="field"><span>Temperature (${w.temperature.toFixed(2)})</span>
                        <input id="ai-temp" type="range" min="0" max="2" step="0.05" value="${w.temperature}">
                    </label>
                    <label class="field"><span>Max Tokens</span>
                        <input id="ai-maxtok" type="number" min="64" max="4096" value="${w.maxTokens}">
                    </label>
                </div>
                <label class="field mt-2"><span>System Prompt (optional — leave blank for the default smart prompt)</span>
                    <textarea id="ai-prompt" rows="6" maxlength="4000" placeholder="Describe how the AI should respond...">${esc(w.systemPrompt || '')}</textarea>
                </label>
            </div>
            ${saveBar(w.enabled)}
        `;
        $('#ai-temp').addEventListener('input', e => {
            e.target.previousElementSibling.textContent = `Temperature (${Number(e.target.value).toFixed(2)})`;
        });
        $('#ext-reset').onclick = () => location.reload();
        $('#ext-save').onclick = async () => {
            const btn = $('#ext-save'); btn.disabled = true;
            const body = {
                enabled: $('#ai-en').checked,
                channelId: $('#ai-ch').value || null,
                model: $('#ai-model').value,
                temperature: Number($('#ai-temp').value),
                maxTokens: Number($('#ai-maxtok').value),
                systemPrompt: $('#ai-prompt').value
            };
            const r = await api(`/api/guild/${gid()}/aichat-config`, { method: 'PUT', body: JSON.stringify(body) });
            btn.disabled = false;
            if (r?._error) return toast(r.error || 'Save failed', 'error');
            toast('AI Chat saved', 'success');
            $('#ext-status-tag').className = 'tag ' + (body.enabled ? 'green' : 'grey');
            $('#ext-status-tag').textContent = body.enabled ? 'Active' : 'Inactive';
        };
    }

    // ── Birthdays ────────────────────────────────────────────────────
    async function pageBirthdays() {
        loadingScreen();
        const [cfg, ctx] = await Promise.all([
            api(`/api/guild/${gid()}/birthdays-config`),
            loadGuildContext()
        ]);
        if (cfg?._error) return errorScreen(cfg.error);
        const w = { ...cfg };
        const pingModes = [
            { v: 'user', l: 'User only' },
            { v: 'role', l: 'Birthday role' },
            { v: 'here', l: '@here' },
            { v: 'everyone', l: '@everyone' },
            { v: 'none', l: 'No ping (silent)' }
        ];
        const types = [
            { v: 'simple', l: 'Simple text' },
            { v: 'embed', l: 'Embed' },
            { v: 'components', l: 'Components V2 card' }
        ];
        const hours = Array.from({ length: 24 }, (_, i) => i);

        pageEl().innerHTML = `
            ${header('Birthdays', 'Auto-celebrate member birthdays at a configurable hour.')}
            <div class="card">
                <div class="form-grid">
                    <label class="field"><span>Enabled</span>
                        <label class="toggle"><input type="checkbox" id="bd-en" ${w.enabled ? 'checked' : ''}><span class="slider"></span></label>
                    </label>
                    <label class="field"><span>Announcement Channel</span>
                        <select id="bd-ch">${channelOptions(ctx.channels, w.channelId)}</select>
                    </label>
                    <label class="field"><span>Birthday Role (optional)</span>
                        <select id="bd-role">${roleOptions(ctx.roles, w.roleId)}</select>
                    </label>
                    <label class="field"><span>Ping Mode</span>
                        <select id="bd-ping">${pingModes.map(p => `<option value="${p.v}" ${p.v === w.pingMode ? 'selected' : ''}>${esc(p.l)}</option>`).join('')}</select>
                    </label>
                    <label class="field"><span>Send Hour (UTC)</span>
                        <select id="bd-hour">${hours.map(h => `<option value="${h}" ${h === w.hour ? 'selected' : ''}>${h.toString().padStart(2, '0')}:00 UTC</option>`).join('')}</select>
                    </label>
                    <label class="field"><span>Message Style</span>
                        <select id="bd-style">${types.map(t => `<option value="${t.v}" ${t.v === w.messageType ? 'selected' : ''}>${esc(t.l)}</option>`).join('')}</select>
                    </label>
                </div>
                <p class="text-mute mt-2">Saved birthdays: <b>${w.userCount}</b>. Members can register their date with <code>/birthday set</code> on Discord.</p>
            </div>
            ${saveBar(w.enabled)}
        `;
        $('#ext-reset').onclick = () => location.reload();
        $('#ext-save').onclick = async () => {
            const btn = $('#ext-save'); btn.disabled = true;
            const body = {
                enabled: $('#bd-en').checked,
                channelId: $('#bd-ch').value || null,
                roleId: $('#bd-role').value || null,
                pingMode: $('#bd-ping').value,
                messageType: $('#bd-style').value,
                hour: Number($('#bd-hour').value)
            };
            const r = await api(`/api/guild/${gid()}/birthdays-config`, { method: 'PUT', body: JSON.stringify(body) });
            btn.disabled = false;
            if (r?._error) return toast(r.error || 'Save failed', 'error');
            toast('Birthdays saved', 'success');
            $('#ext-status-tag').className = 'tag ' + (body.enabled ? 'green' : 'grey');
            $('#ext-status-tag').textContent = body.enabled ? 'Active' : 'Inactive';
        };
    }

    // ── Applications ─────────────────────────────────────────────────
    async function pageApplications() {
        loadingScreen();
        const [cfg, ctx, responses] = await Promise.all([
            api(`/api/guild/${gid()}/applications-config`),
            loadGuildContext(),
            api(`/api/guild/${gid()}/applications-responses`)
        ]);
        if (cfg?._error) return errorScreen(cfg.error);
        const w = { ...cfg };
        const responsesList = Array.isArray(responses) ? responses : [];

        function renderQuestionsList() {
            return (w.questions || []).map((q, i) => `
                <div class="row" style="gap:.5rem;align-items:center">
                    <span class="text-mute">${i + 1}.</span>
                    <input class="grow" data-q="${i}" value="${esc(q)}" maxlength="256">
                    <button class="btn icon-btn" data-rmq="${i}" title="Remove">${icon('user-x')}</button>
                </div>`).join('');
        }

        function render() {
            const counts = w.responses || { pending: 0, accepted: 0, denied: 0 };
            pageEl().innerHTML = `
                ${header('Applications', 'Custom application forms for staff, members, or anything else.')}
                <div class="grid g-4 mb-3">
                    <div class="stat amber"><div class="ic">${icon('log')}</div><div><div class="v">${counts.pending}</div><div class="l">Pending</div></div></div>
                    <div class="stat green"><div class="ic">${icon('check')}</div><div><div class="v">${counts.accepted}</div><div class="l">Accepted</div></div></div>
                    <div class="stat purple"><div class="ic">${icon('user-x')}</div><div><div class="v">${counts.denied}</div><div class="l">Denied</div></div></div>
                    <div class="stat cyan"><div class="ic">${icon('chart')}</div><div><div class="v">${(counts.total || 0)}</div><div class="l">Total</div></div></div>
                </div>
                <div class="card">
                    <div class="form-grid">
                        <label class="field"><span>Enabled</span>
                            <label class="toggle"><input type="checkbox" id="ap-en" ${w.enabled ? 'checked' : ''}><span class="slider"></span></label>
                        </label>
                        <label class="field"><span>Form Name</span>
                            <input id="ap-name" value="${esc(w.name)}" maxlength="80">
                        </label>
                        <label class="field"><span>Review Channel</span>
                            <select id="ap-rev">${channelOptions(ctx.channels, w.reviewChannel)}</select>
                        </label>
                        <label class="field"><span>Log Channel</span>
                            <select id="ap-log">${channelOptions(ctx.channels, w.logChannel)}</select>
                        </label>
                        <label class="field"><span>Accept Role</span>
                            <select id="ap-arole">${roleOptions(ctx.roles, w.acceptRole)}</select>
                        </label>
                        <label class="field"><span>Required Role (to apply)</span>
                            <select id="ap-rrole">${roleOptions(ctx.roles, w.requireRole)}</select>
                        </label>
                    </div>
                    <label class="field mt-2"><span>Description</span><textarea id="ap-desc" rows="2" maxlength="500">${esc(w.description)}</textarea></label>
                    <label class="field"><span>Accept Message (DM to applicant)</span><textarea id="ap-accm" rows="2" maxlength="1000">${esc(w.acceptMessage)}</textarea></label>
                    <label class="field"><span>Deny Message (DM to applicant)</span><textarea id="ap-denym" rows="2" maxlength="1000">${esc(w.denyMessage)}</textarea></label>
                </div>
                <div class="card mt-2">
                    <div class="card-h"><div class="ic">${icon('chat')}</div><div class="tt"><div class="t">Questions</div><div class="s">${(w.questions || []).length} of 20</div></div></div>
                    <div id="ap-q-list" class="col gap-1">${renderQuestionsList()}</div>
                    <button class="btn mt-2" id="ap-add-q">${icon('user-plus')} Add Question</button>
                </div>
                <div class="card mt-2">
                    <div class="card-h"><div class="ic">${icon('log')}</div><div class="tt"><div class="t">Recent Responses</div><div class="s">${responsesList.length} on record</div></div></div>
                    ${responsesList.length ? `<table class="tbl">
                        <thead><tr><th>User</th><th>Status</th><th>Submitted</th></tr></thead>
                        <tbody>${responsesList.slice(0, 20).map(r => `
                            <tr>
                                <td class="mono">${esc(r.userId)}</td>
                                <td><span class="tag ${r.status === 'accepted' ? 'green' : r.status === 'denied' ? 'red' : 'amber'}">${esc(r.status)}</span></td>
                                <td>${r.submittedAt ? new Date(r.submittedAt).toLocaleString() : '—'}</td>
                            </tr>`).join('')}</tbody>
                    </table>` : '<div class="empty"><p>No responses yet.</p></div>'}
                </div>
                ${saveBar(w.enabled)}
            `;
            $('#ap-add-q').onclick = () => { if ((w.questions || []).length >= 20) return toast('Max 20 questions', 'error'); w.questions = [...(w.questions || []), '']; render(); };
            pageEl().addEventListener('click', e => {
                const idx = e.target.closest('[data-rmq]')?.dataset.rmq;
                if (idx != null) { w.questions.splice(Number(idx), 1); render(); }
            });
            pageEl().addEventListener('input', e => {
                const qi = e.target.dataset.q;
                if (qi != null) w.questions[Number(qi)] = e.target.value;
            });
            $('#ext-reset').onclick = () => location.reload();
            $('#ext-save').onclick = async () => {
                const btn = $('#ext-save'); btn.disabled = true;
                const body = {
                    enabled: $('#ap-en').checked,
                    name: $('#ap-name').value.trim(),
                    description: $('#ap-desc').value,
                    reviewChannel: $('#ap-rev').value || null,
                    logChannel: $('#ap-log').value || null,
                    acceptRole: $('#ap-arole').value || null,
                    requireRole: $('#ap-rrole').value || null,
                    acceptMessage: $('#ap-accm').value,
                    denyMessage: $('#ap-denym').value,
                    questions: (w.questions || []).filter(q => q && q.trim()).map(q => q.trim())
                };
                const r = await api(`/api/guild/${gid()}/applications-config`, { method: 'PUT', body: JSON.stringify(body) });
                btn.disabled = false;
                if (r?._error) return toast(r.error || 'Save failed', 'error');
                toast('Applications saved', 'success');
                $('#ext-status-tag').className = 'tag ' + (body.enabled ? 'green' : 'grey');
                $('#ext-status-tag').textContent = body.enabled ? 'Active' : 'Inactive';
            };
        }
        render();
    }

    // ── Warning Thresholds ───────────────────────────────────────────
    async function pageWarnConfig() {
        loadingScreen();
        const cfg = await api(`/api/guild/${gid()}/warn-config`);
        if (cfg?._error) return errorScreen(cfg.error);
        const w = { thresholds: [...(cfg.thresholds || [])] };
        const ACTIONS = ['none', 'timeout', 'kick', 'ban'];
        function render() {
            pageEl().innerHTML = `
                ${header('Warning Thresholds', 'Configure punishment escalation per warn count.')}
                <div class="card">
                    <table class="tbl">
                        <thead><tr><th>Warns</th><th>Action</th><th>Duration (sec, timeout only)</th><th></th></tr></thead>
                        <tbody>${w.thresholds.map((t, i) => `
                            <tr>
                                <td><input type="number" min="1" max="20" value="${t.warns}" data-w="${i}" style="width:70px"></td>
                                <td><select data-a="${i}">${ACTIONS.map(a => `<option value="${a}" ${a === t.action ? 'selected' : ''}>${a}</option>`).join('')}</select></td>
                                <td><input type="number" min="60" max="2419200" value="${t.duration || ''}" data-d="${i}" style="width:120px" ${t.action === 'timeout' ? '' : 'disabled'}></td>
                                <td><button class="btn" data-rm="${i}">${icon('user-x')}</button></td>
                            </tr>`).join('')}</tbody>
                    </table>
                    <button class="btn mt-2" id="wc-add">${icon('user-plus')} Add Threshold</button>
                    <p class="text-mute mt-2">Actions: <b>none</b> = warning only · <b>timeout</b> = mute for duration · <b>kick</b> · <b>ban</b>.</p>
                </div>
                ${saveBar(true, 'Save Thresholds')}
            `;
            $('#wc-add').onclick = () => { w.thresholds.push({ warns: w.thresholds.length + 1, action: 'none', duration: null }); render(); };
            pageEl().addEventListener('click', e => {
                const rm = e.target.closest('[data-rm]')?.dataset.rm;
                if (rm != null) { w.thresholds.splice(Number(rm), 1); render(); }
            });
            pageEl().addEventListener('change', e => {
                const wi = e.target.dataset.w, ai = e.target.dataset.a, di = e.target.dataset.d;
                if (wi != null) w.thresholds[Number(wi)].warns = Number(e.target.value) || 1;
                if (ai != null) { w.thresholds[Number(ai)].action = e.target.value; render(); }
                if (di != null) w.thresholds[Number(di)].duration = Number(e.target.value) || null;
            });
            $('#ext-reset').onclick = () => location.reload();
            $('#ext-save').onclick = async () => {
                const btn = $('#ext-save'); btn.disabled = true;
                const r = await api(`/api/guild/${gid()}/warn-config`, { method: 'PUT', body: JSON.stringify({ thresholds: w.thresholds }) });
                btn.disabled = false;
                if (r?._error) return toast(r.error || 'Save failed', 'error');
                toast('Thresholds saved', 'success');
            };
        }
        render();
    }

    // ── Warnings Log ─────────────────────────────────────────────────
    async function pageWarningsLog() {
        loadingScreen();
        const data = await api(`/api/guild/${gid()}/warnings-list`);
        if (data?._error) return errorScreen(data.error);
        const list = data.warnings || [];
        pageEl().innerHTML = `
            ${header('Warnings Log', `${data.total || 0} warnings on record. Use Discord's /warn to add new ones.`)}
            <div class="card">
                ${list.length ? `<table class="tbl">
                    <thead><tr><th>User</th><th>Reason</th><th>Moderator</th><th>When</th><th></th></tr></thead>
                    <tbody>${list.map(w => `
                        <tr>
                            <td class="mono">${esc(w.userId)}</td>
                            <td>${esc(w.reason)}</td>
                            <td class="mono">${esc(w.moderatorId || '')}</td>
                            <td>${w.timestamp ? new Date(w.timestamp).toLocaleString() : '—'}</td>
                            <td>${w.id ? `<button class="btn" data-rm="${esc(w.userId)}|${esc(w.id)}">${icon('user-x')}</button>` : ''}</td>
                        </tr>`).join('')}</tbody>
                </table>` : '<div class="empty"><p>No warnings on record.</p></div>'}
            </div>
        `;
        pageEl().addEventListener('click', async e => {
            const v = e.target.closest('[data-rm]')?.dataset.rm;
            if (!v) return;
            if (!confirm('Remove this warning?')) return;
            const [userId, warnId] = v.split('|');
            const r = await api(`/api/guild/${gid()}/warnings-list/${userId}/${warnId}`, { method: 'DELETE' });
            if (r?._error) return toast(r.error || 'Failed', 'error');
            toast('Warning removed', 'success');
            pageWarningsLog();
        });
    }

    // ── Status Roles ─────────────────────────────────────────────────
    async function pageStatusRole() {
        loadingScreen();
        const [cfg, ctx] = await Promise.all([
            api(`/api/guild/${gid()}/statusrole-config`),
            loadGuildContext()
        ]);
        if (cfg?._error) return errorScreen(cfg.error);
        const w = { enabled: cfg.enabled !== false, entries: [...(cfg.entries || [])] };

        function render() {
            pageEl().innerHTML = `
                ${header('Status Roles', 'Auto-assign a role when a member sets a matching custom status.')}
                <div class="card">
                    <label class="field"><span>System Active</span>
                        <label class="toggle"><input type="checkbox" id="sr-en" ${w.enabled ? 'checked' : ''}><span class="slider"></span></label>
                    </label>
                    <table class="tbl mt-2">
                        <thead><tr><th>Status Text Contains</th><th>Role</th><th></th></tr></thead>
                        <tbody>${w.entries.map((e, i) => `
                            <tr>
                                <td><input data-t="${i}" value="${esc(e.text)}" placeholder=".gg/server" maxlength="128"></td>
                                <td><select data-r="${i}">${roleOptions(ctx.roles, e.roleId, false)}</select></td>
                                <td><button class="btn" data-rm="${i}">${icon('user-x')}</button></td>
                            </tr>`).join('')}</tbody>
                    </table>
                    <button class="btn mt-2" id="sr-add">${icon('user-plus')} Add Rule</button>
                    <p class="text-mute mt-2">Match is case-insensitive substring. Up to 25 rules.</p>
                </div>
                ${saveBar(w.enabled)}
            `;
            $('#sr-add').onclick = () => { if (w.entries.length >= 25) return toast('Max 25 rules', 'error'); w.entries.push({ text: '', roleId: ctx.roles[0]?.id || '' }); render(); };
            pageEl().addEventListener('click', e => {
                const rm = e.target.closest('[data-rm]')?.dataset.rm;
                if (rm != null) { w.entries.splice(Number(rm), 1); render(); }
            });
            pageEl().addEventListener('input', e => {
                const ti = e.target.dataset.t, ri = e.target.dataset.r;
                if (ti != null) w.entries[Number(ti)].text = e.target.value;
                if (ri != null) w.entries[Number(ri)].roleId = e.target.value;
            });
            $('#ext-reset').onclick = () => location.reload();
            $('#ext-save').onclick = async () => {
                const btn = $('#ext-save'); btn.disabled = true;
                const body = {
                    enabled: $('#sr-en').checked,
                    entries: w.entries.filter(e => e.text && e.roleId)
                };
                const r = await api(`/api/guild/${gid()}/statusrole-config`, { method: 'PUT', body: JSON.stringify(body) });
                btn.disabled = false;
                if (r?._error) return toast(r.error || 'Save failed', 'error');
                toast('Status roles saved', 'success');
            };
        }
        render();
    }

    // ── Bot Block ────────────────────────────────────────────────────
    async function pageBotBlock() {
        loadingScreen();
        const [cfg, ctx] = await Promise.all([
            api(`/api/guild/${gid()}/botblock-config`),
            loadGuildContext()
        ]);
        if (cfg?._error) return errorScreen(cfg.error);
        const w = { enabled: cfg.enabled !== false, channels: [...(cfg.channels || [])] };

        function render() {
            pageEl().innerHTML = `
                ${header('Bot Block', 'Auto-delete bot messages in selected channels.')}
                <div class="card">
                    <label class="field"><span>System Enabled</span>
                        <label class="toggle"><input type="checkbox" id="bb-en" ${w.enabled ? 'checked' : ''}><span class="slider"></span></label>
                    </label>
                    <label class="field mt-2"><span>Add Channel</span>
                        <select id="bb-add">
                            <option value="">— Select a channel —</option>
                            ${ctx.channels.filter(c => [0, 5].includes(c.type) && !w.channels.includes(c.id)).map(c => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`).join('')}
                        </select>
                    </label>
                    <h4 class="mt-3">Blocked Channels (${w.channels.length})</h4>
                    <div class="row wrap mt-2">${w.channels.map(id => {
                        const c = ctx.channels.find(x => x.id === id);
                        return `<span class="tag">#${esc(c?.name || id)} <button class="lk" data-rm="${esc(id)}">×</button></span>`;
                    }).join('') || '<span class="text-mute">None.</span>'}</div>
                </div>
                ${saveBar(w.enabled)}
            `;
            $('#bb-add').onchange = (e) => { if (e.target.value) { w.channels.push(e.target.value); render(); } };
            pageEl().addEventListener('click', e => {
                const rm = e.target.closest('[data-rm]')?.dataset.rm;
                if (rm) { w.channels = w.channels.filter(c => c !== rm); render(); }
            });
            $('#ext-reset').onclick = () => location.reload();
            $('#ext-save').onclick = async () => {
                const btn = $('#ext-save'); btn.disabled = true;
                const body = { enabled: $('#bb-en').checked, channels: w.channels };
                const r = await api(`/api/guild/${gid()}/botblock-config`, { method: 'PUT', body: JSON.stringify(body) });
                btn.disabled = false;
                if (r?._error) return toast(r.error || 'Save failed', 'error');
                toast('Bot Block saved', 'success');
            };
        }
        render();
    }

    // ── Vanity Guard ─────────────────────────────────────────────────
    async function pageVanityGuard() {
        loadingScreen();
        const [cfg, ctx] = await Promise.all([
            api(`/api/guild/${gid()}/vanityguard-config`),
            loadGuildContext()
        ]);
        if (cfg?._error) return errorScreen(cfg.error);
        const w = { ...cfg, whitelistedUsers: [...(cfg.whitelistedUsers || [])] };
        function render() {
            pageEl().innerHTML = `
                ${header('Vanity Guard', 'Protect your vanity URL from unauthorized changes.', '<span class="tag amber">Boost L3 required</span>')}
                <div class="card">
                    <div class="form-grid">
                        <label class="field"><span>Enabled</span>
                            <label class="toggle"><input type="checkbox" id="vg-en" ${w.enabled ? 'checked' : ''}><span class="slider"></span></label>
                        </label>
                        <label class="field"><span>Action on Violation</span>
                            <select id="vg-act">
                                <option value="none" ${w.action === 'none' ? 'selected' : ''}>Revert only</option>
                                <option value="kick" ${w.action === 'kick' ? 'selected' : ''}>Revert + Kick</option>
                                <option value="ban"  ${w.action === 'ban'  ? 'selected' : ''}>Revert + Ban</option>
                            </select>
                        </label>
                        <label class="field"><span>Log Channel</span>
                            <select id="vg-log">${channelOptions(ctx.channels, w.logChannelId)}</select>
                        </label>
                    </div>
                    <h4 class="mt-3">Whitelisted Users (${w.whitelistedUsers.length})</h4>
                    <p class="text-mute">User IDs allowed to change the vanity. Add IDs one at a time.</p>
                    <div class="row gap-1 mt-2">
                        <input id="vg-uid" placeholder="User ID" style="flex:1" maxlength="22">
                        <button class="btn" id="vg-add">${icon('user-plus')} Add</button>
                    </div>
                    <div class="row wrap mt-2">${w.whitelistedUsers.map(id => `<span class="tag mono">${esc(id)} <button class="lk" data-rm="${esc(id)}">×</button></span>`).join('') || '<span class="text-mute">None.</span>'}</div>
                </div>
                ${saveBar(w.enabled)}
            `;
            $('#vg-add').onclick = () => {
                const v = $('#vg-uid').value.trim();
                if (!/^\d{15,22}$/.test(v)) return toast('Invalid user ID', 'error');
                if (w.whitelistedUsers.includes(v)) return;
                w.whitelistedUsers.push(v); render();
            };
            pageEl().addEventListener('click', e => {
                const rm = e.target.closest('[data-rm]')?.dataset.rm;
                if (rm) { w.whitelistedUsers = w.whitelistedUsers.filter(u => u !== rm); render(); }
            });
            $('#ext-reset').onclick = () => location.reload();
            $('#ext-save').onclick = async () => {
                const btn = $('#ext-save'); btn.disabled = true;
                const body = {
                    enabled: $('#vg-en').checked,
                    action: $('#vg-act').value,
                    logChannelId: $('#vg-log').value || null,
                    whitelistedUsers: w.whitelistedUsers
                };
                const r = await api(`/api/guild/${gid()}/vanityguard-config`, { method: 'PUT', body: JSON.stringify(body) });
                btn.disabled = false;
                if (r?._error) return toast(r.error || 'Save failed', 'error');
                toast('Vanity Guard saved', 'success');
            };
        }
        render();
    }

    // ── Confessions ──────────────────────────────────────────────────
    async function pageConfessions() {
        loadingScreen();
        const [cfg, ctx] = await Promise.all([
            api(`/api/guild/${gid()}/confessions-config`),
            loadGuildContext()
        ]);
        if (cfg?._error) return errorScreen(cfg.error);
        const w = { ...cfg };
        pageEl().innerHTML = `
            ${header('Confessions', 'Anonymous confession channel with moderation controls.')}
            <div class="card">
                <div class="form-grid">
                    <label class="field"><span>Confession Channel</span>
                        <select id="cf-ch">${channelOptions(ctx.channels, w.channelId)}</select>
                    </label>
                    <label class="field"><span>Staff Log Channel</span>
                        <select id="cf-log">${channelOptions(ctx.channels, w.logChannelId)}</select>
                    </label>
                    <label class="field"><span>Allow Anonymous</span>
                        <label class="toggle"><input type="checkbox" id="cf-an" ${w.allowAnonymous ? 'checked' : ''}><span class="slider"></span></label>
                    </label>
                    <label class="field"><span>Allow Public</span>
                        <label class="toggle"><input type="checkbox" id="cf-pub" ${w.allowPublic ? 'checked' : ''}><span class="slider"></span></label>
                    </label>
                    <label class="field"><span>Allow Replies</span>
                        <label class="toggle"><input type="checkbox" id="cf-rep" ${w.allowReplies ? 'checked' : ''}><span class="slider"></span></label>
                    </label>
                    <label class="field"><span>Allow Reports</span>
                        <label class="toggle"><input type="checkbox" id="cf-rpt" ${w.allowReports ? 'checked' : ''}><span class="slider"></span></label>
                    </label>
                </div>
                <p class="text-mute mt-2">Total confessions logged: <b>${w.count || 0}</b>. Banned users: <b>${(w.bannedUsers || []).length}</b>. Blocked words: <b>${(w.blockedWords || []).length}</b>.</p>
            </div>
            ${saveBar(!!w.channelId)}
        `;
        $('#ext-reset').onclick = () => location.reload();
        $('#ext-save').onclick = async () => {
            const btn = $('#ext-save'); btn.disabled = true;
            const body = {
                channelId: $('#cf-ch').value || null,
                logChannelId: $('#cf-log').value || null,
                allowAnonymous: $('#cf-an').checked,
                allowPublic: $('#cf-pub').checked,
                allowReplies: $('#cf-rep').checked,
                allowReports: $('#cf-rpt').checked
            };
            const r = await api(`/api/guild/${gid()}/confessions-config`, { method: 'PUT', body: JSON.stringify(body) });
            btn.disabled = false;
            if (r?._error) return toast(r.error || 'Save failed', 'error');
            toast('Confessions saved', 'success');
        };
    }

    // ── Ignored Channels ─────────────────────────────────────────────
    async function pageIgnoredChannels() {
        loadingScreen();
        const [cfg, ctx] = await Promise.all([
            api(`/api/guild/${gid()}/ignored-channels-config`),
            loadGuildContext()
        ]);
        if (cfg?._error) return errorScreen(cfg.error);
        const w = { channels: [...(cfg.channels || [])] };
        function render() {
            pageEl().innerHTML = `
                ${header('Ignored Channels', 'Channels excluded from leveling, logging, and most automod scans.')}
                <div class="card">
                    <label class="field"><span>Add Channel</span>
                        <select id="ic-add">
                            <option value="">— Select —</option>
                            ${ctx.channels.filter(c => [0, 5, 11, 12].includes(c.type) && !w.channels.includes(c.id)).map(c => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`).join('')}
                        </select>
                    </label>
                    <h4 class="mt-3">Currently Ignored (${w.channels.length})</h4>
                    <div class="row wrap mt-2">${w.channels.map(id => {
                        const c = ctx.channels.find(x => x.id === id);
                        return `<span class="tag">#${esc(c?.name || id)} <button class="lk" data-rm="${esc(id)}">×</button></span>`;
                    }).join('') || '<span class="text-mute">None.</span>'}</div>
                </div>
                ${saveBar(true, 'Save')}
            `;
            $('#ic-add').onchange = (e) => { if (e.target.value) { w.channels.push(e.target.value); render(); } };
            pageEl().addEventListener('click', e => {
                const rm = e.target.closest('[data-rm]')?.dataset.rm;
                if (rm) { w.channels = w.channels.filter(c => c !== rm); render(); }
            });
            $('#ext-reset').onclick = () => location.reload();
            $('#ext-save').onclick = async () => {
                const r = await api(`/api/guild/${gid()}/ignored-channels-config`, { method: 'PUT', body: JSON.stringify({ channels: w.channels }) });
                if (r?._error) return toast(r.error || 'Save failed', 'error');
                toast('Ignored channels saved', 'success');
            };
        }
        render();
    }

    // ── Mod Logs (real bot data) ─────────────────────────────────────
    async function pageModLogs() {
        loadingScreen();
        const data = await api(`/api/modlogs?guildId=${encodeURIComponent(gid())}`);
        if (data?._error) return errorScreen(data.error);
        const list = Array.isArray(data) ? data : [];
        pageEl().innerHTML = `
            ${header('Moderation Logs', `${list.length} cases logged by /warn, /ban, /kick, /timeout.`)}
            <div class="card">
                ${list.length ? `<table class="tbl">
                    <thead><tr><th>#</th><th>Action</th><th>User</th><th>Moderator</th><th>Reason</th><th>When</th></tr></thead>
                    <tbody>${list.slice(0, 200).map(l => `
                        <tr>
                            <td class="mono">${l.caseId || l.id}</td>
                            <td><span class="tag ${l.type === 'ban' ? 'red' : l.type === 'warn' ? 'amber' : 'grey'}">${esc(l.type)}</span></td>
                            <td class="mono">${esc(l.userId)}</td>
                            <td>${esc(l.moderator || l.moderatorId || '—')}</td>
                            <td>${esc(l.reason || '')}</td>
                            <td>${new Date(l.timestamp).toLocaleString()}</td>
                        </tr>`).join('')}</tbody>
                </table>` : '<div class="empty"><p>No moderation cases on record yet.</p></div>'}
            </div>
        `;
    }

    // Expose to router
    window.pageAiChat = pageAiChat;
    window.pageBirthdays = pageBirthdays;
    window.pageApplications = pageApplications;
    window.pageWarnConfig = pageWarnConfig;
    window.pageWarningsLog = pageWarningsLog;
    window.pageStatusRole = pageStatusRole;
    window.pageBotBlock = pageBotBlock;
    window.pageVanityGuard = pageVanityGuard;
    window.pageConfessions = pageConfessions;
    window.pageIgnoredChannels = pageIgnoredChannels;
    window.pageModLogs = pageModLogs;
})();
