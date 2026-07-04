/* =========================================================
   xNico Dashboard — community.js
   Autorole, Suggestions, Feedback modules.
   ========================================================= */

// ═══════════════════════════════════════════════════════════
// AUTOROLE
// ═══════════════════════════════════════════════════════════
async function pageAutorole() {
    const g = state.currentGuild;
    const [cfg, roles] = await Promise.all([
        api(`/api/guild/${g.id}/autorole-config`),
        api(`/api/guild/${g.id}/roles`),
    ]);
    state.roles = Array.isArray(roles) ? roles.filter(r => r.name !== '@everyone') : [];
    const w = cfg && !cfg._error ? cfg : { humans: [], bots: [] };
    window.__aroleWorking = JSON.parse(JSON.stringify(w));
    _renderAutorolePage(g);
}

function _renderAutorolePage(g) {
    const w = window.__aroleWorking;
    const humanChips = (w.humans || []).map(id => {
        const r = state.roles.find(x => x.id === id);
        return `<span class="chip">${esc(r?.name || id)} <button onclick="window.__aroleRm('humans','${esc(id)}')">×</button></span>`;
    }).join('') || '<span class="text-sm text-mute">None — new humans get no auto-role.</span>';
    const botChips = (w.bots || []).map(id => {
        const r = state.roles.find(x => x.id === id);
        return `<span class="chip">${esc(r?.name || id)} <button onclick="window.__aroleRm('bots','${esc(id)}')">×</button></span>`;
    }).join('') || '<span class="text-sm text-mute">None — new bots get no auto-role.</span>';

    const roleSel = (id) => `<select id="${id}"><option value="">— Pick role —</option>${state.roles.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>`;

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Auto-Role</h1><p>Auto-assign roles when members join ${esc(g.name)}.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('user-plus')}</div><div class="tt"><div class="t">Roles for Humans</div><div class="s">Assigned to real users when they join. Up to 10.</div></div></div>
            <div class="chips mb-2">${humanChips}</div>
            <div class="row">${roleSel('arole-human-sel')}<button class="btn sm" onclick="window.__aroleAdd('humans','arole-human-sel')">${icon('user-plus')} Add</button></div>
        </div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('settings')}</div><div class="tt"><div class="t">Roles for Bots</div><div class="s">Assigned to bots when they're added. Up to 10.</div></div></div>
            <div class="chips mb-2">${botChips}</div>
            <div class="row">${roleSel('arole-bot-sel')}<button class="btn sm" onclick="window.__aroleAdd('bots','arole-bot-sel')">${icon('user-plus')} Add</button></div>
        </div>

        <div class="save-bar">
            <div class="row"><span class="tag ${(w.humans.length||w.bots.length)?'green':'grey'}">${(w.humans.length+w.bots.length)} role${(w.humans.length+w.bots.length)!==1?'s':''}</span></div>
            <div class="row"><button class="btn primary" id="arole-save">${icon('check')} Save</button></div>
        </div>`;

    $('#arole-save').onclick = async () => {
        const btn = $('#arole-save'); btn.disabled = true; btn.textContent = 'Saving…';
        const r = await api(`/api/guild/${g.id}/autorole-config`, { method: 'PUT', body: JSON.stringify(window.__aroleWorking) });
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (r && !r._error) toast('Auto-Role saved!', 'success');
        else toast(r?.error || 'Save failed', 'error');
    };
}
window.__aroleAdd = (type, selId) => {
    const v = $(`#${selId}`).value;
    if (!v) return;
    const w = window.__aroleWorking;
    if (!w[type].includes(v) && w[type].length < 10) w[type].push(v);
    _renderAutorolePage(state.currentGuild);
};
window.__aroleRm = (type, id) => {
    window.__aroleWorking[type] = window.__aroleWorking[type].filter(x => x !== id);
    _renderAutorolePage(state.currentGuild);
};

// ═══════════════════════════════════════════════════════════
// SUGGESTIONS
// ═══════════════════════════════════════════════════════════
async function pageSuggestions() {
    const g = state.currentGuild;
    const [cfg, channels] = await Promise.all([
        api(`/api/guild/${g.id}/suggestions-config`),
        api(`/api/guild/${g.id}/channels`),
    ]);
    state.channels = Array.isArray(channels) ? channels : [];
    const w = cfg && !cfg._error ? cfg : { channelId: null, logsChannelId: null, voteThreshold: 10, threadSlowmode: 0, totalSuggestions: 0 };

    const textCh = state.channels.filter(c => c.type === 0 || c.type === 5);
    const chSel = (id, val) => `<select id="${id}"><option value="">— None —</option>${textCh.map(c => `<option value="${esc(c.id)}" ${val === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select>`;

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Suggestions</h1><p>Community suggestion system for ${esc(g.name)}.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('bulb')}</div><div class="tt"><div class="t">Configuration</div><div class="s">Where suggestions are posted and how voting works.</div></div></div>
            <div class="form-row"><label>Suggestion Channel</label>${chSel('sug-ch', w.channelId)}<div class="hint">Members submit suggestions here (or via <code>/suggest</code>).</div></div>
            <div class="form-row"><label>Logs Channel</label>${chSel('sug-logs', w.logsChannelId)}<div class="hint">Suggestions that reach the vote threshold are logged here.</div></div>
            <div class="form-row"><label>Vote Threshold</label><input type="number" id="sug-threshold" value="${w.voteThreshold}" min="1" max="100"><div class="hint">Upvotes needed to auto-log a suggestion.</div></div>
            <div class="form-row"><label>Thread Slowmode (seconds)</label><input type="number" id="sug-slowmode" value="${w.threadSlowmode}" min="0" max="21600"><div class="hint">Slowmode for discussion threads. 0 = off.</div></div>
            <hr>
            <div class="text-sm text-mute">Total suggestions submitted: <b>${w.totalSuggestions}</b></div>
        </div>

        <div class="card mb-2" style="font-size:.85rem">
            <h3>How It Works</h3>
            <ol style="padding-left:1.2rem;margin:.5rem 0;line-height:1.8">
                <li>Members type in the suggestion channel or use <code>/suggest</code></li>
                <li>Bot creates a formatted suggestion card with 👍/👎 vote buttons</li>
                <li>A discussion thread is auto-created for each suggestion</li>
                <li>When upvotes reach the threshold, it's logged to the logs channel</li>
                <li>Admins can approve/deny via <code>/suggestion manage</code></li>
            </ol>
        </div>

        <div class="save-bar">
            <div class="row"><span class="tag ${w.channelId ? 'green' : 'grey'}">${w.channelId ? 'Active' : 'Not Set Up'}</span></div>
            <div class="row"><button class="btn primary" id="sug-save">${icon('check')} Save</button></div>
        </div>`;

    $('#sug-save').onclick = async () => {
        const btn = $('#sug-save'); btn.disabled = true; btn.textContent = 'Saving…';
        const r = await api(`/api/guild/${g.id}/suggestions-config`, { method: 'PUT', body: JSON.stringify({
            channelId: $('#sug-ch').value || null,
            logsChannelId: $('#sug-logs').value || null,
            voteThreshold: parseInt($('#sug-threshold').value) || 10,
            threadSlowmode: parseInt($('#sug-slowmode').value) || 0
        })});
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (r && !r._error) toast('Suggestions saved!', 'success');
        else toast(r?.error || 'Save failed', 'error');
    };
}

// ═══════════════════════════════════════════════════════════
// FEEDBACK
// ═══════════════════════════════════════════════════════════
async function pageFeedback() {
    const g = state.currentGuild;
    const [cfg, channels] = await Promise.all([
        api(`/api/guild/${g.id}/feedback-config`),
        api(`/api/guild/${g.id}/channels`),
    ]);
    state.channels = Array.isArray(channels) ? channels : [];
    const w = cfg && !cfg._error ? cfg : { channelId: null, logsChannelId: null, totalCount: 0, ratings: {1:0,2:0,3:0,4:0,5:0}, averageRating: 0 };

    const textCh = state.channels.filter(c => c.type === 0 || c.type === 5);
    const chSel = (id, val) => `<select id="${id}"><option value="">— None —</option>${textCh.map(c => `<option value="${esc(c.id)}" ${val === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select>`;

    // Rating distribution bar
    const maxR = Math.max(1, ...Object.values(w.ratings || {}));
    const ratingBars = [5,4,3,2,1].map(n => {
        const count = (w.ratings || {})[n] || 0;
        const pct = Math.round(count / maxR * 100);
        return `<div class="row" style="gap:.5rem;margin-bottom:.3rem">
            <span class="text-xs bold" style="width:20px">${n}⭐</span>
            <div style="flex:1;height:14px;background:var(--bg-hover);border-radius:7px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent),var(--accent-2));border-radius:7px;transition:width .3s"></div>
            </div>
            <span class="text-xs text-mute" style="width:30px;text-align:right">${count}</span>
        </div>`;
    }).join('');

    $('#page').innerHTML = `
        <div class="page-h"><div><h1>Feedback</h1><p>Star-rating feedback system for ${esc(g.name)}.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div></div>

        <div class="grid g-2 mb-2">
            <div class="card">
                <div class="card-h"><div class="ic">${icon('star')}</div><div class="tt"><div class="t">Analytics</div><div class="s">Feedback ratings overview.</div></div></div>
                <div class="center mt-2" style="padding:1rem">
                    <div style="font-size:2.5rem;font-weight:900" class="grad-text">${w.averageRating || '—'}</div>
                    <div class="text-xs text-mute">Average Rating</div>
                    <div class="text-xs text-mute mt-1">${w.totalCount} total feedback${w.totalCount !== 1 ? 's' : ''}</div>
                </div>
                <hr>
                ${ratingBars}
            </div>

            <div class="card">
                <div class="card-h"><div class="ic">${icon('settings')}</div><div class="tt"><div class="t">Configuration</div><div class="s">Where feedback is collected and logged.</div></div></div>
                <div class="form-row"><label>Feedback Channel</label>${chSel('fb-ch', w.channelId)}<div class="hint">Members use <code>/feedback</code> or the button here to submit.</div></div>
                <div class="form-row"><label>Logs Channel</label>${chSel('fb-logs', w.logsChannelId)}<div class="hint">All feedback entries are logged here for staff review.</div></div>
                <hr>
                <div class="text-sm text-mute">Members submit feedback via <code>/feedback</code> command. They rate 1-5 stars and leave a comment.</div>
            </div>
        </div>

        <div class="save-bar">
            <div class="row"><span class="tag ${w.channelId ? 'green' : 'grey'}">${w.channelId ? 'Active' : 'Not Set Up'}</span></div>
            <div class="row"><button class="btn primary" id="fb-save">${icon('check')} Save</button></div>
        </div>`;

    $('#fb-save').onclick = async () => {
        const btn = $('#fb-save'); btn.disabled = true; btn.textContent = 'Saving…';
        const r = await api(`/api/guild/${g.id}/feedback-config`, { method: 'PUT', body: JSON.stringify({
            channelId: $('#fb-ch').value || null,
            logsChannelId: $('#fb-logs').value || null
        })});
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (r && !r._error) toast('Feedback saved!', 'success');
        else toast(r?.error || 'Save failed', 'error');
    };
}
