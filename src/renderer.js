(() => {
  const $ = (id) => document.getElementById(id);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const PREFERRED = ['NGN', 'USD', 'GBP', 'EUR', 'CAD', 'JPY', 'CNY', 'CHF', 'ZAR', 'GHS', 'XOF', 'AED', 'INR'];
  const TICKER = ['USD', 'GBP', 'EUR', 'CAD', 'CNY', 'GHS', 'ZAR', 'BTC', 'ETH', 'USDT', 'SOL'];
  const CHIPS = [['USD', 'NGN'], ['GBP', 'NGN'], ['EUR', 'NGN'], ['BTC', 'NGN'], ['ETH', 'USD'], ['USD', 'EUR'], ['NGN', 'USD']];
  const CRYPTO = new Set(Rates.CRYPTO_CODES);
  const CRYPTO_NAMES = Object.fromEntries(Rates.COINS.map((c) => [c.code, c.name]));
  let dn = null;
  try { dn = new Intl.DisplayNames(['en'], { type: 'currency' }); } catch { /* codes only */ }

  let table = null, settings = {}, timer = null;
  let prevNgn = {}, dirs = {};
  let watch = LS.get('ice.watch', ['USD', 'EUR', 'GBP', 'NGN', 'BTC', 'ETH']);
  let alerts = LS.get('ice.alerts', []);
  let lastResultText = '';
  let bankStore = { banks: {} }, cbnTable = null;
  const BANKS = ['GTBank', 'Zenith Bank', 'Access Bank', 'UBA', 'First Bank', 'Stanbic IBTC', 'FCMB', 'Fidelity Bank', 'Sterling Bank', 'Union Bank', 'Wema Bank', 'Polaris Bank', 'Ecobank', 'Standard Chartered'];
  const SRC_LABEL = { coingecko: 'CoinGecko', binance: 'Binance', coinbase: 'Coinbase' };

  const isMarket = () => settings.sourceMode === 'market';
  const name = (c) => CRYPTO_NAMES[c] || (() => { try { const n = dn && dn.of(c); return n && n !== c ? n : ''; } catch { return ''; } })();
  const label = (c) => { const n = name(c); return n ? `${c} — ${n}` : c; };

  function fmt(n, code) {
    const crypto = CRYPTO.has(code);
    if (n >= 1) return n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: crypto ? 8 : 2 });
    return n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  }
  const has = (c) => c === 'NGN' || (table && table.rates[c]);
  const allCodes = () => {
    const fiat = ['NGN', ...Object.keys(table.rates).filter((c) => !CRYPTO.has(c))].sort((a, b) => {
      const ia = PREFERRED.indexOf(a), ib = PREFERRED.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
    });
    const crypto = Rates.COINS.map((c) => c.code).filter((c) => table.rates[c]);
    return { fiat, crypto };
  };
  const curMode = () => (isMarket() ? 'central' : ($('mode').value === 'central' ? 'central' : 'buysell'));
  const rateOf = (from, to) => Rates.convert(1, from, to, table, curMode()).rate;

  /* ---------- selects ---------- */
  function optionsHtml(exclude) {
    const { fiat, crypto } = allCodes();
    const o = (c) => `<option value="${c}">${esc(label(c))}</option>`;
    const f = fiat.filter((c) => !(exclude || []).includes(c)), k = crypto.filter((c) => !(exclude || []).includes(c));
    return (f.length ? `<optgroup label="Currencies">${f.map(o).join('')}</optgroup>` : '') +
      (k.length ? `<optgroup label="Crypto">${k.map(o).join('')}</optgroup>` : '');
  }
  function fillSelects() {
    const pf = $('from').value, pt = $('to').value;
    const html = optionsHtml();
    $('from').innerHTML = html; $('to').innerHTML = html;
    const { fiat, crypto } = allCodes(); const all = [...fiat, ...crypto];
    $('from').value = all.includes(pf) ? pf : (all.includes('USD') ? 'USD' : all[0]);
    $('to').value = all.includes(pt) ? pt : 'NGN';
  }

  /* ---------- ticker ---------- */
  function updateDirs() {
    for (const [c, r] of Object.entries(table.rates)) {
      const cur = r.central, prev = prevNgn[c];
      if (prev && cur !== prev) dirs[c] = cur > prev ? 'up' : 'down';
      prevNgn[c] = cur;
    }
  }
  function renderTicker() {
    const items = TICKER.filter((c) => table.rates[c]).map((c) => {
      const v = table.rates[c].central, d = dirs[c] || '';
      const arrow = d === 'up' ? '▲' : d === 'down' ? '▼' : '';
      const num = v.toLocaleString('en-NG', { minimumFractionDigits: v >= 1e6 ? 0 : 2, maximumFractionDigits: v >= 1e6 ? 0 : 2 });
      return `<span class="tk"><b>${c}</b><span class="${d}">₦${num} ${arrow}</span></span>`;
    }).join('');
    $('track').innerHTML = items + items;
  }

  /* ---------- chips ---------- */
  function renderChips() {
    const f = $('from').value, t = $('to').value;
    $('chips').innerHTML = CHIPS.filter(([a, b]) => has(a) && has(b)).map(([a, b]) =>
      `<button class="chip${a === f && b === t ? ' on' : ''}" data-a="${a}" data-b="${b}">${a} → ${b}</button>`).join('');
  }

  /* ---------- watchlist ---------- */
  function renderWatch() {
    const amount = parseFloat($('amount').value.replace(/,/g, ''));
    const from = $('from').value, to = $('to').value;
    const list = watch.filter(has);
    $('watch').innerHTML = list.map((c) => {
      let val = '—';
      if (Number.isFinite(amount) && amount >= 0) { try { val = fmt(Rates.convert(amount, from, c, table, curMode()).result, c); } catch { /* n/a */ } }
      return `<div class="wrow${c === to ? ' cur' : ''}" data-code="${c}">
        <span class="wbadge${CRYPTO.has(c) ? ' crypto' : ''}">${c}</span><span class="wname">${esc(name(c))}</span>
        <span class="wval">${esc(val)}</span><button class="x" data-remove="${c}" title="Remove">&#10005;</button></div>`;
    }).join('') || '<div class="muted">Add currencies below.</div>';
    $('watchAdd').innerHTML = optionsHtml(watch);
  }

  /* ---------- history + sparkline ---------- */
  const pairKey = () => `${settings.sourceMode}:${$('from').value}>${$('to').value}`;
  function record() {
    if (!table || $('from').value === $('to').value) return;
    let rate; try { rate = rateOf($('from').value, $('to').value); } catch { return; }
    const hist = LS.get('ice.hist', {});
    const k = pairKey(); const arr = hist[k] || [];
    const last = arr[arr.length - 1], now = Date.now();
    if (!last || last[1] !== rate || now - last[0] > 10 * 60000) arr.push([now, rate]);
    hist[k] = arr.slice(-240);
    LS.set('ice.hist', hist);
  }
  let range = 'live', histReq = 0, lastSig = '';
  const histCache = {};

  function chart(points, live) {
    const box = $('spark'); box.innerHTML = ''; $('sparkStats').innerHTML = '';
    box.onmousemove = null; box.onmouseleave = null;
    if (points.length < 2) { box.innerHTML = '<div class="empty">Collecting live data… keep the app open and the trend will draw itself.</div>'; return; }
    const vals = points.map((p) => p[1]); const lo = Math.min(...vals), hi = Math.max(...vals);
    const t0 = points[0][0], t1 = points[points.length - 1][0], tspan = t1 - t0 || 1;
    const W = 400, H = 190, pad = 14, span = hi - lo || 1;
    const X = (t) => pad + ((t - t0) / tspan) * (W - 2 * pad);
    const Y = (v) => H - pad - ((v - lo) / span) * (H - 2 * pad);
    const pts = points.map((p) => [X(p[0]), Y(p[1])]);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none');
    const up = vals[vals.length - 1] >= vals[0]; const col = up ? '#34d399' : '#fb7185';
    const area = document.createElementNS(NS, 'path');
    area.setAttribute('d', `M${pts[0][0]},${H} ` + pts.map((p) => `L${p[0]},${p[1]}`).join(' ') + ` L${pts[pts.length - 1][0]},${H} Z`);
    area.setAttribute('fill', col); area.setAttribute('opacity', '.18');
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', pts.map((p) => p.join(',')).join(' ')); line.setAttribute('fill', 'none');
    line.setAttribute('stroke', col); line.setAttribute('stroke-width', '3'); line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(area, line); box.append(svg);

    const dot = document.createElement('div'); dot.className = 'dot hidden';
    const tip = document.createElement('div'); tip.className = 'tip hidden';
    box.append(dot, tip);
    const f = (n) => n.toLocaleString('en-NG', { maximumFractionDigits: n >= 1 ? 4 : 8 });
    box.onmousemove = (e) => {
      const rc = box.getBoundingClientRect();
      const vx = ((e.clientX - rc.left) / rc.width) * W;
      const t = t0 + ((vx - pad) / (W - 2 * pad)) * tspan;
      let best = 0, bd = Infinity;
      for (let i = 0; i < points.length; i++) { const d = Math.abs(points[i][0] - t); if (d < bd) { bd = d; best = i; } }
      dot.style.left = (pts[best][0] / W) * 100 + '%'; dot.style.top = (pts[best][1] / H) * 100 + '%';
      tip.style.left = Math.min(88, Math.max(12, (pts[best][0] / W) * 100)) + '%';
      tip.textContent = `${f(points[best][1])} · ${new Date(points[best][0]).toLocaleString(undefined, live ? {} : { dateStyle: 'medium' })}`;
      dot.classList.remove('hidden'); tip.classList.remove('hidden');
    };
    box.onmouseleave = () => { dot.classList.add('hidden'); tip.classList.add('hidden'); };

    const chg = ((vals[vals.length - 1] - vals[0]) / vals[0]) * 100;
    const fmtT = (t) => new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' });
    $('sparkStats').innerHTML = `<span>Low ${f(lo)}</span><span>High ${f(hi)}</span>` +
      `<span class="${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}% · ${fmtT(t0)} – ${fmtT(t1)}</span>`;
  }

  async function loadHistory(days) {
    const from = $('from').value, to = $('to').value, box = $('spark');
    if (from === to) { box.innerHTML = '<div class="empty">Pick two different currencies.</div>'; return; }
    const key = `${from}>${to}:${days}`, my = ++histReq;
    const c = histCache[key];
    if (c && Date.now() - c.t < 10 * 60000) { chart(c.points, false); return; }
    box.innerHTML = '<div class="empty">Loading history…</div>'; $('sparkStats').innerHTML = '';
    const res = await window.api.fetchHistory({ from, to, days: Number(days) });
    if (my !== histReq) return;
    if (!res.ok) { box.innerHTML = `<div class="empty">${esc(res.error)}</div>`; return; }
    histCache[key] = { t: Date.now(), points: res.points };
    chart(res.points, false);
  }

  function drawSpark(force) {
    const from = $('from').value, to = $('to').value;
    $('trendPair').textContent = `${from} → ${to}`;
    $('histNote').textContent = range === 'live'
      ? 'Live samples, collected while the app is open.'
      : 'Reference history from Frankfurter (central-bank data) and CoinGecko. It can differ from the live market and CBN official rates.';
    if (range === 'live') { chart(LS.get('ice.hist', {})[pairKey()] || [], true); return; }
    const sig = `${range}:${from}>${to}`;
    if (!force && sig === lastSig) return;
    lastSig = sig; loadHistory(range);
  }

  /* ---------- comparison (banks / crypto exchanges) ---------- */
  function renderCompare() {
    const box = $('compare');
    if (!table) { box.innerHTML = ''; return; }
    const amount = parseFloat($('amount').value.replace(/,/g, '')), from = $('from').value, to = $('to').value;
    $('cmpPair').textContent = `${from} → ${to}`;
    if (!(amount >= 0) || from === to) { box.innerHTML = '<div class="none">Enter an amount and two different currencies.</div>'; return; }
    const useEx = CRYPTO.has(from) || CRYPTO.has(to);
    $('cmpTitle').textContent = useEx ? 'Exchange comparison' : 'Bank comparison';
    let rows = [], empty = '';
    if (useEx) {
      if (!table.cryptoQuotes) empty = 'Switch to Live market to compare Binance, Coinbase and CoinGecko prices.';
      else rows = Rates.compareExchanges(amount, from, to, table);
      if (!rows.length && !empty) empty = 'No exchange has prices for this pair right now.';
    } else {
      rows = Rates.compareBanks(amount, from, to, bankStore);
      if (cbnTable) { try { const r = Rates.convert(amount, from, to, cbnTable, 'central'); rows.push({ name: 'CBN official', result: r.result, rate: r.rate, date: cbnTable.date, official: true }); } catch { /* pair not in CBN table */ } }
      if (!rows.length) empty = 'No bank rates saved yet. Use "Edit bank rates" to add GTBank, Zenith, Access, UBA and others.';
    }
    if (empty) { box.innerHTML = `<div class="none">${esc(empty)}</div>`; return; }
    rows.sort((a, b) => b.result - a.result);
    box.innerHTML = rows.map((r, i) => {
      const days = r.date ? Math.floor((Date.now() - new Date(r.date + 'T00:00:00').getTime()) / 86400000) : 0;
      return `<div class="crow${i === 0 && rows.length > 1 ? ' best' : ''}"><span class="cname">${esc(r.name)}</span>` +
        (r.official ? '<span class="tagoff">Official</span>' : '') + (i === 0 && rows.length > 1 ? '<span class="tagbest">Highest</span>' : '') +
        (r.date ? `<span class="cmeta${days > 3 ? ' stale' : ''}">${esc(r.date)}</span>` : '') +
        `<span class="cval">${esc(fmt(r.result, to))}</span></div>`;
    }).join('');
  }

  /* ---------- bank rate editor ---------- */
  const today = () => new Date().toISOString().slice(0, 10);
  function bankLines(b) { const r = bankStore.banks[b]; return r ? Object.entries(r.rates).map(([c, v]) => `${c},${v.buy},${v.sell}`).join('\n') : ''; }
  function renderBankList() {
    const n = Object.keys(bankStore.banks);
    $('bankList').textContent = n.length ? 'Saved: ' + n.map((b) => `${b} (${bankStore.banks[b].date})`).join(' · ') : 'No bank rates saved yet.';
  }
  function fillBankForm() {
    const b = $('bankName').value, r = bankStore.banks[b];
    $('bankText').value = bankLines(b); $('bankDate').value = r ? r.date : today();
    $('bankUrl').value = (bankStore.urls || {})[b] || ''; renderBankList();
  }

  async function fetchBankFromWeb(url) {
    const res = await window.api.fetchBankPage(url);
    if (!res.ok) return { ok: false, error: res.error };
    const parsed = Rates.parseBankText(res.text, cbnTable);
    return parsed ? { ok: true, parsed } : { ok: false, error: 'No exchange rates found on that page. Check the link, or enter the rates manually.' };
  }
  async function updateAllBanks(silent) {
    const entries = Object.entries(bankStore.urls || {}).filter(([, u]) => u);
    if (!entries.length) { if (!silent) toast('No bank links saved yet. Add each bank’s official rates page link in Edit bank rates.'); return; }
    let ok = 0; const failed = [];
    for (const [b, url] of entries) {
      const r = await fetchBankFromWeb(url);
      if (r.ok) { bankStore.banks[b] = { date: today(), rates: r.parsed.rates }; ok++; } else failed.push(b);
    }
    await window.api.saveBanks(bankStore); renderBankList(); renderCompare();
    if (!silent || failed.length) toast(`Bank rates updated from websites: ${ok} of ${entries.length}.` + (failed.length ? ` Could not read: ${failed.join(', ')}.` : ''));
  }

  /* ---------- amount field: thousands separators while typing ---------- */
  function formatAmountInput(el) {
    const raw = el.value, caret = el.selectionStart == null ? raw.length : el.selectionStart;
    const before = raw.slice(0, caret).replace(/[^0-9.]/g, '').length;
    let cleaned = raw.replace(/[^0-9.]/g, '');
    const i = cleaned.indexOf('.');
    if (i >= 0) cleaned = cleaned.slice(0, i + 1) + cleaned.slice(i + 1).replace(/\./g, '');
    let [int, dec] = cleaned.split('.');
    int = int.replace(/^0+(?=\d)/, '');
    const out = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dec !== undefined ? '.' + dec : '');
    el.value = out;
    let count = 0, pos = 0;
    while (pos < out.length && count < before) { if (/[0-9.]/.test(out[pos])) count++; pos++; }
    try { el.setSelectionRange(pos, pos); } catch { /* ignore */ }
  }

  /* ---------- alerts ---------- */
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), 7000);
  }
  function renderAlerts() {
    const from = $('from').value, to = $('to').value;
    $('alertPair').textContent = `1 ${from} → ${to}`;
    if (!$('alertVal').value && table && from !== to) { try { $('alertVal').value = rateOf(from, to).toLocaleString('en-US', { maximumFractionDigits: 6, useGrouping: false }); } catch { /* ignore */ } }
    $('alerts').innerHTML = alerts.length ? alerts.map((a) =>
      `<div class="arow"><span class="atext">1 ${a.from} → ${a.to} ${a.dir === 'above' ? '≥' : '≤'} ${a.value.toLocaleString('en-NG', { maximumFractionDigits: 6 })}</span>
        <span class="state ${a.armed ? 'armed' : 'fired'}">${a.armed ? 'Watching' : 'Triggered'}</span>
        ${a.armed ? '' : `<button class="x" data-rearm="${a.id}" title="Re-arm">&#8635;</button>`}
        <button class="x" data-del="${a.id}" title="Delete">&#10005;</button></div>`).join('')
      : '<div class="none">No alerts yet. Pick a pair, choose a level, and get a desktop notification when it is hit.</div>';
  }
  function checkAlerts() {
    if (!table) return;
    let changed = false;
    for (const a of alerts) {
      if (!a.armed || a.mode !== table.type) continue;
      let r; try { r = Rates.convert(1, a.from, a.to, table, 'central').rate; } catch { continue; }
      if ((a.dir === 'above' && r >= a.value) || (a.dir === 'below' && r <= a.value)) {
        a.armed = false; changed = true;
        const msg = `1 ${a.from} is now ${r.toLocaleString('en-NG', { maximumFractionDigits: 6 })} ${a.to} (${a.dir === 'above' ? 'above' : 'below'} ${a.value})`;
        toast('🔔 ' + msg);
        try { new Notification('ICE rate alert', { body: msg }); } catch { /* notifications unavailable */ }
      }
    }
    if (changed) { LS.set('ice.alerts', alerts); renderAlerts(); }
  }

  /* ---------- core ---------- */
  function showStatus() {
    const badge = $('liveBadge');
    $('warnText').textContent = '';
    $('attribution').textContent = isMarket()
      ? `Currency rates by ExchangeRate-API (exchangerate-api.com) · Crypto prices: ${SRC_LABEL[table && table.cryptoSource] || 'CoinGecko'}` : '';
    $('segMarket').classList.toggle('on', isMarket()); $('segCbn').classList.toggle('on', !isMarket());
    $('modeRow').classList.toggle('hidden', isMarket());
    badge.className = 'badge-live';
    if (!table) { $('liveText').textContent = 'NO DATA'; $('statusText').textContent = 'No rates yet. Press Refresh' + (isMarket() ? '.' : ' or enter rates manually in Settings.'); return; }
    if (table.type === 'market') {
      const mins = Math.floor((Date.now() - new Date(table.fetchedAt).getTime()) / 60000);
      const warn = (table.warnings || []).length > 0 || mins > 15;
      badge.classList.add(warn ? 'stale' : 'live'); $('liveText').textContent = warn ? 'DELAYED' : 'LIVE';
      const fiatLine = table.fiatUpdated ? ` · currencies as of ${new Date(table.fiatUpdated).toLocaleString()}` : '';
      $('statusText').textContent = `Live market · checked ${new Date(table.fetchedAt).toLocaleTimeString()}${fiatLine}`;
      $('warnText').textContent = (table.warnings || []).join(' ') + (mins > 15 ? ` Data is ${mins} min old.` : '');
    } else {
      const days = Math.floor((Date.now() - new Date(table.date + 'T00:00:00').getTime()) / 86400000);
      badge.classList.add(days > 4 ? 'stale' : 'official'); $('liveText').textContent = days > 4 ? 'OLD RATES' : 'OFFICIAL';
      $('statusText').textContent = `${table.source} · rate date ${table.date}` + (days > 4 ? ` · ${days} days old` : '');
    }
  }

  function recalc() {
    if (!table) { $('result').textContent = '—'; $('rateLine').textContent = ''; return; }
    const amount = parseFloat($('amount').value.replace(/,/g, '').trim());
    const from = $('from').value, to = $('to').value;
    if (!Number.isFinite(amount) || amount < 0) { $('result').textContent = '—'; $('rateLine').textContent = 'Enter a valid amount'; return; }
    try {
      const { result, rate } = Rates.convert(amount, from, to, table, curMode());
      const text = `${fmt(result, to)} ${to}`;
      if (text !== lastResultText) { const h = $('hero'); h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash'); }
      lastResultText = text;
      $('result').textContent = text;
      $('rateLine').textContent = `1 ${from} = ${rate.toLocaleString('en-NG', { maximumFractionDigits: 8 })} ${to}`;
    } catch (e) { $('result').textContent = '—'; $('rateLine').textContent = e.message; }
    renderWatch(); renderChips(); renderAlerts(); renderCompare(); drawSpark();
  }

  function setTable(t, fresh) {
    table = t; if (t.type === 'cbn') cbnTable = t; updateDirs(); fillSelects(); showStatus(); renderTicker();
    if (fresh) record();
    recalc(); if (fresh) checkAlerts();
  }

  async function refresh(silent) {
    if (!silent) $('statusText').textContent = isMarket() ? 'Fetching live market rates…' : 'Fetching latest CBN rates…';
    const mode = settings.sourceMode;
    const res = await window.api.fetchRates(mode);
    if (mode !== settings.sourceMode) return;
    if (res.ok) setTable(res.table, true);
    else { showStatus(); $('warnText').textContent = res.error + (table ? ' Showing last saved rates.' : ''); $('liveBadge').className = 'badge-live stale'; $('liveText').textContent = 'OFFLINE'; }
  }
  function schedule() { clearInterval(timer); if (isMarket()) timer = setInterval(() => refresh(true), 60000); }

  async function switchSource(mode) {
    if (mode === settings.sourceMode) return;
    settings.sourceMode = mode; prevNgn = {}; dirs = {}; table = null;
    await window.api.saveSettings({ sourceMode: mode });
    const cached = await window.api.loadCache(mode);
    if (cached) setTable(cached, false); else { showStatus(); recalc(); }
    schedule(); refresh(false);
  }

  /* ---------- wiring ---------- */
  $('amount').addEventListener('input', () => { formatAmountInput($('amount')); $('alertVal').value = ''; recalc(); });
  ['from', 'to', 'mode'].forEach((id) => $(id).addEventListener('input', () => { $('alertVal').value = ''; recalc(); }));
  formatAmountInput($('amount'));

  $('bankEdit').addEventListener('click', () => {
    $('bankName').innerHTML = BANKS.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
    fillBankForm(); $('bankOverlay').classList.remove('hidden');
  });
  $('bankName').addEventListener('change', fillBankForm);
  const closeBank = () => $('bankOverlay').classList.add('hidden');
  $('closeBank').addEventListener('click', closeBank);
  $('bankOverlay').addEventListener('click', (e) => { if (e.target === $('bankOverlay')) closeBank(); });
  $('bankSave').addEventListener('click', async () => {
    const b = $('bankName').value, t = Rates.parseManual($('bankText').value, $('bankDate').value);
    if (!t) { toast('Could not read any rates. Use lines like USD,1440,1465'); return; }
    bankStore.banks[b] = { date: $('bankDate').value || today(), rates: t.rates };
    bankStore.urls = bankStore.urls || {};
    const link = $('bankUrl').value.trim();
    if (link) bankStore.urls[b] = link; else delete bankStore.urls[b];
    await window.api.saveBanks(bankStore); renderBankList(); renderCompare(); toast(`Saved ${b} rates`);
  });
  $('bankDelete').addEventListener('click', async () => {
    delete bankStore.banks[$('bankName').value];
    await window.api.saveBanks(bankStore); fillBankForm(); renderCompare();
  });
  $('bankFetch').addEventListener('click', async () => {
    const b = $('bankName').value, url = $('bankUrl').value.trim();
    if (!url) { toast('Paste the bank’s official rates page link first.'); return; }
    $('bankFetch').disabled = true; toast('Reading the bank’s page… this can take about 10 seconds.');
    const r = await fetchBankFromWeb(url);
    $('bankFetch').disabled = false;
    if (!r.ok) { toast(r.error); return; }
    $('bankText').value = Object.entries(r.parsed.rates).map(([c, v]) => `${c},${v.buy},${v.sell}`).join('\n');
    $('bankDate').value = today();
    toast(`Found ${Object.keys(r.parsed.rates).length} currencies` + (r.parsed.single.length ? ` (single rate only for ${r.parsed.single.join(', ')})` : '') + '. Check them, then press Save bank rates.');
  });
  $('bankFetchAll').addEventListener('click', async () => {
    const b = $('bankUrl').value.trim();
    if (b) { bankStore.urls = bankStore.urls || {}; bankStore.urls[$('bankName').value] = b; }
    $('bankFetchAll').disabled = true; toast('Updating banks from their websites…');
    await updateAllBanks(false); fillBankForm(); $('bankFetchAll').disabled = false;
  });
  $('cryptoSrc').addEventListener('change', async () => {
    settings.cryptoSource = $('cryptoSrc').value;
    await window.api.saveSettings({ cryptoSource: settings.cryptoSource }); refresh(false);
  });
  $('segMarket').addEventListener('click', () => switchSource('market'));
  $('segCbn').addEventListener('click', () => switchSource('cbn'));
  const swap = () => { const f = $('from').value; $('from').value = $('to').value; $('to').value = f; $('alertVal').value = ''; recalc(); };
  $('swap').addEventListener('click', swap);
  $('refresh').addEventListener('click', () => refresh(false));
  $('chips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; $('from').value = b.dataset.a; $('to').value = b.dataset.b; $('alertVal').value = ''; recalc(); });
  $('watch').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { watch = watch.filter((c) => c !== rm.dataset.remove); LS.set('ice.watch', watch); renderWatch(); return; }
    const row = e.target.closest('.wrow'); if (row) { $('to').value = row.dataset.code; $('alertVal').value = ''; recalc(); }
  });
  $('watchAddBtn').addEventListener('click', () => { const c = $('watchAdd').value; if (c && !watch.includes(c)) { watch.push(c); LS.set('ice.watch', watch); renderWatch(); } });
  $('alertAdd').addEventListener('click', () => {
    const v = parseFloat($('alertVal').value.replace(/,/g, ''));
    const from = $('from').value, to = $('to').value;
    if (!table || from === to || !(v > 0)) { toast('Choose two different currencies and a valid level.'); return; }
    alerts.push({ id: String(Date.now()), from, to, dir: $('alertDir').value, value: v, mode: table.type, armed: true });
    LS.set('ice.alerts', alerts); renderAlerts(); checkAlerts();
    try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch { /* ignore */ }
  });
  $('alerts').addEventListener('click', (e) => {
    const d = e.target.closest('[data-del]'), r = e.target.closest('[data-rearm]');
    if (d) alerts = alerts.filter((a) => a.id !== d.dataset.del);
    if (r) { const a = alerts.find((x) => x.id === r.dataset.rearm); if (a) a.armed = true; }
    if (d || r) { LS.set('ice.alerts', alerts); renderAlerts(); }
  });
  const copy = async () => { if (lastResultText) { await window.api.copyText(lastResultText.replace(/,/g, '').replace(/ [A-Z0-9]+$/, '')); toast('Copied ' + lastResultText.replace(/ [A-Z0-9]+$/, '')); } };
  $('copyBtn').addEventListener('click', copy);

  let pinned = false;
  $('pinBtn').addEventListener('click', async () => { pinned = !pinned; await window.api.pinWindow(pinned); $('pinBtn').classList.toggle('on', pinned); toast(pinned ? 'Pinned on top' : 'Unpinned'); });
  const setTheme = (t) => { document.documentElement.setAttribute('data-theme', t); LS.set('ice.theme', t); };
  setTheme(LS.get('ice.theme', 'dark'));
  $('themeBtn').addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

  const openSettings = () => $('overlay').classList.remove('hidden');
  const closeSettings = () => $('overlay').classList.add('hidden');
  $('settingsBtn').addEventListener('click', openSettings);
  $('closeSettings').addEventListener('click', closeSettings);
  $('overlay').addEventListener('click', (e) => { if (e.target === $('overlay')) closeSettings(); });
  $('saveSettings').addEventListener('click', async () => {
    const s = {}; for (const k of ['apiUrl', 'apiKey', 'erKey', 'cgKey']) s[k] = $(k).value.trim();
    Object.assign(settings, s); await window.api.saveSettings(s); closeSettings(); refresh(false);
  });
  $('applyManual').addEventListener('click', async () => {
    const t = Rates.parseManual($('manualText').value, $('manualDate').value);
    if (!t) { toast('Could not read any rates. Use lines like USD,1450.20'); return; }
    t.type = 'cbn'; await window.api.saveCache('cbn', t);
    settings.sourceMode = 'cbn'; await window.api.saveSettings({ sourceMode: 'cbn' }); schedule();
    closeSettings(); setTable(t, true);
  });
  $('ranges').addEventListener('click', (e) => {
    const b = e.target.closest('.rng'); if (!b) return;
    range = b.dataset.r;
    document.querySelectorAll('.rng').forEach((x) => x.classList.toggle('on', x === b));
    drawSpark(true);
  });

  /* auto-update */
  let manualCheck = false;
  const setUpdate = (text, showBtn) => {
    $('updateRow').classList.toggle('hidden', !text);
    $('updateText').textContent = text || '';
    $('updateBtn').classList.toggle('hidden', !showBtn);
  };
  window.api.onUpdate((p) => {
    if (p.state === 'checking') { if (manualCheck) setUpdate('Checking for updates…'); }
    else if (p.state === 'available') setUpdate(`Update ${p.version} found — downloading…`);
    else if (p.state === 'downloading') setUpdate(`Downloading update… ${p.percent}%`);
    else if (p.state === 'ready') { setUpdate(`Update ${p.version} is ready.`, true); toast(`Update ${p.version} downloaded. Restart to install.`); }
    else if (p.state === 'none') { if (manualCheck) { setUpdate('You are on the latest version.'); setTimeout(() => setUpdate(''), 4000); } }
    else if (p.state === 'error') { if (manualCheck) setUpdate('Update check failed: ' + p.message); }
  });
  $('checkUpdate').addEventListener('click', async () => {
    manualCheck = true;
    const r2 = await window.api.checkUpdate();
    if (r2.state === 'dev') setUpdate('Updates work in the installed app (not when running from source).');
    else if (r2.state === 'unconfigured') setUpdate('Auto-update is not set up yet. It needs a GitHub repo (see README).');
    else if (r2.state === 'error') setUpdate('Update check failed: ' + r2.message);
    else setUpdate('Checking for updates…');
  });
  $('updateBtn').addEventListener('click', () => window.api.installUpdate());
  window.api.getVersion().then((v) => { $('verText').textContent = 'ICE Rates Terminal v' + v; });

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); swap(); }
    else if (e.key === 'F5') { e.preventDefault(); refresh(false); }
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); copy(); }
    else if (e.ctrlKey && e.key === ',') { e.preventDefault(); openSettings(); }
    else if (e.key === 'Escape') { closeSettings(); $('bankOverlay').classList.add('hidden'); }
  });

  async function init() {
    settings = await window.api.loadSettings();
    for (const k of ['apiUrl', 'apiKey', 'erKey', 'cgKey']) $(k).value = settings[k] || '';
    $('cryptoSrc').value = settings.cryptoSource || 'auto';
    bankStore = (await window.api.loadBanks()) || { banks: {} };
    bankStore.urls = bankStore.urls || {};
    cbnTable = await window.api.loadCache('cbn');
    $('manualDate').value = new Date().toISOString().slice(0, 10);
    const cached = await window.api.loadCache(settings.sourceMode);
    if (cached) setTable(cached, false); else { showStatus(); recalc(); }
    schedule(); refresh(false);
    setTimeout(() => updateAllBanks(true), 8000);
  }
  init();
})();
