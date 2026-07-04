/* =========================================================
   xNico Dashboard — menus.js
   Select Menu Creator: CRUD for custom dropdown menus.
   Syncs to jsonStore 'select-menus' used by the bot.
   ========================================================= */

async function pageMenuCreator() {
    const g = state.currentGuild;
    const [menus, roles, channels] = await Promise.all([
        api(`/api/guild/${g.id}/menus`),
        api(`/api/guild/${g.id}/roles`),
        api(`/api/guild/${g.id}/channels`),
    ]);
    state.roles = Array.isArray(roles) ? roles.filter(r => r.name !== '@everyone') : [];
    state.channels = Array.isArray(channels) ? channels : [];
    const data = (menus && !menus._error) ? menus : {};

    renderMenuList(g, data);
}

function renderMenuList(g, data) {
    const ids = Object.keys(data);

    let cardsHtml = '';
    if (ids.length === 0) {
        cardsHtml = `<div class="empty">${icon('hash')}<h3>No menus yet</h3><p>Create your first select menu to get started.</p></div>`;
    } else {
        cardsHtml = `<div class="grid g-3">${ids.map(id => {
            const m = data[id];
            const optCount = (m.options || []).length;
            return `
                <div class="card hover" style="cursor:pointer" onclick="window.__editMenu('${esc(id)}')">
                    <div class="row mb-2">
                        <div style="padding:6px 14px;border-radius:8px;background:var(--bg-hover);border:1px solid var(--border);font-weight:600;font-size:.85rem">${esc(m.placeholder || 'Select...')}</div>
                        <span class="spacer"></span>
                        <button class="btn sm danger" onclick="event.stopPropagation();window.__delMenu('${esc(id)}')" title="Delete">×</button>
                    </div>
                    <div class="text-xs text-mute">ID: <code>${esc(id)}</code></div>
                    <div class="text-xs text-mute mt-1">${optCount} option${optCount !== 1 ? 's' : ''} • Min: ${m.minValues || 1} • Max: ${m.maxValues || 1} • ${m.ephemeral !== false ? 'Ephemeral' : 'Public'}</div>
                </div>`;
        }).join('')}</div>`;
    }

    $('#page').innerHTML = `
        <div class="page-h">
            <div><h1>Menu Creator</h1><p>Create dropdown select menus for ${esc(g.name)}. Menus are live immediately.</p></div>
            <div class="row wrap">
                <a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a>
                <button class="btn primary" onclick="window.__newMenu()">${icon('user-plus')} New Menu</button>
            </div>
        </div>
        ${cardsHtml}
    `;
}

function renderMenuEditor(g, id, menu, isNew) {
    const actionTypes = ['add_role','remove_role','toggle_role','send_message','send_dm','create_ticket'];
    const roleSel = `<select id="opt-action-role"><option value="">— Select Role —</option>${state.roles.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>`;

    // Check for unsaved draft
    const draftKey = `draft:menu:${g.id}:${id || '__new__'}`;
    let hasDraft = false;
    try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
            const draft = JSON.parse(raw);
            if (JSON.stringify(draft) !== JSON.stringify(menu)) {
                menu = draft;
                hasDraft = true;
            } else {
                localStorage.removeItem(draftKey);
            }
        }
    } catch { localStorage.removeItem(draftKey); }

    window.__menuDraftKey = draftKey;
    window.__currentMenuOpts = menu.options || [];

    function persistMenuDraft() {
        try {
            const cur = {
                placeholder: $('#menu-placeholder')?.value || 'Select an option...',
                minValues: parseInt($('#menu-min')?.value) || 1,
                maxValues: parseInt($('#menu-max')?.value) || 1,
                ephemeral: $('#menu-ephemeral')?.checked,
                options: window.__currentMenuOpts
            };
            localStorage.setItem(draftKey, JSON.stringify(cur));
            const ind = document.getElementById('menu-draft-indicator');
            if (ind) ind.style.display = '';
        } catch {}
    }

    const optionsHtml = (menu.options || []).map((o, i) => {
        const acts = (o.actions || []).length;
        return `
            <div class="listi" style="display:block;margin-bottom:.5rem">
                <div class="row mb-1">
                    <span class="tag">${o.emoji ? esc(o.emoji)+' ' : ''}${esc(o.label)}</span>
                    <span class="text-xs text-mute" style="margin-left:.5rem">${esc(o.value)}</span>
                    <span class="spacer"></span>
                    <button class="btn sm" onclick="window.__editMenuOpt(${i})" title="Edit actions">⚙️ ${acts}</button>
                    <button class="btn sm danger" onclick="window.__rmMenuOpt(${i})" title="Remove">×</button>
                </div>
                ${o.description ? `<div class="text-xs text-mute">${esc(o.description)}</div>` : ''}
            </div>`;
    }).join('');

    $('#page').innerHTML = `
        <div class="page-h">
            <div><h1>${isNew ? 'Create' : 'Edit'} Menu</h1><p>${isNew ? 'Configure a new select menu.' : `Editing: <code>${esc(id)}</code>`}</p></div>
            <div class="row wrap"><button class="btn" onclick="pageMenuCreator()">${icon('home')} Back</button></div>
        </div>

        <div id="menu-draft-indicator" class="row mb-2" style="${hasDraft ? '' : 'display:none'}">
            <span class="tag amber">⚠ Unsaved draft</span>
            <span class="text-sm text-mute">Auto-saved locally — won't be lost on refresh.</span>
        </div>

        <div class="card mb-2">
            <h3 class="mb-2">Menu Settings</h3>
            ${isNew ? `<div class="form-row"><label>Menu ID</label><input type="text" id="menu-id" value="${esc(id)}" placeholder="roles, colors, games"><div class="hint">Unique ID, lowercase.</div></div>` : ''}
            <div class="form-row"><label>Placeholder</label><input type="text" id="menu-placeholder" value="${esc(menu.placeholder || '')}" placeholder="Select an option..."></div>
            <div class="form-row"><label>Min Selections</label><input type="number" id="menu-min" value="${menu.minValues || 1}" min="0" max="25"></div>
            <div class="form-row"><label>Max Selections</label><input type="number" id="menu-max" value="${menu.maxValues || 1}" min="1" max="25"></div>
            <div class="switch-row"><div><div class="lbl">Ephemeral Response</div><div class="desc">Only the user sees the response.</div></div><label class="switch"><input type="checkbox" id="menu-ephemeral" ${menu.ephemeral !== false ? 'checked' : ''}><span class="slide"></span></label></div>
        </div>

        <div class="card mb-2">
            <h3 class="mb-2">Options (${(menu.options || []).length}/25)</h3>
            ${optionsHtml || '<div class="text-sm text-mute">No options yet. Add at least one.</div>'}
            <hr>
            <h3 class="mb-1">Add Option</h3>
            <div class="form-row"><label>Label</label><input type="text" id="opt-label" placeholder="Option name"></div>
            <div class="form-row"><label>Value</label><input type="text" id="opt-value" placeholder="unique-value"></div>
            <div class="form-row"><label>Description</label><input type="text" id="opt-desc" placeholder="Optional description"></div>
            <div class="form-row"><label>Emoji</label><input type="text" id="opt-emoji" placeholder="🎮"></div>
            <button class="btn sm mt-1" onclick="window.__addMenuOpt()">${icon('user-plus')} Add Option</button>
        </div>

        <div class="save-bar">
            <div class="row"><span class="text-sm text-mute">Saves directly to bot. Menu is live immediately.</span></div>
            <div class="row">
                <button class="btn" onclick="pageMenuCreator()">Cancel</button>
                <button class="btn primary" id="save-menu-btn">${icon('check')} ${isNew ? 'Create' : 'Save'}</button>
            </div>
        </div>
    `;

    window.__currentMenuOpts = menu.options || [];

    $$('#page input, #page select, #page textarea').forEach(el => {
        el.addEventListener('input', persistMenuDraft);
        el.addEventListener('change', persistMenuDraft);
    });

    $('#save-menu-btn').onclick = async () => {
        const menuId = isNew ? ($('#menu-id')?.value || '').toLowerCase().replace(/\s+/g, '-') : id;
        if (!menuId) return toast('Menu ID required', 'error');
        const payload = {
            id: menuId,
            placeholder: $('#menu-placeholder').value || 'Select an option...',
            minValues: parseInt($('#menu-min').value) || 1,
            maxValues: parseInt($('#menu-max').value) || 1,
            ephemeral: $('#menu-ephemeral').checked,
            options: window.__currentMenuOpts
        };
        const endpoint = isNew ? `/api/guild/${g.id}/menus` : `/api/guild/${g.id}/menus/${menuId}`;
        const method = isNew ? 'POST' : 'PUT';
        const r = await api(endpoint, { method, body: JSON.stringify(payload) });
        if (r && !r._error) {
            toast('Menu saved!', 'success');
            try { localStorage.removeItem(draftKey); } catch {}
            pageMenuCreator();
        }
        else toast(r?.error || 'Save failed', 'error');
    };
}

// Option action editor (modal-like inline)
function renderOptActionEditor(g, id, menu, optIdx) {
    const opt = menu.options[optIdx];
    if (!opt) return pageMenuCreator();
    const actionTypes = ['add_role','remove_role','toggle_role','send_message','send_dm','create_ticket'];
    const roleSel = `<select id="oa-role"><option value="">— Select Role —</option>${state.roles.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>`;

    const actionsHtml = (opt.actions || []).map((a, i) => `
        <div class="listi" style="display:block;margin-bottom:.4rem">
            <div class="row"><span class="tag">${esc(a.type)}</span>${a.roleId ? `<span class="text-xs text-mute" style="margin-left:.5rem">${esc(a.roleId)}</span>` : ''}${a.message ? `<span class="text-xs text-mute" style="margin-left:.5rem">${esc(a.message.substring(0,40))}</span>` : ''}<span class="spacer"></span><button class="btn sm danger" onclick="window.__rmOptAction(${optIdx},${i})">×</button></div>
        </div>`).join('');

    $('#page').innerHTML = `
        <div class="page-h">
            <div><h1>Edit Actions: ${esc(opt.label)}</h1><p>Actions for option <code>${esc(opt.value)}</code> in menu <code>${esc(id)}</code>.</p></div>
            <div class="row wrap"><button class="btn" onclick="window.__backToMenuEditor('${esc(id)}')">${icon('home')} Back to Menu</button></div>
        </div>
        <div class="card mb-2">
            <h3 class="mb-2">Current Actions (${(opt.actions || []).length})</h3>
            ${actionsHtml || '<div class="text-sm text-mute">No actions. Add one below.</div>'}
            <hr>
            <h3 class="mb-1">Add Action</h3>
            <div class="form-row"><label>Type</label><select id="oa-type">${actionTypes.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div>
            <div class="form-row"><label>Role</label>${roleSel}</div>
            <div class="form-row"><label>Message</label><textarea id="oa-msg" rows="2" placeholder="Hello {user}!"></textarea></div>
            <button class="btn sm mt-1" onclick="window.__addOptAction(${optIdx})">${icon('user-plus')} Add</button>
        </div>
        <div class="save-bar">
            <div class="row"><span class="text-sm text-mute">Don't forget to save the menu after editing actions.</span></div>
            <div class="row"><button class="btn primary" onclick="window.__backToMenuEditor('${esc(id)}')">${icon('check')} Done</button></div>
        </div>
    `;
}

window.__newMenu = () => {
    const g = state.currentGuild;
    renderMenuEditor(g, '', { placeholder: 'Select an option...', minValues: 1, maxValues: 1, ephemeral: true, options: [] }, true);
};
window.__editMenu = async (id) => {
    const g = state.currentGuild;
    const menus = await api(`/api/guild/${g.id}/menus`);
    if (menus && menus[id]) renderMenuEditor(g, id, menus[id], false);
    else toast('Menu not found', 'error');
};
window.__delMenu = async (id) => {
    if (!confirm(`Delete menu "${id}"?`)) return;
    const g = state.currentGuild;
    const r = await api(`/api/guild/${g.id}/menus/${id}`, { method: 'DELETE' });
    if (r && !r._error) { toast('Deleted', 'success'); pageMenuCreator(); }
    else toast('Delete failed', 'error');
};
window.__addMenuOpt = () => {
    const label = $('#opt-label').value;
    const value = ($('#opt-value').value || '').toLowerCase().replace(/\s+/g, '-');
    if (!label || !value) return toast('Label and value required', 'error');
    window.__currentMenuOpts.push({ label, value, description: $('#opt-desc').value || '', emoji: $('#opt-emoji').value || null, actions: [] });
    // Re-render
    const g = state.currentGuild;
    const id = $('#menu-id')?.value || '';
    const menu = { placeholder: $('#menu-placeholder').value, minValues: parseInt($('#menu-min').value), maxValues: parseInt($('#menu-max').value), ephemeral: $('#menu-ephemeral').checked, options: window.__currentMenuOpts };
    renderMenuEditor(g, id, menu, !$('#menu-id')?.disabled);
};
window.__rmMenuOpt = (idx) => {
    window.__currentMenuOpts.splice(idx, 1);
    const g = state.currentGuild;
    const id = $('#menu-id')?.value || '';
    const menu = { placeholder: $('#menu-placeholder').value, minValues: parseInt($('#menu-min').value), maxValues: parseInt($('#menu-max').value), ephemeral: $('#menu-ephemeral').checked, options: window.__currentMenuOpts };
    renderMenuEditor(g, id, menu, !$('#menu-id')?.disabled);
};
window.__editMenuOpt = (optIdx) => {
    const g = state.currentGuild;
    const id = $('#menu-id')?.value || '';
    const menu = { placeholder: $('#menu-placeholder')?.value, minValues: parseInt($('#menu-min')?.value), maxValues: parseInt($('#menu-max')?.value), ephemeral: $('#menu-ephemeral')?.checked, options: window.__currentMenuOpts };
    window.__currentMenuData = { id, menu, isNew: !$('#menu-id')?.disabled };
    renderOptActionEditor(g, id, menu, optIdx);
};
window.__addOptAction = (optIdx) => {
    const type = $('#oa-type').value;
    const action = { type };
    if (type.includes('role')) action.roleId = $('#oa-role').value;
    if (type === 'send_message' || type === 'send_dm') action.message = $('#oa-msg').value;
    if (type === 'create_ticket') action.ticketName = 'ticket-{user}';
    if (!window.__currentMenuOpts[optIdx].actions) window.__currentMenuOpts[optIdx].actions = [];
    window.__currentMenuOpts[optIdx].actions.push(action);
    const g = state.currentGuild;
    const d = window.__currentMenuData || {};
    renderOptActionEditor(g, d.id, { ...d.menu, options: window.__currentMenuOpts }, optIdx);
};
window.__rmOptAction = (optIdx, actIdx) => {
    window.__currentMenuOpts[optIdx].actions.splice(actIdx, 1);
    const g = state.currentGuild;
    const d = window.__currentMenuData || {};
    renderOptActionEditor(g, d.id, { ...d.menu, options: window.__currentMenuOpts }, optIdx);
};
window.__backToMenuEditor = async (id) => {
    const g = state.currentGuild;
    const d = window.__currentMenuData || {};
    renderMenuEditor(g, id, { ...d.menu, options: window.__currentMenuOpts }, d.isNew);
};
