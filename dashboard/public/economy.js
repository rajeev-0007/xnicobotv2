/* =========================================================
   xNico Dashboard — economy.js
   Economy settings: currency style, rewards, toggles,
   leaderboard, and user balance management.
   Syncs to jsonStore 'economy-settings' + 'economy'.
   ========================================================= */

// Global Economy event handlers
window.__saveEconomy = async function() {
    try {
        const g = state.currentGuild;
        const payload = window.__working || {};
        toast('Saving Economy config...', 'info');
        const res = await api(`/api/guild/${g.id}/economy`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        if (res._error) {
            toast(`Failed: ${res.error || 'Unknown error'}`, 'error');
        } else {
            toast('Economy saved!', 'success');
            localStorage.removeItem(`draft:economy:${g.id}`);
        }
    } catch (e) {
        toast(`Error: ${e.message}`, 'error');
    }
};

window.__resetShop = async function() {
    if (!confirm('Reset shop to default? This cannot be undone.')) return;
    const g = state.currentGuild;
    const cfg = window.__working || {};
    cfg.shopItems = [];
    window.__working = cfg;
    localStorage.setItem(`draft:economy:${g.id}`, JSON.stringify(cfg));
    if (window.__renderModule) window.__renderModule();
};

async function pageEconomy() {
    const g = state.currentGuild;
    const [cfg, board] = await Promise.all([
        api(`/api/guild/${g.id}/economy-settings`),
        api(`/api/guild/${g.id}/economy-leaderboard`),
    ]);
    if (cfg?._error || cfg?._unauth) {
        $('#page').innerHTML = `<div class="empty"><h3>Failed to load</h3><p>${esc(cfg?.error || 'Unknown error')}</p></div>`;
        return;
    }

    const w = structuredClone(cfg || {});
    state.econBoard = Array.isArray(board) ? board : [];

    // Draft recovery
    const draftKey = `draft:economy:${g.id}`;
    let hasDraft = false;
    try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
            const draft = JSON.parse(raw);
            if (JSON.stringify(draft) !== JSON.stringify(w)) {
                Object.assign(w, draft);
                hasDraft = true;
            } else localStorage.removeItem(draftKey);
        }
    } catch { localStorage.removeItem(draftKey); }

    window.__working = w;
    window.__econSnapshot = structuredClone(cfg);
    window.__econDraftKey = draftKey;
    _renderEconomyBody(g, w, hasDraft);
}

function _persistEconDraft() {
    try {
        if (!window.__econDraftKey || !window.__working) return;
        if (JSON.stringify(window.__working) === JSON.stringify(window.__econSnapshot)) {
            localStorage.removeItem(window.__econDraftKey);
            const i = document.getElementById('econ-draft'); if (i) i.style.display = 'none';
        } else {
            localStorage.setItem(window.__econDraftKey, JSON.stringify(window.__working));
            const i = document.getElementById('econ-draft'); if (i) i.style.display = '';
        }
    } catch {}
}

function _renderEconomyBody(g, w, hasDraft) {
    const tog = (key, val, label, desc, extra) => {
        const descHtml = desc ? `<div class="desc">${esc(desc)}</div>` : '';
        const checkAttr = val ? 'checked' : '';
        const extAttr = extra || '';
        return `<div class="switch-row"><div><div class="lbl">${esc(label)}</div>${descHtml}</div><label class="switch"><input type="checkbox" data-key="${esc(key)}" ${checkAttr} ${extAttr}><span class="slide"></span></label></div>`;
    };

    // Currency preview
    const currPreview = `${renderDiscord(w.currency || '💰')} 1,500 ${renderDiscord(w.currencyName || 'coins')}`;

    // Leaderboard
    const board = (state.econBoard || []).slice(0, 15);
    const boardHtml = board.length ? `
        <table class="tbl">
            <thead><tr><th>#</th><th>User ID</th><th>Wallet</th><th>Bank</th><th>Total</th><th>Level</th></tr></thead>
            <tbody>
                ${board.map((u, i) => `<tr>
                    <td><span class="tag">${i+1}</span></td>
                    <td class="mono text-xs">${esc(u.userId)}</td>
                    <td>${u.coins.toLocaleString()}</td>
                    <td>${u.bank.toLocaleString()}</td>
                    <td><b>${u.total.toLocaleString()}</b></td>
                    <td>${u.level}</td>
                </tr>`).join('')}
            </tbody>
        </table>
    ` : '<div class="empty"><p class="text-sm text-mute">No economy data yet. Members earn coins via daily, work, gambling, etc.</p></div>';

    const html = `
        <div class="page-h">
            <div><h1>Economy</h1><p>Currency system for ${esc(g.name)}. Configure rewards, toggles, and manage balances.</p></div>
            <div class="row wrap"><a class="btn" href="#/server/${esc(g.id)}">${icon('home')} Overview</a></div>
        </div>

        <div id="econ-draft" class="row mb-2" style="${hasDraft ? '' : 'display:none'}">
            <span class="tag amber">⚠ Unsaved draft</span>
            <span class="text-sm text-mute">Auto-saved locally.</span>
        </div>

        <!-- CURRENCY STYLE -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('coin')}</div><div class="tt"><div class="t">Currency Style</div><div class="s">Customize how currency appears in all economy commands.</div></div></div>
            <div class="grid g-2">
                <div class="form-row"><label>Currency Symbol</label><input type="text" data-key="currency" value="${esc(w.currency || '💰')}" placeholder="💰"><div class="hint">Emoji or text (e.g. <:Sketch:1521228025365004471>, 🪙, $, ⛃)</div></div>
                <div class="form-row"><label>Currency Name</label><input type="text" data-key="currencyName" value="${esc(w.currencyName || 'coins')}" placeholder="coins"><div class="hint">Plural name (e.g. gems, gold, credits)</div></div>
            </div>
            <div class="mt-2" style="padding:.75rem 1rem;background:var(--bg-hover);border-radius:10px;border:1px solid var(--border)">
                <span class="text-sm text-mute">Preview:</span>
                <span class="bold" id="econ-preview">${currPreview}</span>
            </div>
            <div class="hint mt-2">Also configurable via <code>/currency set</code> or <code>-currency set</code> in Discord.</div>
        </div>

        <!-- REWARDS -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('star')}</div><div class="tt"><div class="t">Reward Settings</div><div class="s">How much members earn from commands.</div></div></div>
            <div class="grid g-2">
                <div class="form-row"><label>Daily Reward</label><input type="number" data-key="dailyReward" value="${w.dailyReward || 100}" min="0" max="1000000"></div>
                <div class="form-row"><label>Weekly Reward</label><input type="number" data-key="weeklyReward" value="${w.weeklyReward || 500}" min="0" max="10000000"></div>
                <div class="form-row"><label>Work Min Reward</label><input type="number" data-key="workMinReward" value="${w.workMinReward || 50}" min="0" max="1000000"></div>
                <div class="form-row"><label>Work Max Reward</label><input type="number" data-key="workMaxReward" value="${w.workMaxReward || 200}" min="0" max="1000000"></div>
                <div class="form-row"><label>Starting Balance</label><input type="number" data-key="startingBalance" value="${w.startingBalance || 0}" min="0" max="10000000"><div class="hint">New users start with this amount.</div></div>
                <div class="form-row"><label>Rob Success Chance (%)</label><input type="number" data-key="robChance" value="${w.robChance || 40}" min="0" max="100"></div>
            </div>
        </div>

        <!-- TOGGLES -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('settings')}</div><div class="tt"><div class="t">Feature Toggles</div><div class="s">Enable or disable economy features.</div></div></div>
            ${tog('robEnabled', w.robEnabled !== false, 'Rob Command', 'Allow members to rob each other.')}
            ${tog('gamblingEnabled', w.gamblingEnabled !== false, 'Gambling', 'Allow slots, dice, betflip, gamble commands.')}
            ${tog('shopEnabled', w.shopEnabled !== false, 'Shop', 'Allow the shop and item purchases.')}
        </div>

        <!-- LEADERBOARD -->
        <div class="card mb-2">
            <div class="card-h"><div class="ic">${icon('chart')}</div><div class="tt"><div class="t">Richest Members</div><div class="s">Top 15 by total wealth. Click ✏ to set balance, × to reset.</div></div></div>
            ${boardHtml}
        </div>

            ${['588982544545087498', '1264506198489563143'].includes(state.user?.id) ? `
            <div class="card mb-2" style="border: 1px solid #7c3aed;">
                <div class="card-h"><div class="ic"><span style="font-size: 1.5rem;">👑</span></div><div class="tt"><div class="t">Owner Panel</div><div class="s">Manage user economy balances directly.</div></div></div>
                <div class="form-grid">
                    <label class="field"><span>Target User ID</span>
                        <input type="text" id="owner-target-id" placeholder="Enter Discord User ID">
                    </label>
                    <div class="field" style="display: flex; gap: 0.5rem; align-items: flex-end;">
                        <button class="btn" onclick="const id = document.getElementById('owner-target-id').value; if(id) window.__econSetUser(id); else toast('Enter User ID', 'error');">✏ Set Balance</button>
                        <button class="btn danger" onclick="const id = document.getElementById('owner-target-id').value; if(id) window.__econResetUser(id); else toast('Enter User ID', 'error');">× Reset User</button>
                    </div>
                </div>
            </div>
            ` : ''}

        <!-- SAVE -->
        <div class="save-bar">
            <div class="row">
                <span class="tag green" id="econ-status">${esc(w.currency || '💰')} ${esc(w.currencyName || 'coins')}</span>
                <span class="text-sm text-mute">Saves to bot database. Currency change is live immediately.</span>
            </div>
            <div class="row">
                <button class="btn" id="econ-reset-btn">${icon('log')} Reset Draft</button>
                <button class="btn primary" id="econ-save-btn">${icon('check')} Save</button>
            </div>
        </div>
    `;

    $('#page').innerHTML = html;
    bindFormInputs(w);

    // Live preview update
    let pt;
    function updPreview() {
        const el = document.getElementById('econ-preview');
        if (el) el.innerHTML = `${renderDiscord(w.currency || '💰')} 1,500 ${renderDiscord(w.currencyName || 'coins')}`;
    }
    $('#page').addEventListener('input', () => { clearTimeout(pt); pt = setTimeout(() => { updPreview(); _persistEconDraft(); }, 200); });
    $('#page').addEventListener('change', () => { clearTimeout(pt); pt = setTimeout(() => { updPreview(); _persistEconDraft(); }, 100); });

    // Save / Reset
    $('#econ-reset-btn').onclick = () => {
        if (confirm('Discard draft and reload?')) {
            try { localStorage.removeItem(window.__econDraftKey); } catch {}
            handleRoute();
        }
    };
    $('#econ-save-btn').onclick = async () => {
        const btn = $('#econ-save-btn');
        btn.disabled = true; btn.textContent = 'Saving…';
        const r = await api(`/api/guild/${g.id}/economy-settings`, { method: 'PUT', body: JSON.stringify(w) });
        btn.disabled = false; btn.innerHTML = icon('check') + ' Save';
        if (!r || r._error || r._unauth) toast(r?.error || 'Save failed', 'error');
        else {
            toast('Economy settings saved — live now!', 'success');
            try { localStorage.removeItem(window.__econDraftKey); } catch {}
            window.__econSnapshot = structuredClone(w);
            const i = document.getElementById('econ-draft'); if (i) i.style.display = 'none';
            const st = document.getElementById('econ-status');
            if (st) st.textContent = `${w.currency || '💰'} ${w.currencyName || 'coins'}`;
        }
    };
}

// User balance management (immediate API calls)
window.__econSetUser = async (userId) => {
    const coins = prompt(`Set wallet for ${userId}:`, '0');
    if (coins === null) return;
    const bank = prompt(`Set bank for ${userId}:`, '0');
    if (bank === null) return;
    const g = state.currentGuild;
    const r = await api(`/api/guild/${g.id}/economy-user/${userId}/set`, {
        method: 'POST',
        body: JSON.stringify({ coins: Number(coins), bank: Number(bank) })
    });
    if (r && !r._error) { toast(`Balance set: ${r.coins} wallet, ${r.bank} bank`, 'success'); pageEconomy(); }
    else toast(r?.error || 'Failed', 'error');
};
window.__econResetUser = async (userId) => {
    if (!confirm(`Reset ALL economy data for user ${userId}?`)) return;
    const g = state.currentGuild;
    const r = await api(`/api/guild/${g.id}/economy-user/${userId}`, { method: 'DELETE' });
    if (r && !r._error) { toast('User economy reset', 'success'); pageEconomy(); }
    else toast(r?.error || 'Failed', 'error');
};
