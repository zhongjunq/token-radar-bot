// Token Radar dashboard: renders window.RADAR (written by main.ts into
// data.js) as a sortable, filterable board, a detail view per protocol with
// its model breakdown and farm plan, a live-token comparison, and the model
// notes. No fetch, no network: every number comes from the snapshot's data.
'use strict';

const D = window.RADAR;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** $1.23B / $456.7M / $89.2K / $123. */
function money(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
}

/** +12.3% / -4.5% / — for a missing change. */
function pct(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
}

function ageText(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days < 30) return days + ' days';
  if (days < 365) return (days / 30).toFixed(1) + ' months';
  return (days / 365).toFixed(1) + ' years';
}

const state = {
  view: 'board',
  detailSlug: null,
  q: '',
  category: '',
  chain: '',
  floorOnly: false,
  sort: 'implied',
  dir: -1,
};


/** Fill the category and chain selects from the rows on the board. */
function fillFilters() {
  const cats = [...new Set(D.rows.map((r) => r.category || '(none)'))].sort();
  const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
  for (const c of cats) {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    $('f-category').appendChild(o);
  }
  for (const c of chains) {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    $('f-chain').appendChild(o);
  }
}

const SORTS = {
  rank: (r) => r.rank,
  name: (r) => r.name.toLowerCase(),
  category: (r) => (r.category || '').toLowerCase(),
  tvl: (r) => r.tvl_usd,
  growth: (r) => r.change_7d ?? -Infinity,
  implied: (r) => r.implied_value_usd,
  multiple: (r) => r.multiple,
};

/** The board rows after the current filters and sort. */
function visibleRows() {
  const q = state.q.trim().toLowerCase();
  let rows = D.rows.filter((r) => {
    if (state.category && (r.category || '(none)') !== state.category) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.floorOnly && r.tvl_usd < D.floor_usd) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
    return true;
  });
  const key = SORTS[state.sort] || SORTS.implied;
  rows = [...rows].sort((a, b) => {
    const va = key(a), vb = key(b);
    const cmp = va < vb ? -1 : va > vb ? 1 : a.rank - b.rank;
    return cmp * state.dir;
  });
  return rows;
}

function rowHtml(r) {
  const chg = r.change_7d;
  const cls = chg === null ? '' : chg >= 0 ? 'up' : 'down';
  return '<tr data-slug="' + esc(r.slug) + '">'
    + '<td class="num">' + r.rank + '</td>'
    + '<td class="name">' + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></td>'
    + '<td>' + esc(r.category || '—') + '</td>'
    + '<td>' + esc(r.chains.slice(0, 3).join(', ') || '—') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>'
    + '<td class="num">' + money(r.tvl_usd) + '</td>'
    + '<td class="num ' + cls + '">' + pct(chg) + '</td>'
    + '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>'
    + '<td class="num">' + r.multiple.toFixed(2) + '×</td>'
    + '</tr>';
}

function renderBoard() {
  const rows = visibleRows();
  $('board-body').innerHTML = rows.map(rowHtml).join('')
    || '<tr><td colspan="8">No protocol matches these filters.</td></tr>';
  $('board-count').innerHTML = 'Showing <strong>' + rows.length + '</strong> of <strong>'
    + D.rows.length + '</strong> ranked protocols · <strong>' + D.watchlist_size
    + '</strong> on the watchlist · floor ' + money(D.floor_usd);
}


// --- Farm plan, derived from a row's own fields exactly as the model does:
// capital from TVL, hold length from age, the action from the category. ---

function capitalFor(tvl) {
  if (tvl >= 5e9) return 250;
  if (tvl >= 1e9) return 150;
  if (tvl >= 1e8) return 100;
  return 50;
}

function holdDaysFor(age) {
  if (age === null || age === undefined) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(row, capital, chain) {
  const c = (row.category || '').toLowerCase();
  const name = row.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and leave the deposit earning for the full window.';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return 'Provide $' + capital + ' of liquidity to ' + name + "'s deepest pool on " + chain + ' and keep the position in range.';
  if (c.includes('bridge')) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds inside its app.';
  if (c.includes('staking') || c.includes('restak')) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
  if (c.includes('prediction')) return 'Fund $' + capital + ' on ' + name + ' and take one small position in an open market.';
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the vault shares.';
  if (c.includes('stable')) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
  if (c.includes('rwa')) return 'Mint $' + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
  if (c.includes('insurance')) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
  if (c.includes('chain')) return 'Bridge $' + capital + ' of USDC to ' + name + ' and use one of its native apps each week.';
  return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
}

/** The six farm steps for one row, as "action. Cost: …. Time: …." */
function farmSteps(row) {
  const chain = row.chains.length > 0 ? row.chains[0] : 'its main chain';
  const capital = capitalFor(row.tvl_usd);
  const hold = holdDaysFor(row.age_days);
  const gas = capital >= 150 ? 8 : 4;
  const steps = [
    ['Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'],
    [actionFor(row, capital, chain), '$' + capital + ' of capital and about $' + gas + ' of gas', '15 minutes to set up'],
    ['Do one qualifying action each week on ' + chain + ', such as a deposit, a swap, a borrow or a vote.', 'about $2 of gas a week', '10 minutes a week'],
    ['Hold the position for at least ' + hold + ' days so the activity lands in more than one snapshot.', 'the $' + capital + ' stays in the position', hold + ' days'],
    ["Before you withdraw, open the protocol's own points page from its official site and claim only through the link it publishes.", 'no fee to check, and never pay anyone to claim', '10 minutes'],
    ['Log the wallet, the dates and every transaction, then unwind in tranches instead of all at once.', 'nothing but the log', '5 minutes'],
  ];
  return steps.map((s) => s[0] + ' Cost: ' + s[1] + '. Time: ' + s[2] + '.');
}


/** Fill the detail view for one slug; falls back to the board when unknown. */
function renderDetail(slug) {
  const r = D.rows.find((x) => x.slug === slug);
  if (!r) { showView('board'); return; }
  state.detailSlug = slug;
  const m = D.model;
  const base = r.tvl_usd * r.multiple;
  $('d-name').textContent = r.name;
  $('d-sub').textContent = '#' + r.rank + ' · ' + (r.category || 'uncategorised') + ' · TVL ' + money(r.tvl_usd) + ' · 7d ' + pct(r.change_7d) + ' · ' + ageText(r.age_days) + ' old · multiple ' + r.multiple.toFixed(2) + '× · ' + (r.chains.slice(0, 5).join(', ') || 'no chain listed') + (r.chains.length > 5 ? ' +' + (r.chains.length - 5) : '') + ' · slug ' + r.slug;
  $('d-implied').textContent = money(r.implied_value_usd);
  $('d-rank').textContent = 'rank ' + r.rank + ' of ' + D.rows.length;
  const rows = [
    ['TVL × multiple', money(r.tvl_usd) + ' × ' + r.multiple.toFixed(2) + ' = ' + money(base), 'The market pays ' + r.multiple.toFixed(2) + '× TVL for this kind of protocol.'],
    ['Growth', '× ' + r.growth_multiplier.toFixed(2), '7-day TVL change ' + pct(r.change_7d) + ', clamped to −' + Math.abs(m.growth_floor) + '%…+' + m.growth_cap + '%, at half weight.'],
    ['Maturity', '× ' + r.maturity_multiplier.toFixed(2), 'Age ' + ageText(r.age_days) + ': 0.60 at listing, rising to 1.00 over ' + m.maturity_days + ' days.'],
    ['Breadth', '× ' + r.breadth_multiplier.toFixed(2), r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ': +2% per extra chain, up to five.'],
    ['Implied value', money(r.implied_value_usd), 'TVL × multiple × growth × maturity × breadth, floored at $1.'],
  ];
  $('d-model').innerHTML = rows.map((x) => '<tr><td>' + esc(x[0]) + '</td><td class="num"><strong>' + esc(x[1]) + '</strong></td><td>' + esc(x[2]) + '</td></tr>').join('');
  $('d-steps').innerHTML = farmSteps(r).map((s) => '<li>' + esc(s) + '</li>').join('');
  showView('detail');
}

function renderLive() {
  $('live-body').innerHTML = D.live.map((p, i) => {
    const ratio = p.mcap_usd !== null && p.tvl_usd > 0 ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—';
    const chg = p.change_7d;
    const cls = chg === null ? '' : chg >= 0 ? 'up' : 'down';
    return '<tr><td class="num">' + (i + 1) + '</td>'
      + '<td class="name">' + esc(p.name) + '</td>'
      + '<td>' + esc(p.category || '—') + '</td>'
      + '<td>' + esc(p.chains.slice(0, 3).join(', ') || '—') + '</td>'
      + '<td class="num">' + money(p.tvl_usd) + '</td>'
      + '<td class="num"><strong>' + money(p.mcap_usd) + '</strong></td>'
      + '<td class="num">' + ratio + '</td>'
      + '<td class="num ' + cls + '">' + pct(chg) + '</td></tr>';
  }).join('');
}


function renderModel() {
  const m = D.model;
  const rows = [
    ['Multiple', 'median mcap / TVL', 'Per category with at least ' + m.min_category_live + ' live tokens, else the global median. Clamped to ' + m.multiple_floor + '–' + m.multiple_cap + '.'],
    ['Growth', '1 + clamp(7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight, 'A rising protocol is worth more than a flat one; a falling one less.'],
    ['Maturity', m.maturity_floor + ' + min(age, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range, 'Older protocols have survived more; unknown age counts as ' + m.unknown_age_days + ' days.'],
    ['Breadth', '1 + ' + m.breadth_step + ' × min(chains − 1, ' + m.breadth_max_chains + ')', 'A protocol live on more chains reaches more users.'],
    ['Implied value', 'TVL × multiple × growth × maturity × breadth', 'Rounded to the dollar, floored at $1.'],
  ];
  $('model-body').innerHTML = rows.map((x) => '<tr><td>' + esc(x[0]) + '</td><td class="num"><strong>' + esc(x[1]) + '</strong></td><td>' + esc(x[2]) + '</td></tr>').join('');
  $('model-asof').textContent = D.as_of;
}

const VIEWS = ['board', 'live', 'model', 'detail'];
function showView(name) {
  state.view = name;
  for (const v of VIEWS) {
    const el = $('view-' + v);
    if (el) el.hidden = v !== name;
  }
  for (const b of document.querySelectorAll('.tab')) {
    b.classList.toggle('active', b.dataset.view === name || (name === 'detail' && b.dataset.view === 'board'));
  }
  window.scrollTo(0, 0);
}

/** Read the hash (#/board, #/detail/<slug>, #/live, #/model, plus board filters). */
function readHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const parts = (path || 'board').split('/');
  const params = new URLSearchParams(query || '');
  if (params.has('category')) state.category = params.get('category') || '';
  if (params.has('chain')) state.chain = params.get('chain') || '';
  if (params.has('q')) state.q = params.get('q') || '';
  if (params.has('sort')) state.sort = params.get('sort') || 'implied';
  if (params.has('floor')) state.floorOnly = params.get('floor') === '1';
  $('f-search').value = state.q;
  $('f-category').value = state.category;
  $('f-chain').value = state.chain;
  $('f-floor').checked = state.floorOnly;
  if (parts[0] === 'detail' && parts[1]) { renderDetail(parts[1]); return; }
  if (parts[0] === 'live') { renderLive(); showView('live'); return; }
  if (parts[0] === 'model') { renderModel(); showView('model'); return; }
  renderBoard();
  showView('board');
}

/** Keep the hash in step with the board filters, without reloading. */
function syncHash() {
  if (state.view !== 'board') return;
  const p = new URLSearchParams();
  if (state.category) p.set('category', state.category);
  if (state.chain) p.set('chain', state.chain);
  if (state.q) p.set('q', state.q);
  if (state.sort !== 'implied') p.set('sort', state.sort);
  if (state.floorOnly) p.set('floor', '1');
  const s = p.toString();
  history.replaceState(null, '', '#/board' + (s ? '?' + s : ''));
}


function wire() {
  $('f-search').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); syncHash(); });
  $('f-category').addEventListener('change', (e) => { state.category = e.target.value; renderBoard(); syncHash(); });
  $('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); syncHash(); });
  $('f-sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    state.dir = state.sort === 'name' ? 1 : -1;
    renderBoard(); syncHash();
  });
  $('f-floor').addEventListener('change', (e) => { state.floorOnly = e.target.checked; renderBoard(); syncHash(); });
  document.querySelectorAll('#board-table th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sort === key) { state.dir = -state.dir; }
      else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; }
      const sel = $('f-sort');
      if ([...sel.options].some((o) => o.value === key)) sel.value = key;
      renderBoard(); syncHash();
    });
  });
  $('board-body').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = '#/detail/' + tr.dataset.slug;
  });
  document.querySelectorAll('.tab').forEach((b) => {
    b.addEventListener('click', () => { location.hash = '#/' + b.dataset.view; });
  });
  $('detail-back').addEventListener('click', () => { location.hash = '#/board'; });
  window.addEventListener('hashchange', readHash);
}

function boot() {
  if (!D || !Array.isArray(D.rows)) {
    document.body.innerHTML = '<p style="padding:32px">Token Radar could not load its data (data.js missing).</p>';
    return;
  }
  $('pill-model').textContent = 'model ' + D.model_version;
  $('pill-asof').textContent = 'snapshot ' + D.as_of;
  $('pill-count').textContent = D.rows.length + ' rows · ' + D.watchlist_size + ' watchlist · ' + D.live_size + ' live';
  $('foot-asof').textContent = 'snapshot ' + D.as_of + ' · ' + D.rows.length + ' ranked protocols';
  $('f-category').value = state.category;
  $('f-chain').value = state.chain;
  $('f-search').value = state.q;
  $('f-floor').checked = state.floorOnly;
  fillFilters();
  $('f-category').value = state.category;
  $('f-chain').value = state.chain;
  wire();
  readHash();
}

boot();
