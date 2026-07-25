/* =========================================================
   xNico Dashboard — tickets.js
   Ticket system: categories, support role, panel channel,
   open tickets list, category CRUD.
   Syncs to jsonStore 'tickets' used by the bot.
   ========================================================= */

// Global Tickets event handlers
window.__saveTickets = async function() {
    try {
        const g = state.currentGuild;
        const payload = window.__working || {};
        toast('Saving Tickets config...', 'info');
        const res = await api(`/api/guild/${g.id}/tickets`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        if (res._error) {
            toast(`Failed: ${res.error || 'Unknown error'}`, 'error');
        } else {
            toast('Tickets saved!', 'success');
            localStorage.removeItem(`draft:tickets:${g.id}`);
        }
    } catch (e) {
        toast(`Error: ${e.message}`, 'error');
    }
};

window.__addTicketPanel = function() {
    const g = state.currentGuild;
    const cfg = window.__working || {};
    if (!cfg.panels) cfg.panels = [];
    cfg.panels.push({ name: 'New Panel', category: '', button: 'Create Ticket' });
    window.__working = cfg;
    localStorage.setItem(`draft:tickets:${g.id}`, JSON.stringify(cfg));
    if (window.__renderModule) window.__renderModule();
};

window.__delTicketPanel = function(idx) {
    const g = state.currentGuild;
    const cfg = window.__working || {};
    if (cfg.panels) cfg.panels.splice(idx, 1);
    window.__working = cfg;
    localStorage.setItem(`draft:tickets:${g.id}`, JSON.stringify(cfg));
    if (window.__renderModule) window.__renderModule();
};

async function pageTickets() {
    const g = state.currentGuild;
    const [cfg, channels, roles, openTickets, historyTickets] = await Promise.all([
        api(`/api/guild/${g.id}/tickets-config`),
        api(`/api/guild/${g.id}/channels`),
        api(`/api/guild/${g.id}/roles`),
        api(`/api/guild/${g.id}/tickets-open`),
        api(`/api/guild/${g.id}/tickets-history`),
    ]);
    state.channels = Array.isArray(channels) ? channels : [];
    state.roles    = Array.isArray(roles) ? roles.filter(r => r.name !== '@everyone') : [];

    const w = cfg && !cfg._error ? cfg : { configured: false, channelId: null, categoryId: null, supportRoleId: null, categories: [], openTickets: 0 };
    const tickets = Array.isArray(openTickets) ? openTickets : [];
    const history = Array.isArray(historyTickets) ? historyTickets : [];

    window.__ticketWorking = structuredClone(w);
    if (!window.__ticketWorking.panelMessage) window.__ticketWorking.panelMessage = { mode: 'components', color: '#5865F2', content: '' };
    if (!window.__ticketWorking.welcomeMessage) window.__ticketWorking.welcomeMessage = { mode: 'components', color: '#5865F2', content: '' };
    
    window.__ticketHistory = history;
    _renderTicketsBody(g, window.__ticketWorking, tickets, history);
}

function _tkGetEmbedInput(prefix, key) {
    const el = document.getElementById(`tk-${prefix}-${key}`);
    return el ? el.value : undefined;
}

function _rerenderTicketsKeepScroll() {
    const y = window.scrollY;
    const g = state.currentGuild;
    _renderTicketsBody(g, window.__ticketWorking, [], window.__ticketHistory || []);
    requestAnimationFrame(() => window.scrollTo(0, y));
}

function _renderTicketsBody(g, w, tickets, history) {
    const textChannels = state.channels.filter(c => c.type === 0 || c.type === 5);
    const categories = state.channels.filter(c => c.type === 4);

    const chSel = (id, val, list) => {
        const opts = list.map(c => {
            const label = c.type === 4 ? '📁 ' : '#';
            return `<option value="${esc(c.id)}" ${val === c.id ? 'selected' : ''}>${label}${esc(c.name)}</option>`;
        }).join('');
        return `<select id="${id}"><option value="">— None —</option>${opts}</select>`;
    };
    const roleSel = (id, val) => {
        const opts = state.roles.map(r => `<option value="${esc(r.id)}" ${val === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
        return `<select id="${id}"><option value="">— None —</option>${opts}</select>`;
    };
    
    const colorIn = (id, val) => `<div class="row"><input type="color" id="${id}-c" value="${esc(val||'#5865F2')}" oninput="document.getElementById('${id}').value=this.value; window.__tkUpdatePreview()"><input type="text" id="${id}" value="${esc(val||'#5865F2')}" style="flex:1" oninput="document.getElementById('${id}-c').value=this.value; window.__tkUpdatePreview()"></div>`;
    const vis = (cond) => cond ? '' : 'style="display:none"';

    const buildEmbedEditorHtml = (prefix, title, desc, obj) => `
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('chat')}</div><div class="tt"><div class="t">${title}</div><div class="s">${desc}</div></div></div>
            <div class="form-row"><label>Display Mode</label>
                <select id="tk-${prefix}-mode" onchange="document.getElementById('tk-${prefix}-embed').style.display=this.value==='embed'?'':'none'; window.__tkUpdatePreview()">
                    <option value="components" ${obj.mode==='components'?'selected':''}>Components V2 (Modern)</option>
                    <option value="embed" ${obj.mode==='embed'?'selected':''}>Embed (Classic)</option>
                </select>
            </div>
            <div class="form-row"><label>Message Content</label><textarea id="tk-${prefix}-content" rows="3" oninput="window.__tkUpdatePreview()" placeholder="Markdown supported">${esc(obj.content||'')}</textarea></div>
            <div id="tk-${prefix}-embed" ${vis(obj.mode==='embed')}>
                <div class="form-row mt-2"><label>Embed Color</label>${colorIn(`tk-${prefix}-color`, obj.color)}</div>
                <div class="form-row"><label>Title</label><input type="text" id="tk-${prefix}-title" value="${esc(obj.title||'')}" oninput="window.__tkUpdatePreview()"></div>
                <div class="form-row"><label>Description</label><textarea id="tk-${prefix}-description" rows="3" oninput="window.__tkUpdatePreview()">${esc(obj.description||'')}</textarea></div>
                <div class="form-row"><label>Author</label><input type="text" id="tk-${prefix}-author" value="${esc(obj.author||'')}" oninput="window.__tkUpdatePreview()"></div>
                <div class="form-row"><label>Footer</label><input type="text" id="tk-${prefix}-footer" value="${esc(obj.footer||'')}" oninput="window.__tkUpdatePreview()"></div>
                <div class="form-row"><label>Image URL</label><input type="url" id="tk-${prefix}-image" value="${esc(obj.image||'')}" oninput="window.__tkUpdatePreview()"></div>
                <div class="form-row"><label>Thumbnail URL</label><input type="url" id="tk-${prefix}-thumbnail" value="${esc(obj.thumbnail||'')}" oninput="window.__tkUpdatePreview()"></div>
            </div>
            <div id="tk-${prefix}-preview-container" class="mt-2 p-2" style="background:var(--bg-card-alt); border-radius:8px"></div>
        </div>
    `;

    // Categories editor
    const catsHtml = (w.categories || []).map((cat, i) => `
        <div class="listi" style="display:block;margin-bottom:.5rem">
            <div class="row mb-1">
                <span style="font-size:1.2rem">${esc(cat.emoji || '🎫')}</span>
                <span class="bold">${esc(cat.label)}</span>
                <span class="text-xs text-mute mono">${esc(cat.id)}</span>
                <span class="spacer"></span>
                <button class="btn sm danger" onclick="window.__ticketRmCat(${i})">×</button>
            </div>
            ${cat.description ? `<div class="text-xs text-mute">${esc(cat.description)}</div>` : ''}
        </div>
    `).join('') || '<div class="text-sm text-mute">No categories. Add at least one for the ticket panel to work.</div>';

    // Open tickets table
    const ticketsHtml = tickets.length ? `
        <table class="tbl">
            <thead><tr><th>Channel</th><th>User</th><th>Category</th><th>Created</th></tr></thead>
            <tbody>${tickets.map(t => {
                const ch = state.channels.find(c => c.id === t.channelId);
                return `<tr>
                    <td>${ch ? '#' + esc(ch.name) : `<code>${esc(t.channelId)}</code>`}</td>
                    <td class="mono text-xs">${esc(t.userId)}</td>
                    <td><span class="tag">${esc(t.category)}</span></td>
                    <td class="text-xs">${t.createdAt ? new Date(t.createdAt).toLocaleString() : '—'}</td>
                </tr>`;
            }).join('')}</tbody>
        </table>
    ` : '<div class="text-sm text-mute">No open tickets right now.</div>';

    // History tickets table
    const historyHtml = history.length ? `
        <table class="tbl">
            <thead><tr><th>Channel</th><th>Opener</th><th>Category</th><th>Closed By</th><th>Closed</th><th>Transcript</th></tr></thead>
            <tbody>${[...history].reverse().slice(0, 50).map(t => {
                const transcriptBtn = (t.logChannelId && t.logMessageId)
                    ? `<a href="/api/guild/${g.id}/transcript/${t.logChannelId}/${t.logMessageId}" target="_blank" class="btn sm primary">${icon('link')} View</a>`
                    : `<span class="text-xs text-mute">N/A</span>`;
                return `<tr>
                    <td>#${esc(t.channelName || t.channelId)}</td>
                    <td class="mono text-xs">${esc(t.openerTag || t.openerId)}</td>
                    <td><span class="tag">${esc(t.categoryLabel || 'General')}</span></td>
                    <td class="text-xs">${esc(t.closedBy || 'Unknown')}</td>
                    <td class="text-xs">${t.closedAt ? new Date(t.closedAt).toLocaleString() : '—'}</td>
                    <td>${transcriptBtn}</td>
                </tr>`;
            }).join('')}</tbody>
        </table>
    ` : '<div class="text-sm text-mute">No closed tickets in history yet.</div>';

    const html = `
        <div class="page-h">
            <div><h1>Tickets</h1><p>Support ticket system for ${esc(g.name)}.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div>
        </div>

        <!-- STATUS -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('ticket')}</div><div class="tt"><div class="t">Ticket System</div><div class="s">${w.configured ? 'Configured and active.' : 'Not configured yet. Set up below.'}</div></div></div>
            <div class="grid g-3 mt-2">
                <div class="stat purple"><div class="ic">${icon('ticket')}</div><div><div class="v">${w.openTickets || tickets.length}</div><div class="l">Open</div></div></div>
                <div class="stat cyan"><div class="ic">${icon('hash')}</div><div><div class="v">${w.nextTicketNumber || 0}</div><div class="l">Total Created</div></div></div>
                <div class="stat green"><div class="ic">${icon('grid')}</div><div><div class="v">${(w.categories || []).length}</div><div class="l">Categories</div></div></div>
            </div>
        </div>

        <!-- SETUP -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('settings')}</div><div class="tt"><div class="t">Configuration</div><div class="s">Where the panel is posted, where tickets are created, and who handles them.</div></div></div>
            <div class="form-row"><label>Panel Channel</label>${chSel('tk-panel-ch', w.channelId, textChannels)}<div class="hint">The channel where the ticket panel (with category dropdown) is posted.</div></div>
            <div class="form-row"><label>Ticket Category (folder)</label>${chSel('tk-category', w.categoryId, categories)}<div class="hint">Discord category folder where new ticket channels are created.</div></div>
            <div class="form-row"><label>Support Role</label>${roleSel('tk-support', w.supportRoleId)}<div class="hint">This role gets access to all ticket channels.</div></div>
        </div>

        <!-- PANEL CUSTOMIZATION -->
        ${buildEmbedEditorHtml('pm', 'Panel Customization', 'Customize the message that users see in the Panel Channel.', w.panelMessage)}

        <!-- WELCOME MESSAGE -->
        ${buildEmbedEditorHtml('wm', 'Welcome Message', 'Customize the message sent when a new ticket channel is opened.', w.welcomeMessage)}

        <!-- CATEGORIES -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('grid')}</div><div class="tt"><div class="t">Ticket Categories (${(w.categories||[]).length})</div><div class="s">Users pick a category from the dropdown when opening a ticket.</div></div></div>
            ${catsHtml}
            <hr>
            <h4 class="mb-1">Add Category</h4>
            <div class="grid g-2">
                <div class="form-row"><label>Label</label><input type="text" id="tk-cat-label" placeholder="General Support"></div>
                <div class="form-row"><label>Emoji</label><input type="text" id="tk-cat-emoji" placeholder="🎫" value="🎫"></div>
            </div>
            <div class="form-row"><label>Description</label><input type="text" id="tk-cat-desc" placeholder="Get help with general questions"></div>
            <button class="btn sm" onclick="window.__ticketAddCat()">${icon('user-plus')} Add Category</button>
        </div>

        <!-- OPEN TICKETS -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('chat')}</div><div class="tt"><div class="t">Open Tickets (${tickets.length})</div><div class="s">Currently active ticket channels.</div></div></div>
            ${ticketsHtml}
            <div class="hint mt-2">Close tickets via the Close button inside each ticket channel in Discord.</div>
        </div>

        <!-- TICKET HISTORY -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('clock')}</div><div class="tt"><div class="t">Ticket History (${history.length})</div><div class="s">Recently closed tickets.</div></div></div>
            ${historyHtml}
        </div>

        <!-- INFO -->
        <div class="card mb-2" style="font-size:.85rem">
            <h3>How It Works</h3>
            <ol style="padding-left:1.2rem;margin:.5rem 0;line-height:1.8">
                <li>Bot posts a panel with a category dropdown in the <b>Panel Channel</b></li>
                <li>User selects a category → bot creates a private channel in the <b>Ticket Category</b> folder</li>
                <li>The <b>Support Role</b> and the user get access to the channel</li>
                <li>Staff can claim, close, or save transcripts using buttons in the ticket</li>
            </ol>
            <div class="hint">You can fully customize the Panel and Welcome messages in the sections above, or using the <code>/ticket-setup panel</code> and <code>/ticket-setup message</code> commands in Discord.</div>
        </div>

        <!-- SAVE -->
        <div class="save-bar">
            <div class="row"><span class="tag ${w.configured ? 'green' : 'grey'}">${w.configured ? 'Active' : 'Not Set Up'}</span></div>
            <div class="row">
                <button class="btn" id="tk-deploy">${icon('chat')} Send Panel to Discord</button>
                <button class="btn primary" id="tk-save">${icon('check')} Save</button>
            </div>
        </div>
    `;

    $('#page').innerHTML = html;

    // Save handler
    $('#tk-save').onclick = async () => {
        window.__tkSyncToWorking();
        const btn = $('#tk-save'); btn.disabled = true; btn.textContent = 'Saving…';
        const payload = {
            channelId: window.__ticketWorking.channelId,
            categoryId: window.__ticketWorking.categoryId,
            supportRoleId: window.__ticketWorking.supportRoleId,
            categories: window.__ticketWorking.categories || [],
            panelMessage: window.__ticketWorking.panelMessage,
            welcomeMessage: window.__ticketWorking.welcomeMessage
        };
        const r = await api(`/api/guild/${g.id}/tickets-config`, { method: 'PUT', body: JSON.stringify(payload) });
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (r && !r._error) toast('Tickets saved!', 'success');
        else toast(r?.error || 'Save failed', 'error');
    };

    // Deploy handler — saves the current config, then asks the bot to post the panel.
    $('#tk-deploy').onclick = async () => {
        window.__tkSyncToWorking();
        const chId = window.__ticketWorking.channelId;
        if (!chId) return toast('Pick a Panel Channel first', 'error');
        if (!(window.__ticketWorking.categories || []).length) {
            return toast('Add at least one ticket category first', 'error');
        }
        const btn = $('#tk-deploy'); const orig = btn.innerHTML;
        btn.disabled = true; btn.innerHTML = icon('refresh') + ' Deploying…';
        
        await api(`/api/guild/${g.id}/tickets-config`, {
            method: 'PUT',
            body: JSON.stringify({
                channelId: chId,
                categoryId: window.__ticketWorking.categoryId,
                supportRoleId: window.__ticketWorking.supportRoleId,
                categories: window.__ticketWorking.categories || [],
                panelMessage: window.__ticketWorking.panelMessage,
                welcomeMessage: window.__ticketWorking.welcomeMessage
            })
        }).catch(() => {});
        await deployPanel(g.id, 'tickets', chId);
        btn.disabled = false; btn.innerHTML = orig;
    };
    
    // Preview updater
    window.__tkSyncToWorking = () => {
        window.__ticketWorking.channelId = $('#tk-panel-ch').value || null;
        window.__ticketWorking.categoryId = $('#tk-category').value || null;
        window.__ticketWorking.supportRoleId = $('#tk-support').value || null;
        
        const rMsg = (prefix) => ({
            mode: _tkGetEmbedInput(prefix, 'mode'),
            content: _tkGetEmbedInput(prefix, 'content'),
            title: _tkGetEmbedInput(prefix, 'title'),
            description: _tkGetEmbedInput(prefix, 'description'),
            color: _tkGetEmbedInput(prefix, 'color'),
            image: _tkGetEmbedInput(prefix, 'image'),
            thumbnail: _tkGetEmbedInput(prefix, 'thumbnail'),
            author: _tkGetEmbedInput(prefix, 'author'),
            footer: _tkGetEmbedInput(prefix, 'footer')
        });
        window.__ticketWorking.panelMessage = rMsg('pm');
        window.__ticketWorking.welcomeMessage = rMsg('wm');
    };
    
    window.__tkUpdatePreview = () => {
        if (!window.buildDiscordPreview) return;
        window.__tkSyncToWorking();
        const pCont = document.getElementById('tk-pm-preview-container');
        if (pCont) {
            const cfg = structuredClone(window.__ticketWorking.panelMessage);
            pCont.innerHTML = '<div class="text-xs text-mute mb-1">Panel Preview</div>' + buildDiscordPreview(cfg, state.botInfo);
        }
        const wCont = document.getElementById('tk-wm-preview-container');
        if (wCont) {
            const cfg = structuredClone(window.__ticketWorking.welcomeMessage);
            cfg.content = (cfg.content||'').replaceAll('{user}','@User').replaceAll('{server}',g.name);
            cfg.title = (cfg.title||'').replaceAll('{server}',g.name);
            wCont.innerHTML = '<div class="text-xs text-mute mb-1">Welcome Message Preview</div>' + buildDiscordPreview(cfg, state.botInfo);
        }
    };
    
    setTimeout(window.__tkUpdatePreview, 100);
}

// Category CRUD
window.__ticketAddCat = () => {
    const label = ($('#tk-cat-label').value || '').trim();
    const emoji = ($('#tk-cat-emoji').value || '🎫').trim();
    const description = ($('#tk-cat-desc').value || '').trim();
    if (!label) return toast('Label required', 'error');
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32);
    const w = window.__ticketWorking;
    if (!w.categories) w.categories = [];
    if (w.categories.some(c => c.id === id)) return toast('Category with this ID already exists', 'error');
    w.categories.push({ id, label, emoji, description });
    _rerenderTicketsKeepScroll();
};
window.__ticketRmCat = (idx) => {
    window.__ticketWorking.categories.splice(idx, 1);
    _rerenderTicketsKeepScroll();
};
