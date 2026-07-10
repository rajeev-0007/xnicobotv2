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
    const [cfg, channels, roles, openTickets] = await Promise.all([
        api(`/api/guild/${g.id}/tickets-config`),
        api(`/api/guild/${g.id}/channels`),
        api(`/api/guild/${g.id}/roles`),
        api(`/api/guild/${g.id}/tickets-open`),
    ]);
    state.channels = Array.isArray(channels) ? channels : [];
    state.roles    = Array.isArray(roles) ? roles.filter(r => r.name !== '@everyone') : [];

    const w = cfg && !cfg._error ? cfg : { configured: false, channelId: null, categoryId: null, supportRoleId: null, categories: [], openTickets: 0 };
    const tickets = Array.isArray(openTickets) ? openTickets : [];

    window.__ticketWorking = structuredClone(w);
    _renderTicketsBody(g, window.__ticketWorking, tickets);
}

function _rerenderTicketsKeepScroll() {
    const y = window.scrollY;
    const g = state.currentGuild;
    _renderTicketsBody(g, window.__ticketWorking, []);
    requestAnimationFrame(() => window.scrollTo(0, y));
}

function _renderTicketsBody(g, w, tickets) {
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

        <!-- INFO -->
        <div class="card mb-2" style="font-size:.85rem">
            <h3>How It Works</h3>
            <ol style="padding-left:1.2rem;margin:.5rem 0;line-height:1.8">
                <li>Bot posts a panel with a category dropdown in the <b>Panel Channel</b></li>
                <li>User selects a category → bot creates a private channel in the <b>Ticket Category</b> folder</li>
                <li>The <b>Support Role</b> and the user get access to the channel</li>
                <li>Staff can claim, close, or save transcripts using buttons in the ticket</li>
            </ol>
            <div class="hint">Customize the panel appearance and welcome message via <code>/ticket-setup panel</code> and <code>/ticket-setup message</code> in Discord.</div>
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
        const btn = $('#tk-save'); btn.disabled = true; btn.textContent = 'Saving…';
        const payload = {
            channelId: $('#tk-panel-ch').value || null,
            categoryId: $('#tk-category').value || null,
            supportRoleId: $('#tk-support').value || null,
            categories: window.__ticketWorking.categories || []
        };
        const r = await api(`/api/guild/${g.id}/tickets-config`, { method: 'PUT', body: JSON.stringify(payload) });
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (r && !r._error) toast('Tickets saved!', 'success');
        else toast(r?.error || 'Save failed', 'error');
    };

    // Deploy handler — saves the current config, then asks the bot to post the panel.
    $('#tk-deploy').onclick = async () => {
        const chId = $('#tk-panel-ch').value || null;
        if (!chId) return toast('Pick a Panel Channel first', 'error');
        if (!(window.__ticketWorking.categories || []).length) {
            return toast('Add at least one ticket category first', 'error');
        }
        const btn = $('#tk-deploy'); const orig = btn.innerHTML;
        btn.disabled = true; btn.innerHTML = icon('refresh') + ' Deploying…';
        // Persist the latest config so the bot builds the panel from it.
        await api(`/api/guild/${g.id}/tickets-config`, {
            method: 'PUT',
            body: JSON.stringify({
                channelId: chId,
                categoryId: $('#tk-category').value || null,
                supportRoleId: $('#tk-support').value || null,
                categories: window.__ticketWorking.categories || []
            })
        }).catch(() => {});
        await deployPanel(g.id, 'tickets', chId);
        btn.disabled = false; btn.innerHTML = orig;
    };
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
