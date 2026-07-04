/* =========================================================
   xNico Dashboard — webhook-botignore.js
   Webhook Manager & Bot Ignore modules.
   ========================================================= */

// ═══════════════════════════════════════════════════════════
// WEBHOOK MANAGER
// ═══════════════════════════════════════════════════════════
async function pageWebhook() {
    const g = state.currentGuild;
    const page = $('#page');
    page.innerHTML = `<div style="display:flex;justify-content:center;padding:4rem 0"><div class="spinner"></div></div>`;

    const [cfg, channels] = await Promise.all([
        api(`/api/guild/${g.id}/webhook-config`),
        api(`/api/guild/${g.id}/channels`),
    ]);
    state.channels = Array.isArray(channels) ? channels : [];
    const data = cfg && !cfg._error ? cfg : { webhooks: [], totalWebhooks: 0 };

    _renderWebhookPage(g, data);
}

function _renderWebhookPage(g, data) {
    const webhooks = data.webhooks || [];
    const textCh = state.channels.filter(c => c.type === 0 || c.type === 5);

    // Webhook list
    const webhooksHtml = webhooks.length ? webhooks.map((w, i) => {
        const ch = state.channels.find(c => c.id === w.channelId);
        return `
            <div class="listi" style="display:block;margin-bottom:.75rem;padding:1rem;background:var(--bg-hover);border-radius:12px;border:1px solid var(--border)">
                <div class="row" style="align-items:center;gap:.75rem">
                    <div style="width:40px;height:40px;border-radius:50%;background:var(--accent-grad);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0">
                        ${w.avatar ? `<img src="${esc(w.avatar)}" style="width:100%;height:100%;object-fit:cover">` : `<span style="color:#fff;font-weight:700;font-size:1.1rem">${esc((w.name || 'W')[0].toUpperCase())}</span>`}
                    </div>
                    <div style="flex:1;min-width:0">
                        <div class="row" style="gap:.5rem;align-items:center;flex-wrap:wrap">
                            <span class="bold" style="font-size:.95rem">${esc(w.name || 'Unnamed')}</span>
                            <span class="tag text-xs">${esc(w.type)}</span>
                        </div>
                        <div class="text-xs text-mute mt-1">
                            #${esc(ch?.name || w.channelId)} • Created by ${esc(w.user?.username || 'Unknown')}
                        </div>
                    </div>
                    <div class="row" style="gap:.25rem;flex-shrink:0">
                        <button class="btn sm danger" onclick="window.__webhookDelete('${esc(w.id)}')" title="Delete webhook">
                            ${icon('user-x')}
                        </button>
                    </div>
                </div>
                <div class="row mt-2" style="gap:.75rem;flex-wrap:wrap">
                    <span class="text-xs mono text-mute">ID: ${esc(w.id)}</span>
                    ${w.createdAt ? `<span class="text-xs text-mute">Created: ${new Date(w.createdAt).toLocaleDateString()}</span>` : ''}
                </div>
            </div>`;
    }).join('') : `
        <div class="empty" style="padding:2rem 1rem">
            ${icon('webhook')}
            <p class="text-mute">No webhooks found in this server.</p>
        </div>`;

    const chSel = `<select id="wh-channel" style="flex:1"><option value="">— Select channel —</option>${textCh.map(c => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`).join('')}</select>`;

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Webhook Manager</h1><p>Create, view, and manage Discord webhooks for ${esc(g.name)}.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <!-- Stats -->
        <div class="grid g-3 mb-3">
            <div class="stat purple"><div class="ic">${icon('webhook')}</div><div><div class="v">${webhooks.length}</div><div class="l">Total Webhooks</div></div></div>
            <div class="stat cyan"><div class="ic">${icon('hash')}</div><div><div class="v">${new Set(webhooks.map(w => w.channelId)).size}</div><div class="l">Channels Used</div></div></div>
            <div class="stat green"><div class="ic">${icon('check')}</div><div><div class="v">${webhooks.filter(w => w.type === 'Incoming').length}</div><div class="l">Incoming Hooks</div></div></div>
        </div>

        <!-- Create Webhook -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('user-plus')}</div><div class="tt"><div class="t">Create Webhook</div><div class="s">Add a new webhook to any text channel.</div></div></div>
            <div class="grid g-2 mt-2">
                <div class="form-row"><label>Channel</label>${chSel}</div>
                <div class="form-row"><label>Webhook Name</label><input type="text" id="wh-name" placeholder="xNico Webhook" maxlength="80"></div>
            </div>
            <button class="btn primary mt-2" id="wh-create-btn">${icon('user-plus')} Create Webhook</button>
        </div>

        <!-- Webhook List -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('webhook')}</div><div class="tt"><div class="t">Active Webhooks (${webhooks.length})</div><div class="s">All webhooks in ${esc(g.name)}. Click the delete button to remove.</div></div></div>
            ${webhooksHtml}
        </div>

        <!-- How It Works -->
        <div class="card mb-2" style="font-size:.85rem">
            <h3>About Webhooks</h3>
            <div class="grid g-2 mt-2">
                <div style="padding:.75rem;background:rgba(99,102,241,.06);border-radius:10px;border:1px solid rgba(99,102,241,.15)">
                    <div class="bold" style="color:var(--accent)">Creating</div>
                    <div class="text-xs text-mute mt-1">Create webhooks in any text channel. The bot needs Manage Webhooks permission.</div>
                </div>
                <div style="padding:.75rem;background:rgba(99,102,241,.06);border-radius:10px;border:1px solid rgba(99,102,241,.15)">
                    <div class="bold" style="color:var(--accent-2)">Sending</div>
                    <div class="text-xs text-mute mt-1">Use <code>/webhook send</code> to post messages via any webhook with custom name and avatar.</div>
                </div>
                <div style="padding:.75rem;background:rgba(245,158,11,.06);border-radius:10px;border:1px solid rgba(245,158,11,.15)">
                    <div class="bold" style="color:var(--warning)">Managing</div>
                    <div class="text-xs text-mute mt-1">Rename, delete, or inspect webhooks with <code>/webhook info</code>, <code>/webhook rename</code>, <code>/webhook delete</code>.</div>
                </div>
                <div style="padding:.75rem;background:rgba(239,68,68,.06);border-radius:10px;border:1px solid rgba(239,68,68,.15)">
                    <div class="bold" style="color:var(--danger)">Security</div>
                    <div class="text-xs text-mute mt-1">Webhook tokens are masked for security. Full tokens are only visible via Discord's channel settings.</div>
                </div>
            </div>
            <div class="hint mt-2">Also manageable via <code>/webhook create</code>, <code>/webhook list</code>, <code>/webhook send</code>, <code>/webhook info</code>, <code>/webhook rename</code>, <code>/webhook delete</code> in Discord.</div>
        </div>`;

    // Bind create button
    const createBtn = document.getElementById('wh-create-btn');
    if (createBtn) {
        createBtn.onclick = async () => {
            const channelId = document.getElementById('wh-channel').value;
            const name = document.getElementById('wh-name').value || 'xNico Webhook';
            if (!channelId) return toast('Select a channel first', 'error');
            createBtn.disabled = true; createBtn.textContent = 'Creating…';
            const r = await api(`/api/guild/${g.id}/webhook-create`, {
                method: 'POST',
                body: JSON.stringify({ channelId, name })
            });
            createBtn.disabled = false; createBtn.innerHTML = icon('user-plus') + ' Create Webhook';
            if (r && !r._error && r.success) {
                toast('Webhook created!', 'success');
                pageWebhook(); // Refresh
            } else {
                toast(r?.error || 'Failed to create webhook', 'error');
            }
        };
    }
}

// Delete webhook
window.__webhookDelete = async (webhookId) => {
    if (!confirm('Delete this webhook permanently? This cannot be undone.')) return;
    const g = state.currentGuild;
    const r = await api(`/api/guild/${g.id}/webhook/${webhookId}`, { method: 'DELETE' });
    if (r && !r._error && r.success) {
        toast('Webhook deleted', 'success');
        pageWebhook();
    } else {
        toast(r?.error || 'Failed to delete webhook', 'error');
    }
};


// ═══════════════════════════════════════════════════════════
// BOT IGNORE
// ═══════════════════════════════════════════════════════════
async function pageBotIgnore() {
    const g = state.currentGuild;
    const page = $('#page');
    page.innerHTML = `<div style="display:flex;justify-content:center;padding:4rem 0"><div class="spinner"></div></div>`;

    const [cfg, channels, roles] = await Promise.all([
        api(`/api/guild/${g.id}/botignore-config`),
        api(`/api/guild/${g.id}/channels`),
        api(`/api/guild/${g.id}/roles`),
    ]);
    state.channels = Array.isArray(channels) ? channels : [];
    state.roles = Array.isArray(roles) ? roles.filter(r => r.name !== '@everyone') : [];
    const w = cfg && !cfg._error ? cfg : { enabled: false, ignoredChannels: [], ignoredRoles: [], ignoredUsers: [], ignoreAllBots: false, ignorePrefix: false };
    window.__biWorking = JSON.parse(JSON.stringify(w));
    _renderBotIgnorePage(g);
}

function _renderBotIgnorePage(g) {
    const w = window.__biWorking;

    // Channel chips
    const channelChips = (w.ignoredChannels || []).map(id => {
        const c = state.channels.find(x => x.id === id);
        return `<span class="chip">#${esc(c?.name || id)} <button onclick="window.__biRmChannel('${esc(id)}')">×</button></span>`;
    }).join('') || '<span class="text-sm text-mute">No channels ignored — bot responds everywhere.</span>';

    // Role chips
    const roleChips = (w.ignoredRoles || []).map(id => {
        const r = state.roles.find(x => x.id === id);
        return `<span class="chip">@${esc(r?.name || id)} <button onclick="window.__biRmRole('${esc(id)}')">×</button></span>`;
    }).join('') || '<span class="text-sm text-mute">No roles ignored — bot responds to all roles.</span>';

    // User chips
    const userChips = (w.ignoredUsers || []).map(id => {
        return `<span class="chip"><span class="mono">${esc(id)}</span> <button onclick="window.__biRmUser('${esc(id)}')">×</button></span>`;
    }).join('') || '<span class="text-sm text-mute">No users ignored — bot responds to everyone.</span>';

    const textCh = state.channels.filter(c => c.type === 0 || c.type === 5);
    const totalIgnored = (w.ignoredChannels || []).length + (w.ignoredRoles || []).length + (w.ignoredUsers || []).length;

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Bot Ignore</h1><p>Configure what the bot should ignore on ${esc(g.name)}.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <!-- Stats -->
        <div class="grid g-4 mb-3">
            <div class="stat ${w.enabled ? 'green' : 'grey'}"><div class="ic">${icon('eye-off')}</div><div><div class="v">${w.enabled ? 'ON' : 'OFF'}</div><div class="l">Status</div></div></div>
            <div class="stat purple"><div class="ic">${icon('hash')}</div><div><div class="v">${(w.ignoredChannels || []).length}</div><div class="l">Channels</div></div></div>
            <div class="stat cyan"><div class="ic">${icon('shield')}</div><div><div class="v">${(w.ignoredRoles || []).length}</div><div class="l">Roles</div></div></div>
            <div class="stat amber"><div class="ic">${icon('user')}</div><div><div class="v">${(w.ignoredUsers || []).length}</div><div class="l">Users</div></div></div>
        </div>

        <!-- Master Toggle -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('settings')}</div><div class="tt"><div class="t">General Settings</div><div class="s">Master toggle and global ignore options.</div></div></div>
            <div class="switch-row"><div><div class="lbl">Enable Bot Ignore</div><div class="desc">When enabled, the bot will not respond to commands or events in ignored channels/roles/users.</div></div><label class="switch"><input type="checkbox" id="bi-enabled" ${w.enabled ? 'checked' : ''}><span class="slide"></span></label></div>
            <div class="switch-row mt-2"><div><div class="lbl">Ignore All Other Bots</div><div class="desc">Skip processing messages from all other bots (prevents bot chains/loops).</div></div><label class="switch"><input type="checkbox" id="bi-allbots" ${w.ignoreAllBots ? 'checked' : ''}><span class="slide"></span></label></div>
            <div class="switch-row mt-2"><div><div class="lbl">Ignore Prefix Commands Only</div><div class="desc">Only ignore prefix commands (e.g. -help). Slash commands and events still work in ignored areas.</div></div><label class="switch"><input type="checkbox" id="bi-prefix" ${w.ignorePrefix ? 'checked' : ''}><span class="slide"></span></label></div>
        </div>

        <!-- Ignored Channels -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic" style="background:rgba(99,102,241,.12);color:var(--accent)">${icon('hash')}</div><div class="tt"><div class="t">Ignored Channels (${(w.ignoredChannels || []).length})</div><div class="s">The bot won't respond to any commands or events in these channels.</div></div></div>
            <div class="chips mb-2">${channelChips}</div>
            <div class="row">
                <select id="bi-ch-add" style="flex:1"><option value="">— Select channel —</option>${textCh.map(c => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`).join('')}</select>
                <button class="btn sm" onclick="window.__biAddChannel()">${icon('user-plus')} Add</button>
            </div>
        </div>

        <!-- Ignored Roles -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic" style="background:rgba(99,102,241,.12);color:var(--accent-2)">${icon('shield')}</div><div class="tt"><div class="t">Ignored Roles (${(w.ignoredRoles || []).length})</div><div class="s">Members with these roles won't trigger any bot commands.</div></div></div>
            <div class="chips mb-2">${roleChips}</div>
            <div class="row">
                <select id="bi-role-add" style="flex:1"><option value="">— Select role —</option>${state.roles.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>
                <button class="btn sm" onclick="window.__biAddRole()">${icon('user-plus')} Add</button>
            </div>
        </div>

        <!-- Ignored Users -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic" style="background:rgba(245,158,11,.12);color:var(--warning)">${icon('user-x')}</div><div class="tt"><div class="t">Ignored Users (${(w.ignoredUsers || []).length})</div><div class="s">Specific users the bot will completely ignore. Enter Discord user IDs.</div></div></div>
            <div class="chips mb-2">${userChips}</div>
            <div class="row">
                <input type="text" id="bi-user-add" placeholder="Enter user ID (17-20 digits)" style="flex:1;font-family:monospace">
                <button class="btn sm" onclick="window.__biAddUser()">${icon('user-plus')} Add</button>
            </div>
            <div class="hint mt-1">Enter a Discord user ID (right-click user → Copy ID in Discord). Maximum 50 users.</div>
        </div>

        <!-- How It Works -->
        <div class="card mb-2" style="font-size:.85rem">
            <h3>How Bot Ignore Works</h3>
            <div class="grid g-2 mt-2">
                <div style="padding:.75rem;background:rgba(99,102,241,.06);border-radius:10px;border:1px solid rgba(99,102,241,.15)">
                    <div class="bold" style="color:var(--accent)">Channel Ignore</div>
                    <div class="text-xs text-mute mt-1">Bot will not respond to any prefix commands, automod triggers, leveling XP, or event processing in ignored channels.</div>
                </div>
                <div style="padding:.75rem;background:rgba(99,102,241,.06);border-radius:10px;border:1px solid rgba(99,102,241,.15)">
                    <div class="bold" style="color:var(--accent-2)">Role Ignore</div>
                    <div class="text-xs text-mute mt-1">Members with an ignored role are treated as invisible to the bot. Useful for excluding staff bots or service accounts.</div>
                </div>
                <div style="padding:.75rem;background:rgba(245,158,11,.06);border-radius:10px;border:1px solid rgba(245,158,11,.15)">
                    <div class="bold" style="color:var(--warning)">User Ignore</div>
                    <div class="text-xs text-mute mt-1">Individual users can be ignored. The bot won't process any of their messages, reactions, or voice events.</div>
                </div>
                <div style="padding:.75rem;background:rgba(239,68,68,.06);border-radius:10px;border:1px solid rgba(239,68,68,.15)">
                    <div class="bold" style="color:var(--danger)">Prefix-Only Mode</div>
                    <div class="text-xs text-mute mt-1">When "Ignore Prefix Only" is on, only prefix commands are blocked in ignored areas. Slash commands and events still work.</div>
                </div>
            </div>
            <div class="hint mt-2">Note: Server owners and trusted admins always bypass ignore rules. Slash commands can be restricted separately via Discord's built-in command permissions.</div>
        </div>

        <div class="save-bar">
            <div class="row">
                <span class="tag ${w.enabled ? 'green' : 'grey'}">${w.enabled ? 'Active' : 'Disabled'}</span>
                <span class="text-sm text-mute">${totalIgnored} total ignore rule${totalIgnored !== 1 ? 's' : ''}</span>
            </div>
            <div class="row"><button class="btn primary" id="bi-save">${icon('check')} Save Changes</button></div>
        </div>`;

    // Bind save
    const saveBtn = document.getElementById('bi-save');
    if (saveBtn) {
        saveBtn.onclick = async () => {
            const w = window.__biWorking;
            w.enabled = document.getElementById('bi-enabled').checked;
            w.ignoreAllBots = document.getElementById('bi-allbots').checked;
            w.ignorePrefix = document.getElementById('bi-prefix').checked;

            saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
            const r = await api(`/api/guild/${g.id}/botignore-config`, { method: 'PUT', body: JSON.stringify(w) });
            saveBtn.disabled = false; saveBtn.innerHTML = icon('check') + ' Save Changes';
            if (r && !r._error) {
                toast('Bot Ignore saved!', 'success');
                window.__biWorking = JSON.parse(JSON.stringify(r));
                _renderBotIgnorePage(g);
            } else {
                toast(r?.error || 'Save failed', 'error');
            }
        };
    }
}

// Channel add/remove
window.__biAddChannel = () => {
    const v = document.getElementById('bi-ch-add').value;
    if (!v) return toast('Select a channel first', 'error');
    const w = window.__biWorking;
    if (!w.ignoredChannels.includes(v) && w.ignoredChannels.length < 50) {
        w.ignoredChannels.push(v);
    } else if (w.ignoredChannels.includes(v)) {
        return toast('Channel already ignored', 'error');
    }
    _renderBotIgnorePage(state.currentGuild);
};
window.__biRmChannel = (id) => {
    window.__biWorking.ignoredChannels = window.__biWorking.ignoredChannels.filter(x => x !== id);
    _renderBotIgnorePage(state.currentGuild);
};

// Role add/remove
window.__biAddRole = () => {
    const v = document.getElementById('bi-role-add').value;
    if (!v) return toast('Select a role first', 'error');
    const w = window.__biWorking;
    if (!w.ignoredRoles.includes(v) && w.ignoredRoles.length < 25) {
        w.ignoredRoles.push(v);
    } else if (w.ignoredRoles.includes(v)) {
        return toast('Role already ignored', 'error');
    }
    _renderBotIgnorePage(state.currentGuild);
};
window.__biRmRole = (id) => {
    window.__biWorking.ignoredRoles = window.__biWorking.ignoredRoles.filter(x => x !== id);
    _renderBotIgnorePage(state.currentGuild);
};

// User add/remove
window.__biAddUser = () => {
    const inp = document.getElementById('bi-user-add');
    const v = (inp.value || '').trim();
    if (!/^\\d{17,20}$/.test(v)) return toast('Enter a valid Discord user ID (17-20 digits)', 'error');
    const w = window.__biWorking;
    if (!w.ignoredUsers.includes(v) && w.ignoredUsers.length < 50) {
        w.ignoredUsers.push(v);
        inp.value = '';
    } else if (w.ignoredUsers.includes(v)) {
        return toast('User already ignored', 'error');
    }
    _renderBotIgnorePage(state.currentGuild);
};
window.__biRmUser = (id) => {
    window.__biWorking.ignoredUsers = window.__biWorking.ignoredUsers.filter(x => x !== id);
    _renderBotIgnorePage(state.currentGuild);
};
