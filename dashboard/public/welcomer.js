/* =========================================================
   xNico Dashboard — welcomer.js
   Dedicated welcomer page with progressive disclosure.
   Sections only appear when their parent toggle is enabled.
   Mode-specific fields show only for the selected mode.
   ========================================================= */

// Global Welcomer event handlers
window.__saveWelcomer = async function() {
    try {
        const g = state.currentGuild;
        const payload = window.__working || {};
        toast('Saving Welcomer config...', 'info');
        const res = await api(`/api/guild/${g.id}/welcomer`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        if (res._error) {
            toast(`Failed: ${res.error || 'Unknown error'}`, 'error');
        } else {
            toast('Welcomer saved!', 'success');
            localStorage.removeItem(`draft:welcomer:${g.id}`);
        }
    } catch (e) {
        toast(`Error: ${e.message}`, 'error');
    }
};

window.__testWelcome = async function() {
    const g = state.currentGuild;
    toast('Sending test welcome message...', 'info');
    const res = await api(`/api/guild/${g.id}/welcomer/test`, { method: 'POST' });
    if (res._error) {
        toast(`Failed: ${res.error}`, 'error');
    } else {
        toast('Test message sent!', 'success');
    }
};

window.__testLeave = async function() {
    const g = state.currentGuild;
    toast('Sending test leave message...', 'info');
    const res = await api(`/api/guild/${g.id}/welcomer/test-leave`, { method: 'POST' });
    if (res._error) {
        toast(`Failed: ${res.error}`, 'error');
    } else {
        toast('Test message sent!', 'success');
    }
};

async function pageWelcomer() {
    const g = state.currentGuild;
    const [cfg, channels, roles, customBtns, customMenus] = await Promise.all([
        api(`/api/guild/${g.id}/welcomer`),
        api(`/api/guild/${g.id}/channels`),
        api(`/api/guild/${g.id}/roles`),
        api(`/api/guild/${g.id}/buttons`),
        api(`/api/guild/${g.id}/menus`),
    ]);
    if (cfg?._error || cfg?._unauth) {
        $('#page').innerHTML = `<div class="empty"><h3>Failed to load</h3><p>${esc(cfg?.error || 'Unknown error')}</p></div>`;
        return;
    }
    state.channels = Array.isArray(channels) ? channels : [];
    state.roles    = Array.isArray(roles) ? roles.filter(r => r.name !== '@everyone') : [];
    state.customBtns = (customBtns && !customBtns._error) ? customBtns : {};
    state.customMenus = (customMenus && !customMenus._error) ? customMenus : {};

    const saved = structuredClone(cfg || {});

    // Check for unsaved draft in localStorage
    const draftKey = `draft:welcomer:${g.id}`;
    let w = saved;
    let hasDraft = false;
    try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
            const draft = JSON.parse(raw);
            // Only treat as draft if different from the saved server config
            if (JSON.stringify(draft) !== JSON.stringify(saved)) {
                w = draft;
                hasDraft = true;
            } else {
                localStorage.removeItem(draftKey); // Clean up stale draft
            }
        }
    } catch { localStorage.removeItem(draftKey); }

    window.__working = w;
    window.__savedSnapshot = saved;
    window.__draftKey = draftKey;
    _renderWelcomerBody(g, w, hasDraft);
}

function _persistWelcomerDraft() {
    try {
        if (!window.__draftKey || !window.__working) return;
        // Only persist if different from saved snapshot
        if (JSON.stringify(window.__working) === JSON.stringify(window.__savedSnapshot)) {
            localStorage.removeItem(window.__draftKey);
            _updateDraftIndicator(false);
        } else {
            localStorage.setItem(window.__draftKey, JSON.stringify(window.__working));
            _updateDraftIndicator(true);
        }
    } catch (e) {
        console.warn('[welcomer] Could not persist draft:', e.message);
    }
}

function _updateDraftIndicator(hasDraft) {
    const el = document.getElementById('draft-indicator');
    if (!el) return;
    if (hasDraft) {
        el.style.display = '';
        el.innerHTML = `<span class="tag amber">⚠ Unsaved draft</span><span class="text-sm text-mute">Auto-saved locally. Click Save to sync to bot.</span>`;
    } else {
        el.style.display = 'none';
    }
}

function _renderWelcomerBody(g, w, hasDraft) {
    // ── Helpers ──
    const chSel = (key, val, type) => {
        const list = state.channels.filter(c => {
            if (type === 'voice') return c.type === 2;
            if (type === 'category') return c.type === 4;
            return c.type === 0 || c.type === 5;
        });
        const options = list.map(c => {
            const selAttr = val === c.id ? 'selected' : '';
            return `<option value="${esc(c.id)}" ${selAttr}>#${esc(c.name)}</option>`;
        }).join('');
        return `<select data-key="${esc(key)}"><option value="">— None —</option>${options}</select>`;
    };
    const colorIn = (key, val = '#bcf1e4') => {
     const hex = val.startsWith('#') ? val : '#bcf1e4';
     return `<div class="row"><input type="color" data-key="${esc(key)}" value="${esc(hex)}"><input type="text" data-key="${esc(key)}" value="${esc(val)}" placeholder="#bcf1e4" style="flex:1"></div>`;
    };
    const tog = (key, val, label, desc, extra) => {
        const descHtml = desc ? `<div class="desc">${esc(desc)}</div>` : '';
        const chkAttr = val ? 'checked' : '';
        const exAttr = extra || '';
        return `<div class="switch-row"><div><div class="lbl">${esc(label)}</div>${descHtml}</div><label class="switch"><input type="checkbox" data-key="${esc(key)}" ${chkAttr} ${exAttr}><span class="slide"></span></label></div>`;
    };
    const sel = (key, val, opts) => {
        const optHtml = opts.map(o => {
            const selAttr = val === o ? 'selected' : '';
            return `<option value="${esc(o)}" ${selAttr}>${esc(o)}</option>`;
        }).join('');
        return `<select data-key="${esc(key)}">${optHtml}</select>`;
    };
    const vis = (cond) => cond ? '' : 'style="display:none"';

    const buttonsEditor = (key, list) => {
        const arr = Array.isArray(list) ? list : [];
        let h = `<div id="btn-ed-${cssKey(key)}">`;
        arr.forEach((b, i) => {
            h += `<div class="listi" style="display:block;margin-bottom:.5rem">
                <div class="row mb-1"><span class="tag">#${i+1}</span><span class="spacer"></span><button class="btn sm danger" onclick="window.__rmWelcBtn('${esc(key)}',${i})">×</button></div>
                <div class="form-row"><label>Label</label><input type="text" data-btn="${esc(key)}" data-idx="${i}" data-field="label" value="${esc(b.label||'')}"></div>
                <div class="form-row"><label>URL</label><input type="url" data-btn="${esc(key)}" data-idx="${i}" data-field="url" value="${esc(b.url||'')}"></div>
                <div class="form-row"><label>Emoji</label><input type="text" data-btn="${esc(key)}" data-idx="${i}" data-field="emoji" value="${esc(b.emoji||'')}" placeholder="🔗"></div>
            </div>`;
        });
        h += `<button class="btn sm mt-1" onclick="window.__addWelcBtn('${esc(key)}')">${icon('user-plus')} Add Button</button></div>`;
        return h;
    };

    // Custom action-button picker (attaches buttons made in Button Creator)
    const actionBtnsPicker = (key, selectedIds) => {
        const sel = new Set(selectedIds || []);
        const available = Object.entries(state.customBtns || {});
        if (available.length === 0) {
            return `<div class="empty" style="padding:1rem">
                <p class="text-sm text-mute">No custom buttons created yet.</p>
                <a class="btn sm primary mt-1" href="#/server/${esc(g.id)}/button-commands">${icon('user-plus')} Create Buttons</a>
            </div>`;
        }
        const styleColors = { primary:'#5865F2', secondary:'#4f545c', success:'#57f287', danger:'#ed4245', link:'#00b0f4' };
        let h = `<div class="chips mb-2" id="acb-selected-${cssKey(key)}">`;
        (selectedIds || []).forEach(id => {
            const b = state.customBtns[id];
            if (!b) return;
            const color = styleColors[b.style] || '#5865F2';
            h += `<span class="chip" style="border-color:${color}40;color:${color}">${b.emoji?esc(b.emoji)+' ':''}${esc(b.label)} <button onclick="window.__rmActionBtn('${esc(key)}','${esc(id)}')">×</button></span>`;
        });
        h += `</div>`;
        h += `<div class="form-row"><label>Add Action Button</label><select id="acb-select-${cssKey(key)}"><option value="">— Pick a button —</option>`;
        for (const [id, b] of available) {
            if (sel.has(id)) continue;
            h += `<option value="${esc(id)}">${esc(b.emoji||'')} ${esc(b.label)} (${esc(b.style)})</option>`;
        }
        h += `</select><button class="btn sm mt-1" onclick="window.__addActionBtn('${esc(key)}','${cssKey(key)}')">${icon('user-plus')} Attach</button></div>`;
        return h;
    };

    // Custom action-menu picker
    const actionMenusPicker = (key, selectedIds) => {
        const sel = new Set(selectedIds || []);
        const available = Object.entries(state.customMenus || {});
        if (available.length === 0) {
            return `<div class="empty" style="padding:1rem">
                <p class="text-sm text-mute">No custom menus created yet.</p>
                <a class="btn sm primary mt-1" href="#/server/${esc(g.id)}/select-menus">${icon('user-plus')} Create Menus</a>
            </div>`;
        }
        let h = `<div class="chips mb-2" id="acm-selected-${cssKey(key)}">`;
        (selectedIds || []).forEach(id => {
            const m = state.customMenus[id];
            if (!m) return;
            h += `<span class="chip">${esc(m.placeholder||id)} <button onclick="window.__rmActionMenu('${esc(key)}','${esc(id)}')">×</button></span>`;
        });
        h += `</div>`;
        h += `<div class="form-row"><label>Add Action Menu</label><select id="acm-select-${cssKey(key)}"><option value="">— Pick a menu —</option>`;
        for (const [id, m] of available) {
            if (sel.has(id)) continue;
            h += `<option value="${esc(id)}">${esc(m.placeholder || id)} (${(m.options||[]).length} opts)</option>`;
        }
        h += `</select><button class="btn sm mt-1" onclick="window.__addActionMenu('${esc(key)}','${cssKey(key)}')">${icon('user-plus')} Attach</button></div>`;
        return h;
    };

    const mode = w.mode || 'components';
    const lMode = w.leave?.mode || 'components';

    // ── Build HTML ──
    const html = `
        <div class="page-h">
            <div><h1>Welcomer</h1><p>Welcome & leave messages for ${esc(g.name)}. Syncs live to the bot.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div>
        </div>

        <div id="draft-indicator" class="row mb-2" style="${hasDraft ? '' : 'display:none'}">
            <span class="tag amber">⚠ Unsaved draft</span>
            <span class="text-sm text-mute">Auto-saved locally. Click Save to sync to bot.</span>
            <span class="spacer"></span>
            <button class="btn sm" onclick="window.__discardWelcomerDraft()">${icon('log')} Discard Draft</button>
        </div>

        <!-- ═══ MASTER TOGGLE ═══ -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('welcomer')}</div><div class="tt"><div class="t">Welcome Message</div><div class="s">Sent when a new member joins.</div></div></div>
            ${tog('enabled', w.enabled, 'Enable Welcomer', 'Turn welcome messages on/off.', 'data-vis="welc-all"')}
        </div>

        <!-- ═══ WELCOME CONFIG (hidden when disabled) ═══ -->
        <div id="welc-all" ${vis(w.enabled)}>

            <!-- Channel & Mode -->
            <div class="card mb-2">
                <div class="card-h"><div class="ic">${icon('settings')}</div><div class="tt"><div class="t">Channel & Mode</div><div class="s">Where and how the message appears.</div></div></div>
                <div class="form-row"><label>Welcome Channel</label>${chSel('channelId', w.channelId)}</div>
                <div class="form-row"><label>Display Mode</label>${sel('mode', mode, ['components','embed'])}<div class="hint">Components V2 = modern containers. Embed = classic embed.</div></div>
            </div>

            <!-- Message -->
            <div class="card mb-2">
                <div class="card-h"><div class="ic">${icon('chat')}</div><div class="tt"><div class="t">Message</div><div class="s">The text content of the welcome.</div></div></div>
                <div class="form-row"><textarea data-key="content" rows="4" placeholder="Welcome {user} to **{server}**!">${esc(w.content||'')}</textarea><div class="hint">Markdown supported. Use {user}, {server}, {membercount}. CV2: {separator} for dividers.</div></div>
            </div>

            <!-- EMBED-ONLY settings -->
            <div id="welc-embed" ${vis(mode==='embed')}>
                <div class="card mb-2">
                    <div class="card-h"><div class="ic">${icon('grid')}</div><div class="tt"><div class="t">Embed Settings</div></div></div>
                    <div class="form-row"><label>Embed Color</label>${colorIn('color', w.color)}</div>
                    <div class="form-row"><label>Title</label><input type="text" data-key="title" value="${esc(w.title||'')}" placeholder="Welcome to {server}!"></div>
                    <div class="form-row"><label>Author</label><input type="text" data-key="author" value="${esc(w.author||'')}" placeholder="{displayname} joined"></div>
                    <div class="form-row"><label>Footer</label><input type="text" data-key="footer" value="${esc(w.footer||'')}" placeholder="Member #{membercount}"></div>
                    <div class="form-row"><label>Image URL</label><input type="url" data-key="image" value="${esc(w.image||'')}"></div>
                    <div class="form-row"><label>Thumbnail URL</label><input type="url" data-key="thumbnail" value="${esc(w.thumbnail||'')}" placeholder="{useravatar}"></div>
                </div>
            </div>

            <!-- CV2-ONLY settings -->
            <div id="welc-cv2" ${vis(mode==='components')}>
                <div class="card mb-2">
                    <div class="card-h"><div class="ic">${icon('grid')}</div><div class="tt"><div class="t">Components V2 Settings</div></div></div>
                    <div class="form-row"><label>Accent Color</label>${colorIn('color', w.color)}</div>
                    ${tog('colorless', w.colorless, 'Colorless', 'Remove accent color for a clean look.')}
                    <div class="form-row mt-2"><label>Footer</label><input type="text" data-key="footer" value="${esc(w.footer||'')}" placeholder="Member #{membercount}"></div>
                    <hr>
                    <div class="form-row"><label>Image URL</label><input type="url" data-key="image" value="${esc(w.image||'')}"><div class="hint">Media gallery image.</div></div>
                    <div class="form-row"><label>Thumbnail URL</label><input type="url" data-key="thumbnail" value="${esc(w.thumbnail||'')}" placeholder="{useravatar}"><div class="hint">Side thumbnail.</div></div>
                    <div class="form-row"><label>Image Position</label>${sel('imagePosition', w.imagePosition||'bottom', ['top','bottom','side'])}</div>
                </div>
            </div>

            <!-- Buttons -->
            <div class="card mb-2">
                <div class="card-h"><div class="ic">${icon('link')}</div><div class="tt"><div class="t">Buttons & Menus</div><div class="s">URL buttons plus your custom action buttons/menus.</div></div></div>
                <div class="form-row"><label>Position</label>${sel('buttonPosition', w.buttonPosition||'bottom', ['top','bottom'])}</div>
                <hr>
                <h4 class="mb-1">URL Buttons</h4>
                <p class="text-sm text-mute mb-2">Simple link buttons. Add up to 5.</p>
                ${buttonsEditor('buttons', w.buttons)}
                <hr>
                <h4 class="mb-1">Custom Action Buttons</h4>
                <p class="text-sm text-mute mb-2">Attach buttons created in Button Creator (with styles, role actions, etc).</p>
                ${actionBtnsPicker('actionButtons', w.actionButtons)}
                <hr>
                <h4 class="mb-1">Custom Action Menus</h4>
                <p class="text-sm text-mute mb-2">Attach select menus created in Menu Creator.</p>
                ${actionMenusPicker('actionMenus', w.actionMenus)}
            </div>

            <!-- Extras -->
            <div class="card mb-2">
                <div class="card-h"><div class="ic">${icon('star')}</div><div class="tt"><div class="t">Extras</div><div class="s">Ping, DM, auto-delete.</div></div></div>
                ${tog('pingUser', w.pingUser, 'Ping User', 'Mention user outside the message.')}
                <div class="form-row mt-2"><label>Auto-Delete (seconds)</label><input type="number" data-key="autoDelete" value="${w.autoDelete||0}" min="0" max="3600"><div class="hint">0 = never.</div></div>
                <hr>
                ${tog('dmWelcome.enabled', w.dmWelcome?.enabled, 'DM Welcome', 'Send a DM to the new member.', 'data-vis="dm-body"')}
                <div id="dm-body" ${vis(w.dmWelcome?.enabled)}>
                    <div class="form-row mt-1"><textarea data-key="dmWelcome.content" rows="2" placeholder="Welcome to **{server}**!">${esc(w.dmWelcome?.content||'')}</textarea></div>
                </div>
            </div>

            <!-- Canvas -->
            <div class="card mb-2">
                <div class="card-h"><div class="ic">${icon('image')}</div><div class="tt"><div class="t">Canvas Card</div><div class="s">Auto-generated PNG welcome card.</div></div></div>
                ${tog('canvas.enabled', w.canvas?.enabled, 'Enable Canvas', 'Generates a card with avatar + member count.', 'data-vis="canvas-body"')}
                <div id="canvas-body" ${vis(w.canvas?.enabled)}>
                    <div class="form-row mt-2"><label>Background</label>${colorIn('canvas.backgroundColor', w.canvas?.backgroundColor||'#23272a')}</div>
                    <div class="form-row"><label>Accent</label>${colorIn('canvas.accentColor', w.canvas?.accentColor||'#bcf1e4')}</div>
                    <div class="form-row"><label>Text Color</label>${colorIn('canvas.textColor', w.canvas?.textColor||'#ffffff')}</div>
                    <div class="form-row"><label>Background Image</label><input type="url" data-key="canvas.backgroundImage" value="${esc(w.canvas?.backgroundImage||'')}"></div>
                    <div class="form-row"><label>Custom Message</label><input type="text" data-key="canvas.customMessage" value="${esc(w.canvas?.customMessage||'')}" placeholder="Member #{membercount}"></div>
                </div>
            </div>
        </div>

        <!-- ═══ LEAVE TOGGLE ═══ -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic" style="background:rgba(239,68,68,.15);color:#f87171">${icon('user-x')}</div><div class="tt"><div class="t">Leave Messages</div><div class="s">Sent when a member leaves.</div></div></div>
            ${tog('leave.enabled', w.leave?.enabled, 'Enable Leave Messages', '', 'data-vis="leave-all"')}
        </div>

        <!-- ═══ LEAVE CONFIG ═══ -->
        <div id="leave-all" ${vis(w.leave?.enabled)}>
            <div class="card mb-2">
                <div class="card-h"><div class="ic">${icon('settings')}</div><div class="tt"><div class="t">Leave Channel & Mode</div></div></div>
                <div class="form-row"><label>Channel</label>${chSel('leave.channelId', w.leave?.channelId)}<div class="hint">If empty, uses welcome channel.</div></div>
                <div class="form-row"><label>Mode</label>${sel('leave.mode', lMode, ['components','embed'])}</div>
                <div class="form-row"><textarea data-key="leave.content" rows="3" placeholder="Goodbye **{username}**!">${esc(w.leave?.content||'')}</textarea></div>
            </div>

            <div id="leave-embed" ${vis(lMode==='embed')}>
                <div class="card mb-2">
                    <div class="card-h"><div class="ic">${icon('grid')}</div><div class="tt"><div class="t">Leave Embed</div></div></div>
                    <div class="form-row"><label>Color</label>${colorIn('leave.color', w.leave?.color||'#ED4245')}</div>
                    <div class="form-row"><label>Title</label><input type="text" data-key="leave.title" value="${esc(w.leave?.title||'')}"></div>
                    <div class="form-row"><label>Author</label><input type="text" data-key="leave.author" value="${esc(w.leave?.author||'')}"></div>
                    <div class="form-row"><label>Footer</label><input type="text" data-key="leave.footer" value="${esc(w.leave?.footer||'')}"></div>
                    <div class="form-row"><label>Image</label><input type="url" data-key="leave.image" value="${esc(w.leave?.image||'')}"></div>
                    <div class="form-row"><label>Thumbnail</label><input type="url" data-key="leave.thumbnail" value="${esc(w.leave?.thumbnail||'')}"></div>
                </div>
            </div>

            <div id="leave-cv2" ${vis(lMode==='components')}>
                <div class="card mb-2">
                    <div class="card-h"><div class="ic">${icon('grid')}</div><div class="tt"><div class="t">Leave CV2</div></div></div>
                    <div class="form-row"><label>Accent Color</label>${colorIn('leave.color', w.leave?.color||'#ED4245')}</div>
                    ${tog('leave.colorless', w.leave?.colorless, 'Colorless')}
                    <div class="form-row mt-2"><label>Footer</label><input type="text" data-key="leave.footer" value="${esc(w.leave?.footer||'')}"></div>
                    <div class="form-row"><label>Image</label><input type="url" data-key="leave.image" value="${esc(w.leave?.image||'')}"></div>
                    <div class="form-row"><label>Thumbnail</label><input type="url" data-key="leave.thumbnail" value="${esc(w.leave?.thumbnail||'')}"></div>
                    <div class="form-row"><label>Image Position</label>${sel('leave.imagePosition', w.leave?.imagePosition||'bottom', ['top','bottom','side'])}</div>
                </div>
            </div>

            <div class="card mb-2">
                <div class="card-h"><div class="ic">${icon('link')}</div><div class="tt"><div class="t">Leave Buttons & Menus</div></div></div>
                <div class="form-row"><label>Position</label>${sel('leave.buttonPosition', w.leave?.buttonPosition||'bottom', ['top','bottom'])}</div>
                <hr>
                <h4 class="mb-1">URL Buttons</h4>
                ${buttonsEditor('leave.buttons', w.leave?.buttons)}
                <hr>
                <h4 class="mb-1">Custom Action Buttons</h4>
                ${actionBtnsPicker('leave.actionButtons', w.leave?.actionButtons)}
                <hr>
                <h4 class="mb-1">Custom Action Menus</h4>
                ${actionMenusPicker('leave.actionMenus', w.leave?.actionMenus)}
            </div>

            <div class="card mb-2">
                <div class="card-h"><div class="ic">${icon('image')}</div><div class="tt"><div class="t">Leave Canvas</div></div></div>
                ${tog('leave.canvas.enabled', w.leave?.canvas?.enabled, 'Enable Leave Canvas', '', 'data-vis="leave-canvas"')}
                <div id="leave-canvas" ${vis(w.leave?.canvas?.enabled)}>
                    <div class="form-row mt-2"><label>Background</label>${colorIn('leave.canvas.backgroundColor', w.leave?.canvas?.backgroundColor||'#23272a')}</div>
                    <div class="form-row"><label>Accent</label>${colorIn('leave.canvas.accentColor', w.leave?.canvas?.accentColor||'#ed4245')}</div>
                    <div class="form-row"><label>Text</label>${colorIn('leave.canvas.textColor', w.leave?.canvas?.textColor||'#ffffff')}</div>
                    <div class="form-row"><label>Background Image</label><input type="url" data-key="leave.canvas.backgroundImage" value="${esc(w.leave?.canvas?.backgroundImage||'')}"></div>
                    <div class="form-row"><label>Custom Message</label><input type="text" data-key="leave.canvas.customMessage" value="${esc(w.leave?.canvas?.customMessage||'')}"></div>
                </div>
            </div>
        </div>

        <!-- ═══ VARIABLES ═══ -->
        <div class="card mt-2 mb-2" style="font-size:.82rem">
            <h3>Variables</h3>
            <div class="grid g-2 mt-1" style="gap:.4rem">
                <div><b>User:</b> <code>{user}</code> <code>{username}</code> <code>{displayname}</code> <code>{userid}</code> <code>{useravatar}</code> <code>{usercreated}</code> <code>{userjoined}</code></div>
                <div><b>Server:</b> <code>{server}</code> <code>{serverid}</code> <code>{servericon}</code> <code>{membercount}</code> <code>{boostcount}</code> <code>{boosttier}</code></div>
                <div><b>Separators:</b> <code>{separator}</code> <code>{separator:small}</code> <code>{separator:medium}</code> <code>{separator:large}</code></div>
            </div>
        </div>

        <!-- ═══ PREVIEW ═══ -->
        <div class="card mt-2 mb-2" id="welc-preview-card" ${vis(w.enabled)}>
            <div class="card-h"><div class="ic">${icon('chat')}</div><div class="tt"><div class="t">Live Preview</div><div class="s">Approximate rendering.</div></div></div>
            <div class="preview" id="welc-preview">
                <!-- Reactively generated by buildDiscordPreview -->
            </div>
        </div>

        <!-- ═══ SAVE ═══ -->
        <div class="save-bar">
            <div class="row">
                <span class="tag ${w.enabled?'green':'grey'}" id="mod-status-tag">${w.enabled?'Active':'Inactive'}</span>
                <span class="text-sm text-mute">Saves directly to bot database.</span>
            </div>
            <div class="row">
                <button class="btn" id="reset-btn">${icon('log')} Reset</button>
                <button class="btn primary" id="save-btn">${icon('check')} Save</button>
            </div>
        </div>
    `;

    $('#page').innerHTML = html;

    // ── Bind form inputs ──
    bindFormInputs(w);
    _bindWelcBtnEditors(w);

    // ── Progressive disclosure: data-vis toggles ──
    $$('#page [data-vis]').forEach(inp => {
        inp.addEventListener('change', () => {
            const t = document.getElementById(inp.dataset.vis);
            if (t) t.style.display = inp.checked ? '' : 'none';
            // Also show/hide preview when master toggle changes
            if (inp.dataset.key === 'enabled') {
                const pc = document.getElementById('welc-preview-card');
                if (pc) pc.style.display = inp.checked ? '' : 'none';
            }
        });
    });

    // ── Mode switching ──
    const modeEl = document.querySelector('#page select[data-key="mode"]');
    if (modeEl) modeEl.addEventListener('change', () => {
        const isE = modeEl.value === 'embed';
        const eF = document.getElementById('welc-embed');
        const cF = document.getElementById('welc-cv2');
        if (eF) eF.style.display = isE ? '' : 'none';
        if (cF) cF.style.display = isE ? 'none' : '';
    });
    const lModeEl = document.querySelector('#page select[data-key="leave.mode"]');
    if (lModeEl) lModeEl.addEventListener('change', () => {
        const isE = lModeEl.value === 'embed';
        const eF = document.getElementById('leave-embed');
        const cF = document.getElementById('leave-cv2');
        if (eF) eF.style.display = isE ? '' : 'none';
        if (cF) cF.style.display = isE ? 'none' : '';
    });

    // ── Live preview ──
    let pt;
    function updPreview() {
        const previewEl = document.getElementById('welc-preview');
        if (!previewEl) return;
        
        const previewCfg = JSON.parse(JSON.stringify(window.__working || {}));
        previewCfg._isWelcomer = true;
        
        if (previewCfg.content) previewCfg.content = previewCfg.content.replaceAll('{user}','@User').replaceAll('{username}','User').replaceAll('{server}',g.name).replaceAll('{membercount}','42').replace(/\{separator[^}]*\}/g,'───');
        if (previewCfg.title) previewCfg.title = previewCfg.title.replaceAll('{server}',g.name);
        if (previewCfg.footer) previewCfg.footer = previewCfg.footer.replaceAll('{membercount}','42');
        if (previewCfg.leave?.content) previewCfg.leave.content = previewCfg.leave.content.replaceAll('{username}','User').replaceAll('{server}',g.name).replaceAll('{membercount}','41');

        previewEl.innerHTML = buildDiscordPreview(previewCfg, state.botInfo);
    }
    
    $('#page').addEventListener('input', () => { clearTimeout(pt); pt = setTimeout(() => { updPreview(); _persistWelcomerDraft(); }, 250); });
    $('#page').addEventListener('change', () => { clearTimeout(pt); pt = setTimeout(() => { updPreview(); _persistWelcomerDraft(); }, 100); });
    
    // Initial render
    updPreview();
    // ── Save / Reset ──
    $('#reset-btn').onclick = () => {
        if (confirm('Discard your unsaved draft and reload from saved config?')) {
            try { localStorage.removeItem(window.__draftKey); } catch {}
            handleRoute();
        }
    };
    $('#save-btn').onclick = async () => {
        const btn = $('#save-btn');
        btn.disabled = true; btn.textContent = 'Saving…';
        const r = await api(`/api/guild/${g.id}/welcomer`, { method: 'PUT', body: JSON.stringify(w) });
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (!r || r._error || r._unauth) toast(r?.error || 'Save failed', 'error');
        else {
            toast('Welcomer saved — live now!', 'success');
            // Clear draft and update snapshot so indicator hides
            try { localStorage.removeItem(window.__draftKey); } catch {}
            window.__savedSnapshot = structuredClone(w);
            _updateDraftIndicator(false);
            $('#mod-status-tag').className = 'tag ' + (w.enabled ? 'green' : 'grey');
            $('#mod-status-tag').textContent = w.enabled ? 'Active' : 'Inactive';
        }
    };
}

// Discard draft and reload from saved config
window.__discardWelcomerDraft = () => {
    if (!confirm('Discard your local draft and reload the saved config?')) return;
    try { localStorage.removeItem(window.__draftKey); } catch {}
    handleRoute();
};

// ── Button editor bindings ──
function _bindWelcBtnEditors(working) {
    $$('#page [data-btn]').forEach(inp => {
        inp.addEventListener('input', () => {
            const key = inp.dataset.btn;
            const idx = Number.parseInt(inp.dataset.idx);
            const field = inp.dataset.field;
            const arr = getDeep(working, key) || [];
            if (!arr[idx]) arr[idx] = {};
            arr[idx][field] = inp.value;
            setDeep(working, key, arr);
        });
    });
}
window.__addWelcBtn = (key) => {
    const arr = (getDeep(window.__working, key) || []).slice();
    arr.push({ label: '', url: '', emoji: '' });
    setDeep(window.__working, key, arr);
    _persistWelcomerDraft();
    _rerenderWelcomerKeepScroll();
};
window.__rmWelcBtn = (key, idx) => {
    const arr = (getDeep(window.__working, key) || []).slice();
    arr.splice(idx, 1);
    setDeep(window.__working, key, arr);
    _persistWelcomerDraft();
    _rerenderWelcomerKeepScroll();
};

// ── Custom action button/menu pickers ──
window.__addActionBtn = (key, cssKeyStr) => {
    const sel = document.getElementById('acb-select-' + cssKeyStr);
    if (!sel?.value) return;
    const arr = (getDeep(window.__working, key) || []).slice();
    if (!arr.includes(sel.value)) arr.push(sel.value);
    setDeep(window.__working, key, arr);
    _persistWelcomerDraft();
    _rerenderWelcomerKeepScroll();
};
window.__rmActionBtn = (key, id) => {
    const arr = (getDeep(window.__working, key) || []).filter(x => x !== id);
    setDeep(window.__working, key, arr);
    _persistWelcomerDraft();
    _rerenderWelcomerKeepScroll();
};
window.__addActionMenu = (key, cssKeyStr) => {
    const sel = document.getElementById('acm-select-' + cssKeyStr);
    if (!sel?.value) return;
    const arr = (getDeep(window.__working, key) || []).slice();
    if (!arr.includes(sel.value)) arr.push(sel.value);
    setDeep(window.__working, key, arr);
    _persistWelcomerDraft();
    _rerenderWelcomerKeepScroll();
};
window.__rmActionMenu = (key, id) => {
    const arr = (getDeep(window.__working, key) || []).filter(x => x !== id);
    setDeep(window.__working, key, arr);
    _persistWelcomerDraft();
    _rerenderWelcomerKeepScroll();
};

// Re-render the welcomer body using in-memory state (does NOT re-fetch)
function _rerenderWelcomerKeepScroll() {
    const scrollY = window.scrollY;
    const g = state.currentGuild;
    const w = window.__working;
    if (!g || !w) return;
    const hasDraft = window.__savedSnapshot && JSON.stringify(w) !== JSON.stringify(window.__savedSnapshot);
    _renderWelcomerBody(g, w, hasDraft);
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
}
