/* =========================================================
   xNico Dashboard — engagement.js
   Starboard, Counting, Autoreact, Giveaway modules.
   Each has its own page function with proper API sync.
   ========================================================= */

// ═══════════════════════════════════════════════════════════
// STARBOARD
// ═══════════════════════════════════════════════════════════
async function pageStarboard() {
    const g = state.currentGuild;
    const [cfg, channels] = await Promise.all([
        api(`/api/guild/${g.id}/starboard-config`),
        api(`/api/guild/${g.id}/channels`),
    ]);
    state.channels = Array.isArray(channels) ? channels : [];
    const w = cfg && !cfg._error ? cfg : { enabled: false, channelId: null, threshold: 3, starredCount: 0 };

    const chSel = state.channels.filter(c => c.type === 0 || c.type === 5)
        .map(c => `<option value="${esc(c.id)}" ${w.channelId === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('');

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Starboard</h1><p>Highlight popular messages for ${esc(g.name)}.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('star')}</div><div class="tt"><div class="t">Configuration</div><div class="s">When a message gets enough ⭐ reactions, it's posted to the starboard channel.</div></div></div>
            <div class="switch-row"><div><div class="lbl">Enable Starboard</div></div><label class="switch"><input type="checkbox" id="sb-enabled" ${w.enabled ? 'checked' : ''}><span class="slide"></span></label></div>
            <div class="form-row mt-2"><label>Starboard Channel</label><select id="sb-channel"><option value="">— None —</option>${chSel}</select></div>
            <div class="form-row"><label>Star Threshold</label><input type="number" id="sb-threshold" value="${w.threshold}" min="1" max="100"><div class="hint">How many ⭐ reactions before a message is posted.</div></div>
            <hr>
            <div class="text-sm text-mute">Starred messages so far: <b>${w.starredCount}</b></div>
        </div>

        <div class="save-bar">
            <div class="row"><span class="tag ${w.enabled ? 'green' : 'grey'}">${w.enabled ? 'Active' : 'Inactive'}</span></div>
            <div class="row"><button class="btn primary" id="sb-save">${icon('check')} Save</button></div>
        </div>`;

    $('#sb-save').onclick = async () => {
        const btn = $('#sb-save'); btn.disabled = true; btn.textContent = 'Saving…';
        const r = await api(`/api/guild/${g.id}/starboard-config`, { method: 'PUT', body: JSON.stringify({
            enabled: $('#sb-enabled').checked,
            channelId: $('#sb-channel').value || null,
            threshold: Number.parseInt($('#sb-threshold').value) || 3
        })});
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (r && !r._error) toast('Starboard saved!', 'success');
        else toast(r?.error || 'Save failed', 'error');
    };
}

// ═══════════════════════════════════════════════════════════
// COUNTING
// ═══════════════════════════════════════════════════════════
async function pageCounting() {
    const g = state.currentGuild;
    const [cfg, channels] = await Promise.all([
        api(`/api/guild/${g.id}/counting-config`),
        api(`/api/guild/${g.id}/channels`),
    ]);
    state.channels = Array.isArray(channels) ? channels : [];
    const w = cfg && !cfg._error ? cfg : { enabled: false, channelId: null, currentCount: 0, highScore: 0, totalCounts: 0, fails: 0 };

    const chSel = state.channels.filter(c => c.type === 0 || c.type === 5)
        .map(c => `<option value="${esc(c.id)}" ${w.channelId === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('');

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Counting</h1><p>Counting game for ${esc(g.name)}.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('hash')}</div><div class="tt"><div class="t">Setup</div><div class="s">Members count 1, 2, 3… in a dedicated channel. Same user can't count twice in a row.</div></div></div>
            <div class="switch-row"><div><div class="lbl">Enable Counting</div></div><label class="switch"><input type="checkbox" id="ct-enabled" ${w.enabled ? 'checked' : ''}><span class="slide"></span></label></div>
            <div class="form-row mt-2"><label>Counting Channel</label><select id="ct-channel"><option value="">— None —</option>${chSel}</select></div>
        </div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('chart')}</div><div class="tt"><div class="t">Stats</div><div class="s">Live counting statistics.</div></div></div>
            <div class="grid g-4">
                <div class="stat purple"><div class="ic">${icon('hash')}</div><div><div class="v">${w.currentCount}</div><div class="l">Current</div></div></div>
                <div class="stat green"><div class="ic">${icon('trend')}</div><div><div class="v">${w.highScore}</div><div class="l">High Score</div></div></div>
                <div class="stat cyan"><div class="ic">${icon('check')}</div><div><div class="v">${w.totalCounts}</div><div class="l">Total</div></div></div>
                <div class="stat red"><div class="ic">${icon('user-x')}</div><div><div class="v">${w.fails}</div><div class="l">Fails</div></div></div>
            </div>
            <button class="btn danger mt-2" onclick="window.__countingReset()">${icon('log')} Reset Count to 0</button>
        </div>

        <div class="save-bar">
            <div class="row"><span class="tag ${w.enabled ? 'green' : 'grey'}">${w.enabled ? 'Active' : 'Inactive'}</span></div>
            <div class="row"><button class="btn primary" id="ct-save">${icon('check')} Save</button></div>
        </div>`;

    $('#ct-save').onclick = async () => {
        const btn = $('#ct-save'); btn.disabled = true; btn.textContent = 'Saving…';
        const r = await api(`/api/guild/${g.id}/counting-config`, { method: 'PUT', body: JSON.stringify({
            enabled: $('#ct-enabled').checked,
            channelId: $('#ct-channel').value || null
        })});
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (r && !r._error) toast('Counting saved!', 'success');
        else toast(r?.error || 'Save failed', 'error');
    };
}
window.__countingReset = async () => {
    if (!confirm('Reset the count to 0?')) return;
    const g = state.currentGuild;
    await api(`/api/guild/${g.id}/counting-config`, { method: 'PUT', body: JSON.stringify({ enabled: true, channelId: null, reset: true }) });
    toast('Count reset to 0', 'success');
    pageCounting();
};

// ═══════════════════════════════════════════════════════════
// AUTOREACT
// ═══════════════════════════════════════════════════════════
async function pageAutoreact() {
    const g = state.currentGuild;
    const cfg = await api(`/api/guild/${g.id}/autoreact-config`);
    const w = cfg && !cfg._error ? cfg : { enabled: false, reactions: [] };
    window.__arWorking = structuredClone(w);

    _renderAutoreactBody(g);
}

function _renderAutoreactBody(g) {
    const w = window.__arWorking;
    const reactionsHtml = (w.reactions || []).map((r, i) => `
        <div class="listi" style="display:block;margin-bottom:.5rem">
            <div class="row mb-1">
                <span class="tag">"${esc(r.trigger)}"</span>
                <span class="text-mute">→</span>
                <span>${r.emojis.map(e => esc(e)).join(' ')}</span>
                <span class="spacer"></span>
                <button class="btn sm danger" onclick="window.__arRemove(${i})">×</button>
            </div>
        </div>
    `).join('') || '<div class="text-sm text-mute">No triggers configured. Add one below.</div>';

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Auto-React</h1><p>Auto-add reactions when messages contain trigger words.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('smile')}</div><div class="tt"><div class="t">Auto-React</div><div class="s">Bot reacts with emojis when a message contains a trigger word.</div></div></div>
            <div class="switch-row"><div><div class="lbl">Enable Auto-React</div></div><label class="switch"><input type="checkbox" id="ar-enabled" ${w.enabled ? 'checked' : ''}><span class="slide"></span></label></div>
        </div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('chat')}</div><div class="tt"><div class="t">Triggers (${(w.reactions||[]).length})</div><div class="s">When a message contains the trigger word, bot reacts with the emojis.</div></div></div>
            ${reactionsHtml}
            <hr>
            <h4 class="mb-1">Add Trigger</h4>
            <div class="grid g-2">
                <div class="form-row"><label>Trigger Word</label><input type="text" id="ar-trigger" placeholder="hello"><div class="hint">Case insensitive. First match wins.</div></div>
                <div class="form-row"><label>Emojis (space-separated)</label><input type="text" id="ar-emojis" placeholder="👋 🎉 <:Heart:1521228100652765247>"><div class="hint">Standard emojis or custom &lt;:name:id&gt;</div></div>
            </div>
            <button class="btn sm" onclick="window.__arAdd()">${icon('user-plus')} Add Trigger</button>
        </div>

        <div class="save-bar">
            <div class="row"><span class="tag ${w.enabled ? 'green' : 'grey'}">${w.enabled ? 'Active' : 'Inactive'}</span></div>
            <div class="row"><button class="btn primary" id="ar-save">${icon('check')} Save</button></div>
        </div>`;

    $('#ar-save').onclick = async () => {
        const btn = $('#ar-save'); btn.disabled = true; btn.textContent = 'Saving…';
        window.__arWorking.enabled = $('#ar-enabled').checked;
        const r = await api(`/api/guild/${g.id}/autoreact-config`, { method: 'PUT', body: JSON.stringify(window.__arWorking) });
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (r && !r._error) toast('Auto-React saved!', 'success');
        else toast(r?.error || 'Save failed', 'error');
    };
}
window.__arAdd = () => {
    const trigger = ($('#ar-trigger').value || '').trim().toLowerCase();
    const emojis = ($('#ar-emojis').value || '').trim().split(/\s+/).filter(Boolean);
    if (!trigger) return toast('Enter a trigger word', 'error');
    if (!emojis.length) return toast('Enter at least one emoji', 'error');
    window.__arWorking.reactions = window.__arWorking.reactions || [];
    window.__arWorking.reactions.push({ trigger, emojis });
    _renderAutoreactBody(state.currentGuild);
};
window.__arRemove = (i) => {
    window.__arWorking.reactions.splice(i, 1);
    _renderAutoreactBody(state.currentGuild);
};

// ═══════════════════════════════════════════════════════════
// GIVEAWAY
// ═══════════════════════════════════════════════════════════
async function pageGiveaway() {
    const g = state.currentGuild;
    const [cfg, roles, activeGiveaways] = await Promise.all([
        api(`/api/guild/${g.id}/giveaway-settings`),
        api(`/api/guild/${g.id}/roles`),
        api(`/api/guild/${g.id}/giveaways`),
    ]);
    state.roles = Array.isArray(roles) ? roles.filter(r => r.name !== '@everyone') : [];
    const w = cfg && !cfg._error ? cfg : { defaultDuration: 60, defaultWinners: 1, pingRole: null, dmWinners: true, showParticipants: true, requireRole: null, bypassRole: null };
    const giveaways = Array.isArray(activeGiveaways) ? activeGiveaways : [];

    const roleSel = (id, val) => {
        const opts = state.roles.map(r => `<option value="${esc(r.id)}" ${val === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
        return `<select id="${id}"><option value="">— None —</option>${opts}</select>`;
    };

    const activeHtml = giveaways.length ? `
        <table class="tbl">
            <thead><tr><th>Prize</th><th>Winners</th><th>Entries</th><th>Ends</th><th>Status</th></tr></thead>
            <tbody>${giveaways.map(ga => {
                const timeLeft = ga.endTime - Date.now();
                let status = '<span class="tag amber">Ending…</span>';
                if (ga.ended) status = '<span class="tag grey">Ended</span>';
                else if (timeLeft > 0) status = `<span class="tag green">${Math.round(timeLeft / 60000)}m left</span>`;
                return `<tr><td><b>${esc(ga.prize)}</b></td><td>${ga.winners}</td><td>${ga.participants}</td><td>${new Date(ga.endTime).toLocaleString()}</td><td>${status}</td></tr>`;
            }).join('')}</tbody>
        </table>
    ` : '<div class="text-sm text-mute">No active giveaways. Use <code>/giveaway create</code> in Discord to start one.</div>';

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Giveaways</h1><p>Giveaway settings for ${esc(g.name)}.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('gift')}</div><div class="tt"><div class="t">Default Settings</div><div class="s">Defaults used when creating new giveaways via <code>/giveaway create</code>.</div></div></div>
            <div class="grid g-2">
                <div class="form-row"><label>Default Duration (minutes)</label><input type="number" id="ga-duration" value="${w.defaultDuration}" min="1" max="43200"></div>
                <div class="form-row"><label>Default Winners</label><input type="number" id="ga-winners" value="${w.defaultWinners}" min="1" max="20"></div>
            </div>
            <hr>
            <div class="form-row"><label>Ping Role (on giveaway start)</label>${roleSel('ga-ping', w.pingRole)}</div>
            <div class="form-row"><label>Required Role (to enter)</label>${roleSel('ga-require', w.requireRole)}<div class="hint">Only members with this role can enter giveaways.</div></div>
            <div class="form-row"><label>Bypass Role (skip requirements)</label>${roleSel('ga-bypass', w.bypassRole)}</div>
            <hr>
            <div class="switch-row"><div><div class="lbl">DM Winners</div><div class="desc">Send a DM to winners when they win.</div></div><label class="switch"><input type="checkbox" id="ga-dm" ${w.dmWinners ? 'checked' : ''}><span class="slide"></span></label></div>
            <div class="switch-row"><div><div class="lbl">Show Participants</div><div class="desc">Show entry count on the giveaway message.</div></div><label class="switch"><input type="checkbox" id="ga-show" ${w.showParticipants ? 'checked' : ''}><span class="slide"></span></label></div>
        </div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('chart')}</div><div class="tt"><div class="t">Active Giveaways (${giveaways.length})</div><div class="s">Currently running or recently ended giveaways.</div></div></div>
            ${activeHtml}
            <div class="hint mt-2">Create, end, and reroll giveaways via <code>/giveaway</code> in Discord.</div>
        </div>

        <div class="save-bar">
            <div class="row"><span class="tag green">Settings</span></div>
            <div class="row"><button class="btn primary" id="ga-save">${icon('check')} Save Settings</button></div>
        </div>`;

    $('#ga-save').onclick = async () => {
        const btn = $('#ga-save'); btn.disabled = true; btn.textContent = 'Saving…';
        const r = await api(`/api/guild/${g.id}/giveaway-settings`, { method: 'PUT', body: JSON.stringify({
            defaultDuration: Number.parseInt($('#ga-duration').value) || 60,
            defaultWinners: Number.parseInt($('#ga-winners').value) || 1,
            pingRole: $('#ga-ping').value || null,
            requireRole: $('#ga-require').value || null,
            bypassRole: $('#ga-bypass').value || null,
            dmWinners: $('#ga-dm').checked,
            showParticipants: $('#ga-show').checked
        })});
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save Settings';
        if (r && !r._error) toast('Giveaway settings saved!', 'success');
        else toast(r?.error || 'Save failed', 'error');
    };
}
