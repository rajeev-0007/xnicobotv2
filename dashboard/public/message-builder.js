/* =========================================================
   xNico Dashboard — message-builder.js
   Build & send custom messages (Embed or CV2 container).
   Save as reusable templates. Send directly to any channel.
   ========================================================= */

function getMbDefaults() {
    return {
        mode: 'components',
        content: '',
        title: '',
        description: '',
        color: '#bcf1e4',
        images: [],
        thumbnail: '',
        footer: '',
        footerIcon: '',
        author: '',
        authorIcon: '',
        fields: [],
        colorless: false,
        imagePosition: 'bottom',
        buttonPosition: 'bottom',
        buttons: [],
        actionButtons: []
    };
}

async function pageMessageBuilder() {
    const g = state.currentGuild;
    const [channels, roles, customBtns, templates] = await Promise.all([
        api(`/api/guild/${g.id}/channels`),
        api(`/api/guild/${g.id}/roles`),
        api(`/api/guild/${g.id}/buttons`),
        api(`/api/guild/${g.id}/message-templates`),
    ]);
    state.channels = Array.isArray(channels) ? channels : [];
    state.roles    = Array.isArray(roles) ? roles.filter(r => r.name !== '@everyone') : [];
    state.customBtns = (customBtns && !customBtns._error) ? customBtns : {};
    state.msgTemplates = (templates && !templates._error) ? templates : {};

    // Draft recovery
    const draftKey = `draft:message-builder:${g.id}`;
    let data = getMbDefaults();
    let loadedTemplate = null;
    try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
            const draft = JSON.parse(raw);
            if (draft.__template) { loadedTemplate = draft.__template; delete draft.__template; }
            data = { ...getMbDefaults(), ...draft };
        }
    } catch { localStorage.removeItem(draftKey); }

    window.__mbWorking = data;
    window.__mbDraftKey = draftKey;
    window.__mbTemplate = loadedTemplate;
    _renderMbBody(g, data);
}

function _persistMbDraft() {
    try {
        if (!window.__mbDraftKey || !window.__mbWorking) return;
        const payload = { ...window.__mbWorking };
        if (window.__mbTemplate) payload.__template = window.__mbTemplate;
        localStorage.setItem(window.__mbDraftKey, JSON.stringify(payload));
    } catch {}
}

function _rerenderMbKeepScroll() {
    const y = window.scrollY;
    const g = state.currentGuild;
    _renderMbBody(g, window.__mbWorking);
    requestAnimationFrame(() => window.scrollTo(0, y));
}

function _renderMbBody(g, w) {
    const mode = w.mode || 'components';
    const isEmbed = mode === 'embed';
    const isCV2 = mode === 'components';
    const vis = (cond) => cond ? '' : 'style="display:none"';

    const tog = (key, val, label, desc, extra) =>
        `<div class="switch-row"><div><div class="lbl">${esc(label)}</div>${desc ? `<div class="desc">${esc(desc)}</div>` : ''}</div><label class="switch"><input type="checkbox" data-key="${esc(key)}" ${val ? 'checked' : ''} ${extra || ''}><span class="slide"></span></label></div>`;
    const sel = (key, val, opts) =>
        `<select data-key="${esc(key)}">${opts.map(o => `<option value="${esc(o)}" ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    const colorIn = (key, val) => {
        const v = val || '#bcf1e4';
        const hex = v.startsWith('#') ? v : '#bcf1e4';
        return `<div class="row"><input type="color" data-key="${esc(key)}" value="${esc(hex)}"><input type="text" data-key="${esc(key)}" value="${esc(v)}" placeholder="#bcf1e4" style="flex:1"></div>`;
    };

    // Image gallery editor
    const imagesHtml = (w.images || []).map((url, i) => `
        <div class="listi" style="display:block;margin-bottom:.4rem">
            <div class="row mb-1">
                <span class="tag">#${i+1}</span>
                <span class="spacer"></span>
                <button class="btn sm danger" onclick="window.__mbRmImg(${i})">×</button>
            </div>
            <input type="url" value="${esc(url)}" onchange="window.__mbEditImg(${i}, this.value)" placeholder="https://...">
        </div>
    `).join('');

    // Fields editor (for embed mode)
    const fieldsHtml = (w.fields || []).map((f, i) => `
        <div class="listi" style="display:block;margin-bottom:.4rem">
            <div class="row mb-1">
                <span class="tag">Field #${i+1}</span>
                <span class="spacer"></span>
                <button class="btn sm danger" onclick="window.__mbRmField(${i})">×</button>
            </div>
            <div class="form-row"><label>Name</label><input type="text" value="${esc(f.name||'')}" onchange="window.__mbEditField(${i}, 'name', this.value)" placeholder="Field name"></div>
            <div class="form-row"><label>Value</label><textarea rows="2" onchange="window.__mbEditField(${i}, 'value', this.value)" placeholder="Field value">${esc(f.value||'')}</textarea></div>
            <label class="switch"><input type="checkbox" ${f.inline?'checked':''} onchange="window.__mbEditField(${i}, 'inline', this.checked)"><span class="slide"></span></label>
            <span class="text-sm text-mute" style="margin-left:.5rem">Inline</span>
        </div>
    `).join('');

    // URL Buttons editor
    const urlButtonsHtml = (w.buttons || []).map((b, i) => `
        <div class="listi" style="display:block;margin-bottom:.4rem">
            <div class="row mb-1"><span class="tag">Button #${i+1}</span><span class="spacer"></span><button class="btn sm danger" onclick="window.__mbRmBtn(${i})">×</button></div>
            <div class="form-row"><label>Label</label><input type="text" value="${esc(b.label||'')}" onchange="window.__mbEditBtn(${i}, 'label', this.value)" placeholder="Click me"></div>
            <div class="form-row"><label>URL</label><input type="url" value="${esc(b.url||'')}" onchange="window.__mbEditBtn(${i}, 'url', this.value)" placeholder="https://..."></div>
            <div class="form-row"><label>Emoji</label><input type="text" value="${esc(b.emoji||'')}" onchange="window.__mbEditBtn(${i}, 'emoji', this.value)" placeholder="🔗"></div>
        </div>
    `).join('');

    // Custom action button picker (reuse state.customBtns)
    const styleColors = { primary:'#5865F2', secondary:'#4f545c', success:'#57f287', danger:'#ed4245', link:'#00b0f4' };
    const selectedActionBtns = (w.actionButtons || []).map(id => {
        const b = state.customBtns[id];
        if (!b) return '';
        const color = styleColors[b.style] || '#5865F2';
        return `<span class="chip" style="border-color:${color}40;color:${color}">${b.emoji?esc(b.emoji)+' ':''}${esc(b.label)} <button onclick="window.__mbRmActionBtn('${esc(id)}')">×</button></span>`;
    }).join('');

    const availableActionBtns = Object.entries(state.customBtns).filter(([id]) => !(w.actionButtons || []).includes(id));
    const actionBtnPicker = availableActionBtns.length ? `
        <div class="form-row"><label>Attach Custom Button</label>
            <select id="mb-ab-select"><option value="">— Pick a button —</option>${availableActionBtns.map(([id, b]) => `<option value="${esc(id)}">${esc(b.emoji||'')} ${esc(b.label)} (${esc(b.style)})</option>`).join('')}</select>
            <button class="btn sm mt-1" onclick="window.__mbAddActionBtn()">${icon('user-plus')} Attach</button>
        </div>
    ` : `<p class="text-sm text-mute">No more custom buttons to attach. <a href="#/server/${esc(g.id)}/button-commands">Create some</a> first.</p>`;

    // Templates list
    const tplNames = Object.keys(state.msgTemplates || {});
    const templatesHtml = tplNames.length ? tplNames.map(name => `
        <div class="listi" style="display:block;margin-bottom:.4rem">
            <div class="row">
                <span class="tag">${esc(name)}</span>
                <span class="text-xs text-mute">${esc((state.msgTemplates[name].mode || 'components'))}</span>
                <span class="spacer"></span>
                <button class="btn sm" onclick="window.__mbLoadTemplate('${esc(name.replace(/'/g, "\\'"))}')" title="Load">📥</button>
                <button class="btn sm danger" onclick="window.__mbDelTemplate('${esc(name.replace(/'/g, "\\'"))}')" title="Delete">×</button>
            </div>
        </div>
    `).join('') : '<p class="text-sm text-mute">No templates saved yet.</p>';

    // Channel picker
    const textChannels = state.channels.filter(c => c.type === 0 || c.type === 5);
    const channelPicker = `<select id="mb-send-channel"><option value="">— Pick channel —</option>${textChannels.map(c => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`).join('')}</select>`;

    const html = `
        <div class="page-h">
            <div><h1>Message Builder</h1><p>Create and send custom messages on ${esc(g.name)}. ${window.__mbTemplate ? `Loaded template: <code>${esc(window.__mbTemplate)}</code>` : ''}</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div>
        </div>

        <!-- MODE -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('chat')}</div><div class="tt"><div class="t">Mode</div><div class="s">Classic embed or modern Components V2 container.</div></div></div>
            <div class="form-row"><label>Display Mode</label>${sel('mode', mode, ['components','embed'])}<div class="hint">Components V2 = modern rich containers. Embed = classic embed with fields.</div></div>
        </div>

        <!-- CONTENT -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('chat')}</div><div class="tt"><div class="t">Content</div><div class="s">The text shown in the message body.</div></div></div>
            <div id="mb-content-cv2" ${vis(isCV2)}>
                <div class="form-row"><textarea data-key="content" rows="5" placeholder="Hello world! Use {separator} for dividers.">${esc(w.content||'')}</textarea>
                <div class="hint">Markdown supported. Variables: {user}, {server}, {membercount}, etc. Separators: {separator}, {separator:small/medium/large}</div></div>
            </div>
            <div id="mb-content-embed" ${vis(isEmbed)}>
                <div class="form-row"><label>Title</label><input type="text" data-key="title" value="${esc(w.title||'')}" placeholder="Announcement Title"></div>
                <div class="form-row"><label>Description</label><textarea data-key="description" rows="4" placeholder="Main body text...">${esc(w.description||'')}</textarea></div>
            </div>
        </div>

        <!-- APPEARANCE -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('settings')}</div><div class="tt"><div class="t">Appearance</div><div class="s">Colors, images, thumbnail.</div></div></div>
            <div class="form-row"><label>${isEmbed ? 'Embed Color' : 'Accent Color'}</label>${colorIn('color', w.color)}</div>
            <div id="mb-colorless" ${vis(isCV2)}>${tog('colorless', w.colorless, 'Colorless Mode', 'Remove accent color from CV2 container.')}</div>
            <hr>
            <div class="form-row"><label>Thumbnail URL</label><input type="url" data-key="thumbnail" value="${esc(w.thumbnail||'')}" placeholder="{useravatar} or https://..."></div>
            <div id="mb-images" ${vis(isCV2)}>
                <h4 class="mb-1">Images (CV2 gallery)</h4>
                ${imagesHtml || '<p class="text-sm text-mute">No images.</p>'}
                <div class="row">
                    <input type="url" id="mb-img-input" placeholder="https://..." style="flex:1">
                    <button class="btn sm" onclick="window.__mbAddImg()">${icon('user-plus')} Add</button>
                </div>
                <div class="form-row mt-2"><label>Image Position</label>${sel('imagePosition', w.imagePosition || 'bottom', ['top','bottom','side'])}</div>
            </div>
            <div id="mb-image-single" ${vis(isEmbed)}>
                <div class="form-row mt-2"><label>Image URL (single)</label><input type="url" id="mb-embed-image" value="${esc((w.images && w.images[0]) || w.image || '')}" onchange="window.__mbSetSingleImg(this.value)" placeholder="https://..."></div>
            </div>
        </div>

        <!-- AUTHOR / FOOTER -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('user')}</div><div class="tt"><div class="t">Author & Footer</div><div class="s">Extra metadata around the message.</div></div></div>
            <div class="form-row"><label>Author Name</label><input type="text" data-key="author" value="${esc(w.author||'')}" placeholder="{displayname}"></div>
            <div class="form-row"><label>Author Icon URL</label><input type="url" data-key="authorIcon" value="${esc(w.authorIcon||'')}" placeholder="{useravatar}"></div>
            <hr>
            <div class="form-row"><label>Footer Text</label><input type="text" data-key="footer" value="${esc(w.footer||'')}" placeholder="Posted at {time}"></div>
            <div class="form-row"><label>Footer Icon URL</label><input type="url" data-key="footerIcon" value="${esc(w.footerIcon||'')}" placeholder="https://..."></div>
        </div>

        <!-- FIELDS (embed only) -->
        <div id="mb-fields-card" class="card mb-2" ${vis(isEmbed)}>
            <div class="card-h"><div class="ic">${icon('grid')}</div><div class="tt"><div class="t">Embed Fields</div><div class="s">Up to 25 name/value fields.</div></div></div>
            ${fieldsHtml || '<p class="text-sm text-mute">No fields yet.</p>'}
            <button class="btn sm" onclick="window.__mbAddField()">${icon('user-plus')} Add Field</button>
        </div>

        <!-- BUTTONS -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('link')}</div><div class="tt"><div class="t">Buttons</div><div class="s">URL buttons + custom action buttons from Button Creator.</div></div></div>
            <div class="form-row"><label>Button Position</label>${sel('buttonPosition', w.buttonPosition || 'bottom', ['top','bottom'])}</div>
            <hr>
            <h4 class="mb-1">URL Buttons</h4>
            ${urlButtonsHtml || '<p class="text-sm text-mute">No URL buttons.</p>'}
            <button class="btn sm" onclick="window.__mbAddBtn()">${icon('user-plus')} Add URL Button</button>
            <hr>
            <h4 class="mb-1">Custom Action Buttons</h4>
            <div class="chips mb-2">${selectedActionBtns || '<span class="text-sm text-mute">None attached.</span>'}</div>
            ${actionBtnPicker}
        </div>

        <!-- TEMPLATES -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('grid')}</div><div class="tt"><div class="t">Templates</div><div class="s">Save this message as a reusable template.</div></div></div>
            <div class="row mb-2">
                <input type="text" id="mb-tpl-name" placeholder="Template name" value="${esc(window.__mbTemplate || '')}" style="flex:1">
                <button class="btn sm primary" onclick="window.__mbSaveTemplate()">${icon('check')} Save as Template</button>
            </div>
            <h4 class="mb-1">Saved Templates</h4>
            ${templatesHtml}
        </div>

        <!-- SEND -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('chat')}</div><div class="tt"><div class="t">Send Message</div><div class="s">Send directly to any channel. Bot sends as itself.</div></div></div>
            <div class="form-row"><label>Target Channel</label>${channelPicker}</div>
            <button class="btn primary" onclick="window.__mbSend()">${icon('check')} Send Message</button>
        </div>

        <div class="save-bar">
            <div class="row">
                <span class="tag grey">Mode: ${esc(mode)}</span>
                <span class="text-sm text-mute">Draft auto-saved locally. Save as template to reuse.</span>
            </div>
            <div class="row">
                <button class="btn danger" id="mb-clear-btn">${icon('log')} Clear Draft</button>
            </div>
        </div>
    `;

    $('#page').innerHTML = html;
    bindFormInputs(w);

    // Mode switch
    const modeEl = document.querySelector('#page select[data-key="mode"]');
    if (modeEl) modeEl.addEventListener('change', () => {
        const isE = modeEl.value === 'embed';
        document.getElementById('mb-content-cv2').style.display = isE ? 'none' : '';
        document.getElementById('mb-content-embed').style.display = isE ? '' : 'none';
        document.getElementById('mb-colorless').style.display = isE ? 'none' : '';
        document.getElementById('mb-images').style.display = isE ? 'none' : '';
        document.getElementById('mb-image-single').style.display = isE ? '' : 'none';
        document.getElementById('mb-fields-card').style.display = isE ? '' : 'none';
        _persistMbDraft();
    });

    // Autosave
    let pt;
    $('#page').addEventListener('input', () => { clearTimeout(pt); pt = setTimeout(_persistMbDraft, 250); });
    $('#page').addEventListener('change', () => { clearTimeout(pt); pt = setTimeout(_persistMbDraft, 100); });

    $('#mb-clear-btn').onclick = () => {
        if (!confirm('Clear the entire draft and start fresh?')) return;
        try { localStorage.removeItem(window.__mbDraftKey); } catch {}
        window.__mbTemplate = null;
        window.__mbWorking = getMbDefaults();
        _rerenderMbKeepScroll();
    };
}

// ── Image handlers ──
window.__mbAddImg = () => {
    const inp = $('#mb-img-input');
    const v = (inp.value || '').trim();
    if (!v) return toast('Enter a URL', 'error');
    if (!/^https?:\/\//.test(v)) return toast('URL must start with http(s)://', 'error');
    window.__mbWorking.images = window.__mbWorking.images || [];
    window.__mbWorking.images.push(v);
    inp.value = '';
    _persistMbDraft();
    _rerenderMbKeepScroll();
};
window.__mbRmImg = (i) => {
    window.__mbWorking.images.splice(i, 1);
    _persistMbDraft();
    _rerenderMbKeepScroll();
};
window.__mbEditImg = (i, v) => {
    window.__mbWorking.images[i] = v;
    _persistMbDraft();
};
window.__mbSetSingleImg = (v) => {
    window.__mbWorking.images = v ? [v] : [];
    _persistMbDraft();
};

// ── Fields handlers ──
window.__mbAddField = () => {
    window.__mbWorking.fields = window.__mbWorking.fields || [];
    if (window.__mbWorking.fields.length >= 25) return toast('Max 25 fields', 'error');
    window.__mbWorking.fields.push({ name: '', value: '', inline: false });
    _persistMbDraft();
    _rerenderMbKeepScroll();
};
window.__mbRmField = (i) => {
    window.__mbWorking.fields.splice(i, 1);
    _persistMbDraft();
    _rerenderMbKeepScroll();
};
window.__mbEditField = (i, key, value) => {
    window.__mbWorking.fields[i][key] = value;
    _persistMbDraft();
};

// ── URL buttons ──
window.__mbAddBtn = () => {
    window.__mbWorking.buttons = window.__mbWorking.buttons || [];
    if (window.__mbWorking.buttons.length >= 5) return toast('Max 5 URL buttons', 'error');
    window.__mbWorking.buttons.push({ label: '', url: '', emoji: '' });
    _persistMbDraft();
    _rerenderMbKeepScroll();
};
window.__mbRmBtn = (i) => {
    window.__mbWorking.buttons.splice(i, 1);
    _persistMbDraft();
    _rerenderMbKeepScroll();
};
window.__mbEditBtn = (i, key, value) => {
    window.__mbWorking.buttons[i][key] = value;
    _persistMbDraft();
};

// ── Action buttons (from Button Creator) ──
window.__mbAddActionBtn = () => {
    const sel = $('#mb-ab-select');
    if (!sel || !sel.value) return;
    window.__mbWorking.actionButtons = window.__mbWorking.actionButtons || [];
    if (!window.__mbWorking.actionButtons.includes(sel.value)) {
        window.__mbWorking.actionButtons.push(sel.value);
    }
    _persistMbDraft();
    _rerenderMbKeepScroll();
};
window.__mbRmActionBtn = (id) => {
    window.__mbWorking.actionButtons = (window.__mbWorking.actionButtons || []).filter(x => x !== id);
    _persistMbDraft();
    _rerenderMbKeepScroll();
};

// ── Templates ──
window.__mbSaveTemplate = async () => {
    const name = ($('#mb-tpl-name').value || '').trim();
    if (!name) return toast('Template name required', 'error');
    const g = state.currentGuild;
    const existing = state.msgTemplates[name];
    const r = await api(existing ? `/api/guild/${g.id}/message-templates/${encodeURIComponent(name)}` : `/api/guild/${g.id}/message-templates`, {
        method: existing ? 'PUT' : 'POST',
        body: JSON.stringify(existing ? window.__mbWorking : { name, template: window.__mbWorking })
    });
    if (r && !r._error) {
        toast(`Template "${name}" saved`, 'success');
        window.__mbTemplate = name;
        state.msgTemplates = await api(`/api/guild/${g.id}/message-templates`);
        _rerenderMbKeepScroll();
    } else {
        toast(r?.error || 'Save failed', 'error');
    }
};
window.__mbLoadTemplate = (name) => {
    const tpl = state.msgTemplates[name];
    if (!tpl) return;
    window.__mbWorking = { ...getMbDefaults(), ...tpl };
    window.__mbTemplate = name;
    _persistMbDraft();
    _rerenderMbKeepScroll();
    toast(`Loaded template "${name}"`, 'success');
};
window.__mbDelTemplate = async (name) => {
    if (!confirm(`Delete template "${name}"?`)) return;
    const g = state.currentGuild;
    const r = await api(`/api/guild/${g.id}/message-templates/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (r && !r._error) {
        toast('Template deleted', 'success');
        if (window.__mbTemplate === name) window.__mbTemplate = null;
        state.msgTemplates = await api(`/api/guild/${g.id}/message-templates`);
        _rerenderMbKeepScroll();
    } else {
        toast(r?.error || 'Delete failed', 'error');
    }
};

// ── Send ──
window.__mbSend = async () => {
    const channelId = $('#mb-send-channel').value;
    if (!channelId) return toast('Pick a channel', 'error');
    const g = state.currentGuild;
    const btn = event?.target?.closest('button');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    const r = await api(`/api/guild/${g.id}/send-message`, {
        method: 'POST',
        body: JSON.stringify({ channelId, template: window.__mbWorking })
    });
    if (btn) { btn.disabled = false; btn.innerHTML = icon('check') + ' Send Message'; }
    if (r && !r._error) {
        toast(`Sent! Message ID: ${r.messageId}`, 'success');
    } else {
        toast(r?.error || 'Send failed', 'error');
    }
};
