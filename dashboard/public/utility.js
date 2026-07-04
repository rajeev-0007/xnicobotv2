/* =========================================================
   xNico Dashboard — utility.js
   Voice J2C, Reaction Roles, Media-Only, AFK, Sticky Messages.
   ========================================================= */

// ═══════════════════════════════════════════════════════════
// VOICE / JOIN-TO-CREATE
// ═══════════════════════════════════════════════════════════
async function pageVoice() {
    const g = state.currentGuild;
    const [cfg, channels] = await Promise.all([
        api(`/api/guild/${g.id}/voice-config`),
        api(`/api/guild/${g.id}/channels`),
    ]);
    state.channels = Array.isArray(channels) ? channels : [];
    const w = cfg && !cfg._error ? cfg : { enabled: false, triggerChannelId: null, interfaceChannelId: null, activeChannels: {} };
    const voiceChannels = state.channels.filter(c => c.type === 2);
    const textChannels = state.channels.filter(c => c.type === 0 || c.type === 5);
    const activeCount = Object.keys(w.activeChannels || {}).length;

    const chSel = `<select id="j2c-trigger"><option value="">— None —</option>${voiceChannels.map(c => `<option value="${esc(c.id)}" ${w.triggerChannelId === c.id ? 'selected' : ''}>🔊 ${esc(c.name)}</option>`).join('')}</select>`;
    const interfaceSel = `<select id="j2c-interface"><option value="">— None —</option>${textChannels.map(c => `<option value="${esc(c.id)}" ${w.interfaceChannelId === c.id ? 'selected' : ''}># ${esc(c.name)}</option>`).join('')}</select>`;

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Voice / Join-to-Create</h1><p>Temporary voice channels for ${esc(g.name)}.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('mic')}</div><div class="tt"><div class="t">Join-to-Create</div><div class="s">Members join a trigger channel → bot creates a private temp channel for them.</div></div></div>
            <div class="switch-row"><div><div class="lbl">Enable J2C</div></div><label class="switch"><input type="checkbox" id="j2c-enabled" ${w.enabled ? 'checked' : ''}><span class="slide"></span></label></div>
            <div class="form-row mt-2"><label>Trigger Voice Channel</label>${chSel}<div class="hint">When a user joins this channel, a temp channel is created and they're moved into it.</div></div>
            <hr>
            <div class="form-row"><label>Interface Channel (Control Panel)</label>
                ${interfaceSel}
                <div class="hint">The text channel where the Voice Control Panel (with Lock, Limit, Kick buttons) is sent via bot command.</div>
            </div>
            <hr>
            <div class="text-sm text-mute">Active temp channels: <b>${activeCount}</b></div>
            <div class="hint mt-1">Users can rename, set limits, lock, kick, and manage their channel via the interface buttons.</div>
        </div>

        <div class="save-bar">
            <div class="row"><span class="tag ${w.enabled ? 'green' : 'grey'}">${w.enabled ? 'Active' : 'Inactive'}</span></div>
            <div class="row"><button class="btn primary" id="j2c-save">${icon('check')} Save</button></div>
        </div>`;

    $('#j2c-save').onclick = async () => {
        const btn = $('#j2c-save'); btn.disabled = true; btn.textContent = 'Saving…';
        const r = await api(`/api/guild/${g.id}/voice-config`, { method: 'PUT', body: JSON.stringify({
            enabled: $('#j2c-enabled').checked,
            triggerChannelId: $('#j2c-trigger').value || null,
            interfaceChannelId: $('#j2c-interface').value || null
        })});
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (r && !r._error) toast('Voice J2C saved!', 'success');
        else toast(r?.error || 'Save failed', 'error');
    };
}

// ═══════════════════════════════════════════════════════════
// REACTION ROLES
// ═══════════════════════════════════════════════════════════
async function pageReactionRoles() {
    const g = state.currentGuild;
    const cfg = await api(`/api/guild/${g.id}/reactionroles-config`);
    const panels = cfg && !cfg._error ? (cfg.panels || []) : [];

    const panelsHtml = panels.length ? panels.map((p, i) => `
        <div class="listi" style="display:block;margin-bottom:.5rem">
            <div class="row">
                <span class="tag">#${i+1}</span>
                <span class="text-sm">${esc(p.title || p.name || 'Panel')}</span>
                <span class="text-xs text-mute mono">${esc(p.messageId || '—')}</span>
                <span class="spacer"></span>
                <span class="text-xs text-mute">${(p.roles || p.options || []).length} roles</span>
            </div>
        </div>
    `).join('') : '<div class="text-sm text-mute">No reaction role panels configured.</div>';

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Reaction Roles</h1><p>Self-assignable role panels for ${esc(g.name)}.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('react-role')}</div><div class="tt"><div class="t">Panels (${panels.length})</div><div class="s">Reaction role panels created via <code>/reactionroles</code> in Discord.</div></div></div>
            ${panelsHtml}
            <hr>
            <div class="hint">Create and manage reaction role panels via <code>/reactionroles create</code>, <code>/reactionroles add</code>, and <code>/reactionroles remove</code> in Discord. The dashboard shows existing panels for reference.</div>
        </div>`;
}

// ═══════════════════════════════════════════════════════════
// MEDIA-ONLY
// ═══════════════════════════════════════════════════════════
async function pageMediaOnly() {
    const g = state.currentGuild;
    const [cfg, channels] = await Promise.all([
        api(`/api/guild/${g.id}/media-only-config`),
        api(`/api/guild/${g.id}/channels`),
    ]);
    state.channels = Array.isArray(channels) ? channels : [];
    const w = cfg && !cfg._error ? cfg : { channels: [] };
    window.__moWorking = [...(w.channels || [])];

    _renderMediaOnlyPage(g);
}

function _renderMediaOnlyPage(g) {
    const w = window.__moWorking;
    const chipsHtml = w.map(id => {
        const c = state.channels.find(x => x.id === id);
        return `<span class="chip">#${esc(c?.name || id)} <button onclick="window.__moRm('${esc(id)}')">×</button></span>`;
    }).join('') || '<span class="text-sm text-mute">No media-only channels set.</span>';

    const textCh = state.channels.filter(c => c.type === 0 || c.type === 5);

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Media-Only</h1><p>Force channels to only accept images/videos/files.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('image')}</div><div class="tt"><div class="t">Media-Only Channels (${w.length})</div><div class="s">Messages without attachments are auto-deleted in these channels.</div></div></div>
            <div class="chips mb-2">${chipsHtml}</div>
            <div class="row">
                <select id="mo-add-ch" style="flex:1"><option value="">— Pick channel —</option>${textCh.map(c => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`).join('')}</select>
                <button class="btn sm" onclick="window.__moAdd()">${icon('user-plus')} Add</button>
            </div>
        </div>

        <div class="save-bar">
            <div class="row"><span class="tag ${w.length ? 'green' : 'grey'}">${w.length} channel${w.length !== 1 ? 's' : ''}</span></div>
            <div class="row"><button class="btn primary" id="mo-save">${icon('check')} Save</button></div>
        </div>`;

    $('#mo-save').onclick = async () => {
        const btn = $('#mo-save'); btn.disabled = true; btn.textContent = 'Saving…';
        const r = await api(`/api/guild/${g.id}/media-only-config`, { method: 'PUT', body: JSON.stringify({ channels: window.__moWorking }) });
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (r && !r._error) toast('Media-Only saved!', 'success');
        else toast(r?.error || 'Save failed', 'error');
    };
}
window.__moAdd = () => {
    const v = $('#mo-add-ch').value;
    if (!v) return;
    if (!window.__moWorking.includes(v)) window.__moWorking.push(v);
    _renderMediaOnlyPage(state.currentGuild);
};
window.__moRm = (id) => {
    window.__moWorking = window.__moWorking.filter(x => x !== id);
    _renderMediaOnlyPage(state.currentGuild);
};

// ═══════════════════════════════════════════════════════════
// AFK
// ═══════════════════════════════════════════════════════════
async function pageAfk() {
    const g = state.currentGuild;
    const cfg = await api(`/api/guild/${g.id}/afk-config`);
    const w = cfg && !cfg._error ? cfg : { activeAfkUsers: 0 };

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>AFK System</h1><p>AFK notifications for ${esc(g.name)}.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('moon')}</div><div class="tt"><div class="t">AFK Status</div><div class="s">Members use <code>/afk</code> or <code>-afk</code> to set themselves as AFK. When mentioned, the bot notifies the pinger.</div></div></div>
            <div class="stat purple mt-2"><div class="ic">${icon('moon')}</div><div><div class="v">${w.activeAfkUsers}</div><div class="l">Currently AFK</div></div></div>
            <hr>
            <div class="text-sm text-mute">
                <b>How it works:</b>
                <ol style="padding-left:1.2rem;margin:.5rem 0;line-height:1.8">
                    <li>Member runs <code>/afk Going to sleep</code></li>
                    <li>When someone pings them, bot replies: "User is AFK: Going to sleep"</li>
                    <li>When the AFK user sends a message, their AFK is auto-cleared</li>
                </ol>
            </div>
            <div class="hint">The AFK system is always active. No configuration needed — it works out of the box.</div>
        </div>`;
}

// ═══════════════════════════════════════════════════════════
// STICKY MESSAGES
// ═══════════════════════════════════════════════════════════
async function pageSticky() {
    const g = state.currentGuild;
    const [cfg, channels] = await Promise.all([
        api(`/api/guild/${g.id}/sticky-config`),
        api(`/api/guild/${g.id}/channels`),
    ]);
    state.channels = Array.isArray(channels) ? channels : [];
    const messages = cfg && !cfg._error ? (cfg.messages || []) : [];

    const textCh = state.channels.filter(c => c.type === 0 || c.type === 5);
    const listHtml = messages.length ? messages.map(m => {
        const ch = state.channels.find(c => c.id === m.channelId);
        return `
            <div class="listi" style="display:block;margin-bottom:.5rem">
                <div class="row mb-1">
                    <span class="tag">#${esc(ch?.name || m.channelId)}</span>
                    <span class="spacer"></span>
                    <button class="btn sm danger" onclick="window.__stickyRm('${esc(m.channelId)}')">×</button>
                </div>
                <div class="text-xs text-mute">${esc((m.content || '').substring(0, 100))}${(m.content || '').length > 100 ? '…' : ''}</div>
            </div>`;
    }).join('') : '<div class="text-sm text-mute">No sticky messages configured.</div>';

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Sticky Messages</h1><p>Keep a message pinned at the bottom of channels.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('pin')}</div><div class="tt"><div class="t">Active Stickies (${messages.length})</div><div class="s">The bot re-posts the sticky message whenever new messages push it up.</div></div></div>
            ${listHtml}
            <hr>
            <h4 class="mb-1">Add Sticky Message</h4>
            <div class="form-row"><label>Channel</label><select id="sticky-ch"><option value="">— Pick —</option>${textCh.map(c => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`).join('')}</select></div>
            <div class="form-row"><label>Message Content</label><textarea id="sticky-content" rows="3" placeholder="📌 Remember to read the rules!"></textarea></div>
            <button class="btn sm" onclick="window.__stickyAdd()">${icon('user-plus')} Add Sticky</button>
        </div>

        <div class="hint">Also manageable via <code>/sticky-message set</code> and <code>/sticky-message remove</code> in Discord.</div>`;
}
window.__stickyAdd = async () => {
    const channelId = $('#sticky-ch').value;
    const content = ($('#sticky-content').value || '').trim();
    if (!channelId) return toast('Pick a channel', 'error');
    if (!content) return toast('Enter message content', 'error');
    const g = state.currentGuild;
    const r = await api(`/api/guild/${g.id}/sticky-config`, { method: 'PUT', body: JSON.stringify({ add: { channelId, content } }) });
    if (r && !r._error) { toast('Sticky added!', 'success'); pageSticky(); }
    else toast(r?.error || 'Failed', 'error');
};
window.__stickyRm = async (channelId) => {
    if (!confirm('Remove this sticky message?')) return;
    const g = state.currentGuild;
    const r = await api(`/api/guild/${g.id}/sticky-config`, { method: 'PUT', body: JSON.stringify({ remove: { channelId } }) });
    if (r && !r._error) { toast('Sticky removed', 'success'); pageSticky(); }
    else toast(r?.error || 'Failed', 'error');
};


// ═══════════════════════════════════════════════════════════
// TRUST SYSTEM
// ═══════════════════════════════════════════════════════════
async function pageTrust() {
    const g = state.currentGuild;
    const [cfg, roles] = await Promise.all([
        api(`/api/guild/${g.id}/trust-config`),
        api(`/api/guild/${g.id}/roles`),
    ]);
    state.roles = Array.isArray(roles) ? roles.filter(r => r.name !== '@everyone') : [];
    const w = cfg && !cfg._error ? cfg : { admins: [], mods: [], vcmods: [] };
    window.__trustWorking = JSON.parse(JSON.stringify(w));
    _renderTrustPage(g);
}

function _renderTrustPage(g) {
    const w = window.__trustWorking;

    function renderList(level, label, desc, color) {
        const list = w[level] || [];
        const chipsHtml = list.map(id => {
            const isRole = state.roles.find(r => r.id === id);
            const display = isRole ? `@${isRole.name}` : id;
            return `<span class="chip" style="border-color:${color}40">${esc(display)} <button onclick="window.__trustRm('${level}','${esc(id)}')">×</button></span>`;
        }).join('') || `<span class="text-sm text-mute">No ${label.toLowerCase()} configured.</span>`;

        return `
            <div class="card mb-2">
                <div class="card-h"><div class="ic" style="background:${color}20;color:${color}">${icon('shield')}</div><div class="tt"><div class="t">${esc(label)}</div><div class="s">${esc(desc)}</div></div></div>
                <div class="chips mb-2">${chipsHtml}</div>
                <div class="row">
                    <input type="text" id="trust-add-${level}" placeholder="User ID or Role ID" style="flex:1;font-family:monospace">
                    <button class="btn sm" onclick="window.__trustAdd('${level}')">${icon('user-plus')} Add</button>
                </div>
                <div class="hint mt-1">Enter a Discord user ID (18-digit number) or a role ID. Roles apply to all members with that role.</div>
            </div>`;
    }

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Trust System</h1><p>Manage trusted users and roles for ${esc(g.name)}.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <div class="card mb-2" style="font-size:.85rem">
            <h3>How Trust Works</h3>
            <p class="mt-1">The trust system defines who can use admin/mod commands without needing Discord's built-in permissions. Trusted users get auto-created roles with the right permissions.</p>
            <div class="grid g-3 mt-2">
                <div style="padding:.75rem;background:rgba(231,76,60,.08);border-radius:10px;border:1px solid rgba(231,76,60,.2)">
                    <div class="bold" style="color:#e74c3c">Trusted Admin</div>
                    <div class="text-xs text-mute mt-1">Full moderation + manage channels/roles/server</div>
                </div>
                <div style="padding:.75rem;background:rgba(52,152,219,.08);border-radius:10px;border:1px solid rgba(52,152,219,.2)">
                    <div class="bold" style="color:#3498db">Trusted Moderator</div>
                    <div class="text-xs text-mute mt-1">Kick, ban, timeout, manage messages</div>
                </div>
                <div style="padding:.75rem;background:rgba(46,204,113,.08);border-radius:10px;border:1px solid rgba(46,204,113,.2)">
                    <div class="bold" style="color:#2ecc71">Trusted VC Mod</div>
                    <div class="text-xs text-mute mt-1">Move, mute, deafen members in voice</div>
                </div>
            </div>
        </div>

        ${renderList('admins', 'Trusted Admins', 'Full admin access — manage server, channels, roles, and all moderation.', '#e74c3c')}
        ${renderList('mods', 'Trusted Moderators', 'Moderation access — kick, ban, timeout, manage messages.', '#3498db')}
        ${renderList('vcmods', 'Trusted VC Mods', 'Voice moderation — move, mute, deafen members in voice channels.', '#2ecc71')}

        <div class="save-bar">
            <div class="row"><span class="tag green">${(w.admins.length + w.mods.length + w.vcmods.length)} trusted</span></div>
            <div class="row"><button class="btn primary" id="trust-save">${icon('check')} Save</button></div>
        </div>`;

    $('#trust-save').onclick = async () => {
        const btn = $('#trust-save'); btn.disabled = true; btn.textContent = 'Saving…';
        const r = await api(`/api/guild/${g.id}/trust-config`, { method: 'PUT', body: JSON.stringify(window.__trustWorking) });
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (r && !r._error) toast('Trust system saved!', 'success');
        else toast(r?.error || 'Save failed', 'error');
    };
}
window.__trustAdd = (level) => {
    const inp = $(`#trust-add-${level}`);
    const v = (inp.value || '').trim();
    if (!/^\d{17,20}$/.test(v)) return toast('Enter a valid Discord ID (17-20 digits)', 'error');
    if (!window.__trustWorking[level].includes(v)) window.__trustWorking[level].push(v);
    inp.value = '';
    _renderTrustPage(state.currentGuild);
};
window.__trustRm = (level, id) => {
    window.__trustWorking[level] = window.__trustWorking[level].filter(x => x !== id);
    _renderTrustPage(state.currentGuild);
};


// ═══════════════════════════════════════════════════════════
// INVITE TRACKING (full settings + rewards + leaderboard)
// ═══════════════════════════════════════════════════════════
async function pageInvites() {
    const g = state.currentGuild;
    const [cfg, channels, roles] = await Promise.all([
        api(`/api/guild/${g.id}/invites-config`),
        api(`/api/guild/${g.id}/channels`),
        api(`/api/guild/${g.id}/roles`),
    ]);
    state.channels = Array.isArray(channels) ? channels : [];
    state.roles = Array.isArray(roles) ? roles.filter(r => r.name !== '@everyone') : [];
    const data = cfg && !cfg._error ? cfg : { enabled: true, channel: null, rewards: [], leaderboard: [], totalTracked: 0 };
    window.__invWorking = { enabled: data.enabled, channel: data.channel, rewards: [...(data.rewards || [])] };

    _renderInvitesPage(g, data);
}

function _renderInvitesPage(g, data) {
    const w = window.__invWorking;
    const textCh = state.channels.filter(c => c.type === 0 || c.type === 5);
    const chSel = `<select id="inv-ch"><option value="">— None (no logging) —</option>${textCh.map(c => `<option value="${esc(c.id)}" ${w.channel === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select>`;

    // Rewards editor
    const rewardsHtml = (w.rewards || []).map((r, i) => {
        const role = state.roles.find(x => x.id === r.roleId);
        return `<div class="listi" style="display:block;margin-bottom:.4rem">
            <div class="row">
                <span class="tag">${r.invites} invites</span>
                <span>→</span>
                <span class="bold">${role ? esc(role.name) : `<code>${esc(r.roleId)}</code>`}</span>
                <span class="spacer"></span>
                <button class="btn sm danger" onclick="window.__invRmReward(${i})">×</button>
            </div>
        </div>`;
    }).join('') || '<div class="text-sm text-mute">No invite rewards configured.</div>';

    // Leaderboard
    const board = (data.leaderboard || []).slice(0, 15);
    const boardHtml = board.length ? `
        <table class="tbl">
            <thead><tr><th>#</th><th>User ID</th><th>Invites</th><th>Left</th><th>Fake</th><th>Bonus</th><th>Net</th></tr></thead>
            <tbody>${board.map((u, i) => `<tr>
                <td><span class="tag">${i+1}</span></td>
                <td class="mono text-xs">${esc(u.userId)}</td>
                <td class="bold">${u.invites}</td>
                <td style="color:var(--danger)">${u.left || 0}</td>
                <td style="color:var(--warning)">${u.fake || 0}</td>
                <td style="color:var(--success)">${u.bonus || 0}</td>
                <td class="bold">${u.invites - (u.left || 0) - (u.fake || 0)}</td>
            </tr>`).join('')}</tbody>
        </table>
    ` : '<div class="text-sm text-mute">No invite data yet.</div>';

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Invite Tracking</h1><p>Track invites, reward top inviters, detect alts on ${esc(g.name)}.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <!-- Settings -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('settings')}</div><div class="tt"><div class="t">Settings</div><div class="s">Enable/disable tracking and set log channel.</div></div></div>
            <div class="switch-row"><div><div class="lbl">Enable Invite Tracking</div><div class="desc">Track who invited whom when members join.</div></div><label class="switch"><input type="checkbox" id="inv-enabled" ${w.enabled ? 'checked' : ''}><span class="slide"></span></label></div>
            <div class="form-row mt-2"><label>Invite Log Channel</label>${chSel}<div class="hint">Alt detection alerts and invite logs are sent here.</div></div>
        </div>

        <!-- Rewards -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('crown')}</div><div class="tt"><div class="t">Invite Rewards (${(w.rewards||[]).length})</div><div class="s">Auto-assign roles when a user reaches X invites.</div></div></div>
            ${rewardsHtml}
            <hr>
            <h4 class="mb-1">Add Reward</h4>
            <div class="grid g-2">
                <div class="form-row"><label>Invites Required</label><input type="number" id="inv-reward-count" min="1" max="1000" value="5"></div>
                <div class="form-row"><label>Role to Award</label><select id="inv-reward-role"><option value="">— Pick —</option>${state.roles.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></div>
            </div>
            <button class="btn sm" onclick="window.__invAddReward()">${icon('user-plus')} Add Reward</button>
        </div>

        <!-- Leaderboard -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('chart')}</div><div class="tt"><div class="t">Invite Leaderboard</div><div class="s">${data.totalTracked} members tracked.</div></div></div>
            ${boardHtml}
        </div>

        <!-- Info -->
        <div class="card mb-2" style="font-size:.85rem">
            <h3>Features</h3>
            <div class="grid g-2 mt-1">
                <div><b>Alt Detection</b> — flags suspicious accounts (new, no avatar, generic names)</div>
                <div><b>Invite Rewards</b> — auto-assign roles at invite milestones</div>
                <div><b>Bonus Invites</b> — admins can add bonus invites via <code>-invites bonus @user 5</code></div>
                <div><b>Reset</b> — reset user or all invites via <code>-invites reset</code></div>
            </div>
        </div>

        <div class="save-bar">
            <div class="row"><span class="tag ${w.enabled ? 'green' : 'grey'}">${w.enabled ? 'Tracking' : 'Disabled'}</span></div>
            <div class="row"><button class="btn primary" id="inv-save">${icon('check')} Save</button></div>
        </div>`;

    $('#inv-save').onclick = async () => {
        const btn = $('#inv-save'); btn.disabled = true; btn.textContent = 'Saving…';
        window.__invWorking.enabled = $('#inv-enabled').checked;
        window.__invWorking.channel = $('#inv-ch').value || null;
        const r = await api(`/api/guild/${g.id}/invites-config`, { method: 'PUT', body: JSON.stringify(window.__invWorking) });
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (r && !r._error) toast('Invite tracking saved!', 'success');
        else toast(r?.error || 'Save failed', 'error');
    };
}
window.__invAddReward = () => {
    const count = parseInt($('#inv-reward-count').value);
    const roleId = $('#inv-reward-role').value;
    if (!count || count < 1) return toast('Enter invites required (≥1)', 'error');
    if (!roleId) return toast('Pick a role', 'error');
    const w = window.__invWorking;
    w.rewards = w.rewards.filter(r => r.invites !== count);
    w.rewards.push({ invites: count, roleId });
    w.rewards.sort((a, b) => a.invites - b.invites);
    // Re-render (we need the data object, just pass minimal)
    _renderInvitesPage(state.currentGuild, { ...w, leaderboard: [], totalTracked: 0 });
};
window.__invRmReward = (idx) => {
    window.__invWorking.rewards.splice(idx, 1);
    _renderInvitesPage(state.currentGuild, { ...window.__invWorking, leaderboard: [], totalTracked: 0 });
};

// ═══════════════════════════════════════════════════════════
// SERVER STATS CHANNELS
// ═══════════════════════════════════════════════════════════
async function pageServerStats() {
    const g = state.currentGuild;
    const cfg = await api(`/api/guild/${g.id}/serverstats-config`);
    const w = cfg && !cfg._error ? cfg : { enabled: false, categoryId: null, channels: {} };

    const statTypes = [
        { key: 'members',    label: 'Total Members',  template: 'xN | Members: {value}' },
        { key: 'humans',     label: 'Humans',         template: 'xN | Humans: {value}' },
        { key: 'bots',       label: 'Bots',           template: 'xN | Bots: {value}' },
        { key: 'channels',   label: 'Channels',       template: 'xN | Channels: {value}' },
        { key: 'roles',      label: 'Roles',          template: 'xN | Roles: {value}' },
        { key: 'online',     label: 'Online',         template: 'xN | Online: {value}' },
        { key: 'inVoice',    label: 'In Voice',       template: 'xN | In Voice: {value}' },
        { key: 'boosts',     label: 'Boosts',         template: 'xN | Boosts: {value}' },
        { key: 'boostTier',  label: 'Boost Level',    template: 'xN | Level: {value}' },
    ];

    const activeChannels = Object.keys(w.channels || {});
    const channelsHtml = activeChannels.length ? activeChannels.map(key => {
        const ch = w.channels[key];
        const type = statTypes.find(t => t.key === key);
        return `<div class="listi" style="display:block;margin-bottom:.4rem">
            <div class="row">
                <span class="tag">${esc(type?.label || key)}</span>
                <span class="text-xs text-mute mono">${esc(ch.channelId || '—')}</span>
                <span class="spacer"></span>
                <span class="text-xs text-mute">${esc(ch.template || type?.template || '')}</span>
            </div>
        </div>`;
    }).join('') : '<div class="text-sm text-mute">No stats channels configured.</div>';

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Stats Channels</h1><p>Auto-updating voice channels showing server statistics.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('chart')}</div><div class="tt"><div class="t">Active Stats (${activeChannels.length})</div><div class="s">Voice channels that auto-update with server counts.</div></div></div>
            ${channelsHtml}
        </div>

        <div class="card mb-2" style="font-size:.85rem">
            <h3>Available Stat Types</h3>
            <div class="grid g-3 mt-1">
                ${statTypes.map(t => `<div><code>${esc(t.key)}</code> — ${esc(t.label)}</div>`).join('')}
            </div>
            <hr>
            <h3>Setup via Discord</h3>
            <p class="mt-1">Use <code>/stats-setup</code> or <code>-stats setup</code> in Discord to create stats channels. The bot creates voice channels in a dedicated category and updates them automatically when members join/leave, roles change, boosts happen, etc.</p>
            <div class="hint mt-2">Stats update every time a relevant event occurs (member join/leave, role create/delete, boost, etc).</div>
        </div>`;
}

// ═══════════════════════════════════════════════════════════
// SERVER BACKUPS
// ═══════════════════════════════════════════════════════════
async function pageBackups() {
    const g = state.currentGuild;
    const backups = await api(`/api/guild/${g.id}/backups`);
    const list = Array.isArray(backups) ? backups : [];

    const listHtml = list.length ? `
        <table class="tbl">
            <thead><tr><th>ID</th><th>Name</th><th>Created</th></tr></thead>
            <tbody>${list.map(b => `<tr>
                <td class="mono text-xs">${esc(b.id || '—')}</td>
                <td>${esc(b.name || '—')}</td>
                <td class="text-xs">${b.createdAt ? new Date(b.createdAt).toLocaleString() : '—'}</td>
            </tr>`).join('')}</tbody>
        </table>
    ` : '<div class="text-sm text-mute">No backups found for this server.</div>';

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Server Backups</h1><p>Configuration backups for ${esc(g.name)}.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('server')}</div><div class="tt"><div class="t">Backups (${list.length})</div><div class="s">Server structure and bot config backups.</div></div></div>
            ${listHtml}
        </div>

        <div class="card mb-2" style="font-size:.85rem">
            <h3>Managing Backups</h3>
            <p class="mt-1">Create and restore backups via Discord commands:</p>
            <ul style="padding-left:1.2rem;margin:.5rem 0;line-height:1.8">
                <li><code>/server-backup create</code> — Create a full server backup</li>
                <li><code>/server-backup list</code> — View all backups</li>
                <li><code>/server-backup restore</code> — Restore from a backup</li>
                <li><code>/server-backup delete</code> — Delete a backup</li>
            </ul>
            <div class="hint">Backups include channels, roles, permissions, emojis, bot configs, and optionally messages.</div>
        </div>`;
}


// ═══════════════════════════════════════════════════════════
// BOT CUSTOMIZE (Premium-gated)
// ═══════════════════════════════════════════════════════════
async function pageBotCustomize() {
    const g = state.currentGuild;
    const cfg = await api(`/api/guild/${g.id}/bot-customize-config`);

    // Premium gate
    if (cfg?._error && cfg?.status === 403) {
        $('#page').innerHTML = `
            <div class="page-h"><div><h1>Bot Customize <span class="tag amber">Premium</span></h1><p>Personalize the bot for your server.</p></div></div>
            <div class="empty premium-glow" style="border-radius:var(--radius)">
                ${icon('crown')}
                <h3>Premium Required</h3>
                <p>Bot Customization is a premium feature. Unlock it to change the bot's nickname, prefix, embed colors, and behavior for this server.</p>
                <a class="btn primary mt-2" href="https://discord.gg/Zs35X7Umak" target="_blank">${icon('star')} Get Premium</a>
            </div>`;
        return;
    }
    if (cfg?._error || cfg?._unauth) {
        $('#page').innerHTML = `<div class="empty"><h3>Failed to load</h3><p>${esc(cfg?.error || 'Unknown error')}</p></div>`;
        return;
    }

    const w = cfg || {};
    const langs = ['en','es','fr','de','ja','pt','ru','hi','ar','ko'];

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Bot Customize <span class="tag amber">Premium</span></h1><p>Personalize xNico for ${esc(g.name)}.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('settings')}</div><div class="tt"><div class="t">Identity</div><div class="s">Change how the bot appears in this server.</div></div></div>
            <div class="form-row"><label>Bot Nickname</label><input type="text" id="bc-nick" value="${esc(w.nickname || '')}" placeholder="xNico"><div class="hint">Leave empty for default. Updates live in Discord.</div></div>
            <div class="form-row"><label>Custom Prefix</label><input type="text" id="bc-prefix" value="${esc(w.prefix || '')}" placeholder="-" maxlength="5"><div class="hint">Override the default prefix for this server.</div></div>
            <div class="form-row"><label>Language</label><select id="bc-lang">${langs.map(l => `<option value="${esc(l)}" ${w.language === l ? 'selected' : ''}>${esc(l.toUpperCase())}</option>`).join('')}</select></div>
        </div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('grid')}</div><div class="tt"><div class="t">Appearance</div><div class="s">Embed colors and footer.</div></div></div>
            <div class="form-row"><label>Embed Color</label><div class="row"><input type="color" id="bc-color" value="${esc(w.embedColor || '#5865F2')}"><input type="text" id="bc-color-hex" value="${esc(w.embedColor || '#5865F2')}" style="flex:1"></div></div>
            <div class="form-row"><label>Footer Text</label><input type="text" id="bc-footer" value="${esc(w.footerText || '')}" placeholder="Powered by xNico"></div>
        </div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('chat')}</div><div class="tt"><div class="t">Behavior</div><div class="s">Command handling preferences.</div></div></div>
            <div class="form-row"><label>Command Cooldown (seconds)</label><input type="number" id="bc-cooldown" value="${w.commandCooldown || 5}" min="0" max="60"></div>
            <div class="switch-row"><div><div class="lbl">Delete Command Triggers</div><div class="desc">Auto-delete the user's command message after execution.</div></div><label class="switch"><input type="checkbox" id="bc-delete" ${w.deleteCommands ? 'checked' : ''}><span class="slide"></span></label></div>
            <div class="switch-row"><div><div class="lbl">Ephemeral Responses</div><div class="desc">Make bot responses visible only to the command user.</div></div><label class="switch"><input type="checkbox" id="bc-ephemeral" ${w.ephemeralResponses ? 'checked' : ''}><span class="slide"></span></label></div>
        </div>

        <div class="save-bar">
            <div class="row"><span class="tag amber">Premium</span><span class="text-sm text-mute">Changes sync live to the bot.</span></div>
            <div class="row"><button class="btn primary" id="bc-save">${icon('check')} Save</button></div>
        </div>`;

    // Color sync
    const cp = document.getElementById('bc-color');
    const ch = document.getElementById('bc-color-hex');
    if (cp && ch) {
        cp.addEventListener('input', () => { ch.value = cp.value; });
        ch.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(ch.value)) cp.value = ch.value; });
    }

    $('#bc-save').onclick = async () => {
        const btn = $('#bc-save'); btn.disabled = true; btn.textContent = 'Saving…';
        const r = await api(`/api/guild/${g.id}/bot-customize-config`, { method: 'PUT', body: JSON.stringify({
            nickname: $('#bc-nick').value || null,
            prefix: $('#bc-prefix').value || null,
            embedColor: ch.value || '#5865F2',
            footerText: $('#bc-footer').value || null,
            language: $('#bc-lang').value || 'en',
            commandCooldown: parseInt($('#bc-cooldown').value) || 5,
            deleteCommands: $('#bc-delete').checked,
            ephemeralResponses: $('#bc-ephemeral').checked
        })});
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (r && !r._error) toast('Bot customization saved!', 'success');
        else toast(r?.error || 'Save failed', 'error');
    };
}
