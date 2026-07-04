/* =========================================================
   xNico Dashboard — buttons.js
   Button Creator: CRUD for custom interactive buttons.
   Syncs to jsonStore 'button-commands' used by the bot.
   ========================================================= */

async function pageButtonCreator() {
    const g = state.currentGuild;
    const [buttons, roles, channels] = await Promise.all([
        api(`/api/guild/${g.id}/buttons`),
        api(`/api/guild/${g.id}/roles`),
        api(`/api/guild/${g.id}/channels`),
    ]);
    state.roles = Array.isArray(roles) ? roles.filter(r => r.name !== '@everyone') : [];
    state.channels = Array.isArray(channels) ? channels : [];
    const btns = (buttons && !buttons._error) ? buttons : {};

    renderButtonList(g, btns);
}

function renderButtonList(g, btns) {
    const ids = Object.keys(btns);
    const styleColors = { primary: '#5865F2', secondary: '#4f545c', success: '#57f287', danger: '#ed4245', link: '#00b0f4' };

    let cardsHtml = '';
    if (ids.length === 0) {
        cardsHtml = `<div class="empty">${icon('grid')}<h3>No buttons yet</h3><p>Create your first button to get started.</p></div>`;
    } else {
        cardsHtml = `<div class="grid g-3">${ids.map(id => {
            const b = btns[id];
            const color = styleColors[b.style] || '#5865F2';
            const actionCount = (b.actions || []).length;
            return `
                <div class="card hover" style="cursor:pointer" onclick="window.__editBtn('${esc(id)}')">
                    <div class="row mb-2">
                        <div style="padding:6px 14px;border-radius:8px;background:${color};color:#fff;font-weight:700;font-size:.85rem">${b.emoji ? esc(b.emoji)+' ' : ''}${esc(b.label)}</div>
                        <span class="spacer"></span>
                        <button class="btn sm danger" onclick="event.stopPropagation();window.__delBtn('${esc(id)}')" title="Delete">×</button>
                    </div>
                    <div class="text-xs text-mute">ID: <code>${esc(id)}</code></div>
                    <div class="text-xs text-mute mt-1">Style: ${esc(b.style)} • ${actionCount} action${actionCount !== 1 ? 's' : ''} • ${b.ephemeral !== false ? 'Ephemeral' : 'Public'}</div>
                </div>`;
        }).join('')}</div>`;
    }

    $('#page').innerHTML = `
        <div class="page-h">
            <div><h1>Button Creator</h1><p>Create interactive buttons for ${esc(g.name)}. Buttons are live in Discord immediately.</p></div>
            <div class="row wrap">
                <a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a>
                <button class="btn primary" onclick="window.__newBtn()">${icon('user-plus')} New Button</button>
            </div>
        </div>
        ${cardsHtml}
    `;
}

function renderButtonEditor(g, id, btn, isNew) {
    const styles = ['primary','secondary','success','danger','link'];
    const actionTypes = ['add_role','remove_role','toggle_role','send_message','send_dm','create_ticket'];

    // Check for unsaved draft
    const draftKey = `draft:button:${g.id}:${id || '__new__'}`;
    let hasDraft = false;
    try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
            const draft = JSON.parse(raw);
            if (JSON.stringify(draft) !== JSON.stringify(btn)) {
                btn = draft;
                hasDraft = true;
            } else {
                localStorage.removeItem(draftKey);
            }
        }
    } catch { localStorage.removeItem(draftKey); }

    window.__btnDraftKey = draftKey;
    window.__btnSnapshot = JSON.parse(JSON.stringify(btn));
    window.__currentBtnActions = btn.actions || [];

    function persistBtnDraft() {
        try {
            const cur = {
                label: $('#btn-label')?.value || '',
                style: $('#btn-style')?.value || 'primary',
                emoji: $('#btn-emoji')?.value || null,
                url: $('#btn-url')?.value || null,
                ephemeral: $('#btn-ephemeral')?.checked,
                actions: window.__currentBtnActions
            };
            localStorage.setItem(draftKey, JSON.stringify(cur));
            const ind = document.getElementById('btn-draft-indicator');
            if (ind) ind.style.display = '';
        } catch {}
    }

    const actionsHtml = (btn.actions || []).map((a, i) => `
        <div class="listi" style="display:block;margin-bottom:.5rem">
            <div class="row mb-1">
                <span class="tag">#${i+1} ${esc(a.type)}</span>
                <span class="spacer"></span>
                <button class="btn sm danger" onclick="window.__rmBtnAction(${i})">×</button>
            </div>
            ${a.type.includes('role') ? `<div class="text-xs">Role: <code>${esc(a.roleId || 'not set')}</code></div>` : ''}
            ${a.type === 'send_message' ? `<div class="text-xs">Message: ${esc((a.message || '').substring(0, 60))}</div>` : ''}
            ${a.type === 'send_dm' ? `<div class="text-xs">DM: ${esc((a.message || '').substring(0, 60))}</div>` : ''}
            ${a.type === 'create_ticket' ? `<div class="text-xs">Ticket: ${esc(a.ticketName || 'ticket-{user}')}</div>` : ''}
        </div>`).join('');

    const roleSel = `<select id="action-role"><option value="">— Select Role —</option>${state.roles.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>`;
    const chSel = `<select id="action-channel"><option value="">— Current Channel —</option>${state.channels.filter(c => c.type === 0 || c.type === 5).map(c => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`).join('')}</select>`;

    $('#page').innerHTML = `
        <div class="page-h">
            <div><h1>${isNew ? 'Create' : 'Edit'} Button</h1><p>${isNew ? 'Configure a new button.' : `Editing: <code>${esc(id)}</code>`}</p></div>
            <div class="row wrap">
                <button class="btn" onclick="pageButtonCreator()">${icon('home')} Back</button>
            </div>
        </div>

        <div id="btn-draft-indicator" class="row mb-2" style="${hasDraft ? '' : 'display:none'}">
            <span class="tag amber">⚠ Unsaved draft</span>
            <span class="text-sm text-mute">Auto-saved locally — won't be lost on refresh.</span>
        </div>

        <div class="card mb-2">
            <h3 class="mb-2">Button Settings</h3>
            ${isNew ? `<div class="form-row"><label>Button ID</label><input type="text" id="btn-id" value="${esc(id)}" placeholder="verify, support, rules"><div class="hint">Unique ID, lowercase, no spaces.</div></div>` : ''}
            <div class="form-row"><label>Label</label><input type="text" id="btn-label" value="${esc(btn.label || '')}" placeholder="Click Me"></div>
            <div class="form-row"><label>Style</label><select id="btn-style">${styles.map(s => `<option value="${esc(s)}" ${btn.style === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
            <div class="form-row"><label>Emoji</label><input type="text" id="btn-emoji" value="${esc(btn.emoji || '')}" placeholder="🔗 or <:name:id>"></div>
            <div class="form-row"><label>URL (link style only)</label><input type="url" id="btn-url" value="${esc(btn.url || '')}" placeholder="https://..."></div>
            <div class="switch-row"><div><div class="lbl">Ephemeral Response</div><div class="desc">Only the clicker sees the response.</div></div><label class="switch"><input type="checkbox" id="btn-ephemeral" ${btn.ephemeral !== false ? 'checked' : ''}><span class="slide"></span></label></div>
        </div>

        <div class="card mb-2">
            <h3 class="mb-2">Actions (${(btn.actions || []).length})</h3>
            <p class="text-sm text-mute mb-2">Actions execute when a user clicks this button.</p>
            ${actionsHtml || '<div class="text-sm text-mute">No actions yet.</div>'}
            <hr>
            <h3 class="mb-1">Add Action</h3>
            <div class="form-row"><label>Type</label><select id="action-type">${actionTypes.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div>
            <div id="action-fields">
                <div class="form-row"><label>Role</label>${roleSel}</div>
            </div>
            <div class="form-row"><label>Message (for send_message/send_dm)</label><textarea id="action-msg" rows="2" placeholder="Hello {user}!"></textarea></div>
            <div class="form-row"><label>Channel (for send_message)</label>${chSel}</div>
            <button class="btn sm mt-1" onclick="window.__addBtnAction()">${icon('user-plus')} Add Action</button>
        </div>

        <div class="save-bar">
            <div class="row"><span class="text-sm text-mute">Saves directly to bot. Button is live immediately.</span></div>
            <div class="row">
                <button class="btn" onclick="pageButtonCreator()">Cancel</button>
                <button class="btn primary" id="save-btn">${icon('check')} ${isNew ? 'Create' : 'Save'}</button>
            </div>
        </div>
    `;

    // Save handler
    $$('#page input, #page select, #page textarea').forEach(el => {
        el.addEventListener('input', persistBtnDraft);
        el.addEventListener('change', persistBtnDraft);
    });

    $('#save-btn').onclick = async () => {
        const btnId = isNew ? ($('#btn-id')?.value || '').toLowerCase().replace(/\s+/g, '-') : id;
        if (!btnId) return toast('Button ID required', 'error');
        const label = $('#btn-label').value;
        if (!label) return toast('Label required', 'error');
        const payload = {
            id: btnId, label,
            style: $('#btn-style').value,
            emoji: $('#btn-emoji').value || null,
            url: $('#btn-url').value || null,
            ephemeral: $('#btn-ephemeral').checked,
            actions: window.__currentBtnActions
        };
        const endpoint = isNew ? `/api/guild/${g.id}/buttons` : `/api/guild/${g.id}/buttons/${btnId}`;
        const method = isNew ? 'POST' : 'PUT';
        const r = await api(endpoint, { method, body: JSON.stringify(payload) });
        if (r && !r._error) {
            toast('Button saved!', 'success');
            try { localStorage.removeItem(draftKey); } catch {}
            pageButtonCreator();
        }
        else toast(r?.error || 'Save failed', 'error');
    };
}

window.__newBtn = () => {
    const g = state.currentGuild;
    renderButtonEditor(g, '', { label: '', style: 'primary', emoji: null, url: null, ephemeral: true, actions: [] }, true);
};
window.__editBtn = async (id) => {
    const g = state.currentGuild;
    const btns = await api(`/api/guild/${g.id}/buttons`);
    if (btns && btns[id]) renderButtonEditor(g, id, btns[id], false);
    else toast('Button not found', 'error');
};
window.__delBtn = async (id) => {
    if (!confirm(`Delete button "${id}"?`)) return;
    const g = state.currentGuild;
    const r = await api(`/api/guild/${g.id}/buttons/${id}`, { method: 'DELETE' });
    if (r && !r._error) { toast('Deleted', 'success'); pageButtonCreator(); }
    else toast('Delete failed', 'error');
};
window.__addBtnAction = () => {
    const type = $('#action-type').value;
    const action = { type };
    if (type.includes('role')) action.roleId = $('#action-role').value;
    if (type === 'send_message') { action.message = $('#action-msg').value; action.channelId = $('#action-channel').value || null; }
    if (type === 'send_dm') action.message = $('#action-msg').value;
    if (type === 'create_ticket') action.ticketName = 'ticket-{user}';
    window.__currentBtnActions.push(action);
    // Re-render editor
    const g = state.currentGuild;
    const id = $('#btn-id')?.value || '';
    const btn = { label: $('#btn-label').value, style: $('#btn-style').value, emoji: $('#btn-emoji').value, url: $('#btn-url').value, ephemeral: $('#btn-ephemeral').checked, actions: window.__currentBtnActions };
    renderButtonEditor(g, id, btn, !$('#btn-id')?.disabled);
};
window.__rmBtnAction = (idx) => {
    window.__currentBtnActions.splice(idx, 1);
    const g = state.currentGuild;
    const id = $('#btn-id')?.value || '';
    const btn = { label: $('#btn-label').value, style: $('#btn-style').value, emoji: $('#btn-emoji').value, url: $('#btn-url').value, ephemeral: $('#btn-ephemeral').checked, actions: window.__currentBtnActions };
    renderButtonEditor(g, id, btn, !$('#btn-id')?.disabled);
};
