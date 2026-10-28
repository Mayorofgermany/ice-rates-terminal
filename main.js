const { app, BrowserWindow, ipcMain, clipboard, net } = require('electron');
const path = require('path');
const fs = require('fs');
const Rates = require('./src/rates.js');

const DEFAULTS = {
  sourceMode: 'cbn',
  apiUrl: 'https://allratestoday.com/api/v1/central-bank/cbn/latest', apiKey: '',
  erKey: '', cgKey: '', cryptoSource: 'auto'
};
// Chromium network stack: honours Windows proxy settings and certificates, unlike Node's built-in fetch.
const nfetch = (url, opts) => net.fetch(url, opts);
const dataDir = () => app.getPath('userData');
const cacheFile = (mode) => path.join(dataDir(), mode === 'market' ? 'market-cache.json' : 'rates-cache.json');
const settingsFile = () => path.join(dataDir(), 'settings.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
const loadSettings = () => ({ ...DEFAULTS, ...readJson(settingsFile(), {}) });

let mainWin = null;

// ---------- Auto-update (installed NSIS build, via GitHub Releases) ----------
let publishOwner = '';
try { publishOwner = require('./package.json').build.publish[0].owner || ''; } catch { /* ignore */ }
const updatesConfigured = !!publishOwner && publishOwner !== 'YOUR_GITHUB_USERNAME';
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch { /* not installed in dev */ }
function sendUpdate(payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('update:status', payload);
}
function setupUpdater() {
  if (!autoUpdater || !app.isPackaged || !updatesConfigured) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => sendUpdate({ state: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => sendUpdate({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => sendUpdate({ state: 'error', message: String((e && e.message) || e).slice(0, 200) }));
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('update:check', async () => {
  if (!autoUpdater || !app.isPackaged) return { state: 'dev' };
  if (!updatesConfigured) return { state: 'unconfigured' };
  try { await autoUpdater.checkForUpdates(); return { state: 'checking' }; }
  catch (e) { return { state: 'error', message: String(e.message || e).slice(0, 200) }; }
});
ipcMain.handle('update:install', () => { if (autoUpdater) autoUpdater.quitAndInstall(); return true; });

function createWindow() {
  const win = new BrowserWindow({
    width: 1120, height: 800, minWidth: 980, minHeight: 700,
    title: 'ICE Rates Terminal',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  mainWin = win;
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

ipcMain.handle('cache:load', (_e, mode) => readJson(cacheFile(mode), null));
ipcMain.handle('cache:save', (_e, mode, data) => { writeJson(cacheFile(mode), data); return true; });
ipcMain.handle('settings:load', () => loadSettings());
ipcMain.handle('settings:save', (_e, s) => { writeJson(settingsFile(), { ...loadSettings(), ...s }); return true; });

// ---------- CBN official ----------
async function fetchCbn() {
  const s = loadSettings();
  try {
    const headers = { Accept: 'application/json' };
    if (s.apiKey) headers.Authorization = `Bearer ${s.apiKey}`;
    const res = await nfetch(s.apiUrl, { headers, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { ok: false, error: `CBN provider returned HTTP ${res.status}` };
    const table = Rates.normalizeApiResponse(await res.json());
    if (!table) return { ok: false, error: 'Could not read the CBN provider response. Use manual paste, or adjust normalizeApiResponse in src/rates.js.' };
    table.type = 'cbn';
    writeJson(cacheFile('cbn'), table);
    return { ok: true, table };
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
}

// ---------- Live market (fiat + crypto) ----------
let fiatMem = null; // { map, updated, nextUpdate } — fiat only refetched when the provider says it has new data

async function getFiat(s) {
  if (fiatMem && fiatMem.nextUpdate && Date.now() < fiatMem.nextUpdate) return fiatMem;
  const url = s.erKey
    ? `https://v6.exchangerate-api.com/v6/${encodeURIComponent(s.erKey)}/latest/USD`
    : 'https://open.er-api.com/v6/latest/USD';
  const res = await nfetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const parsed = Rates.fromErApi(await res.json());
  if (!parsed) throw new Error('unexpected response');
  if (!parsed.nextUpdate) parsed.nextUpdate = Date.now() + 60 * 60 * 1000;
  fiatMem = parsed;
  return parsed;
}

async function getCoinGecko(s) {
  const ids = Rates.COINS.map((c) => c.id).join(',');
  const headers = { Accept: 'application/json' };
  if (s.cgKey) headers['x-cg-demo-api-key'] = s.cgKey;
  const res = await nfetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=ngn`, { headers, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const map = Rates.fromCoinGecko(await res.json());
  if (!map) throw new Error('unexpected response');
  return map;
}

// Fallback when CoinGecko is unreachable: Binance public USDT prices x NGN-per-USD from the currency feed.
async function getBinance(ngnPerUsd) {
  let lastErr;
  for (const host of ['https://api.binance.com', 'https://data-api.binance.vision']) {
    try {
      const res = await nfetch(`${host}/api/v3/ticker/price`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const map = Rates.fromBinance(await res.json(), ngnPerUsd);
      if (!map) throw new Error('unexpected response');
      return map;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

async function getCoinbase(ngnFallback) {
  const res = await nfetch('https://api.coinbase.com/v2/exchange-rates?currency=USD', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const map = Rates.fromCoinbase(await res.json(), ngnFallback);
  if (!map) throw new Error('unexpected response');
  return map;
}

async function fetchMarket() {
  const s = loadSettings();
  const prev = readJson(cacheFile('market'), null);
  const warnings = [];
  let fiat = prev && prev.fiat, fiatUpdated = prev && prev.fiatUpdated, fiatNext = prev && prev.fiatNext;
  let crypto = prev && prev.crypto;
  let cryptoSource = (prev && prev.cryptoSource) || 'coingecko';

  const fiatP = getFiat(s);
  const usdP = fiatP.then((f) => f.map.USD).catch(() => prev && prev.fiat && prev.fiat.USD);
  const [fiatRes, cgRes, bnRes, cbRes] = await Promise.allSettled([
    fiatP, getCoinGecko(s), usdP.then((u) => getBinance(u)), usdP.then((u) => getCoinbase(u))
  ]);

  if (fiatRes.status === 'fulfilled') { fiat = fiatRes.value.map; fiatUpdated = fiatRes.value.updated; fiatNext = fiatRes.value.nextUpdate; }
  else warnings.push(`Currency rates not refreshed (${fiatRes.reason.message}).${fiat ? ' Showing last saved.' : ''}`);

  const quotes = {};
  if (cgRes.status === 'fulfilled') quotes.coingecko = cgRes.value;
  if (bnRes.status === 'fulfilled') quotes.binance = bnRes.value;
  if (cbRes.status === 'fulfilled') quotes.coinbase = cbRes.value;
  const pref = ['coingecko', 'binance', 'coinbase'].includes(s.cryptoSource) ? s.cryptoSource : 'coingecko';
  const order = [pref, ...['coingecko', 'binance', 'coinbase'].filter((k) => k !== pref)];
  const chosen = order.find((k) => quotes[k]);
  if (chosen) {
    const merged = {};
    for (const k of [...order].reverse()) Object.assign(merged, quotes[k] || {}); // preferred source wins, others fill gaps
    crypto = merged; cryptoSource = chosen;
  } else {
    const why = [['CoinGecko', cgRes], ['Binance', bnRes], ['Coinbase', cbRes]].map(([n, r]) => `${n}: ${r.reason && r.reason.message}`).join('; ');
    warnings.push(`Crypto prices not refreshed (${why}).${crypto ? ' Showing last saved.' : ''}`);
  }

  if (!fiat && !crypto) return { ok: false, error: warnings.join(' ') || 'No market data available.' };
  const table = Rates.buildMarketTable({ fiat, crypto, fiatUpdated, fiatNext, warnings, cryptoSource, cryptoQuotes: Object.keys(quotes).length ? quotes : null });
  if (fiatRes.status !== 'fulfilled' && !chosen && prev) table.fetchedAt = prev.fetchedAt;
  writeJson(cacheFile('market'), table);
  return { ok: true, table };
}

// ---------- Nigerian bank rates (entered by the user) ----------
const banksFile = () => path.join(dataDir(), 'bank-rates.json');
ipcMain.handle('banks:load', () => readJson(banksFile(), { banks: {} }));
// Loads a bank's public rates page in a hidden, sandboxed browser window (so JavaScript-built tables render) and returns its visible text.
ipcMain.handle('bank:fetchPage', async (_e, url) => {
  let u;
  try { u = new URL(String(url)); } catch { return { ok: false, error: 'That is not a valid link.' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'Only secure (https) links are supported.' };
  if (/\.pdf($|\?)/i.test(u.pathname)) return { ok: false, error: 'PDF rate sheets cannot be read automatically. Enter those rates manually.' };
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await Promise.race([win.loadURL(u.href), new Promise((_r, rej) => setTimeout(() => rej(new Error('the page took too long to load')), 30000))]);
    await new Promise((r) => setTimeout(r, 4000)); // let the page's scripts draw the rate table
    const text = await win.webContents.executeJavaScript('document.body ? document.body.innerText : ""');
    return { ok: true, text: String(text).slice(0, 200000) };
  } catch (e) {
    return { ok: false, error: `Could not load the page: ${e.message}` };
  } finally { if (!win.isDestroyed()) win.destroy(); }
});
ipcMain.handle('banks:save', (_e, data) => { writeJson(banksFile(), data); return true; });

ipcMain.handle('window:pin', (_e, on) => { if (mainWin) mainWin.setAlwaysOnTop(!!on); return !!on; });
ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text)); return true; });


// ---------- Long-range history ----------
const histMem = new Map();
const isCrypto = (c) => Rates.CRYPTO_CODES.has(c);
async function getJson(url, headers) {
  const res = await nfetch(url, { headers: { Accept: 'application/json', ...(headers || {}) }, signal: AbortSignal.timeout(20000) });
  if (res.status === 429) throw new Error('rate limit reached, try again in a minute');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function ffSeries(base, quote, start, group) {
  const url = `https://api.frankfurter.dev/v2/rates?base=${encodeURIComponent(base)}&quotes=${encodeURIComponent(quote)}&from=${start}${group ? `&group=${group}` : ''}`;
  const s = Rates.parseFrankfurter(await getJson(url), quote);
  if (!s || !s.length) throw new Error(`no history for ${base}/${quote}`);
  return s;
}
async function usdLeg(code, days, start, group, s) {
  if (code === 'USD') return null; // constant 1
  if (isCrypto(code)) {
    const coin = Rates.COINS.find((c) => c.code === code);
    const headers = s.cgKey ? { 'x-cg-demo-api-key': s.cgKey } : {};
    const json = await getJson(`https://api.coingecko.com/api/v3/coins/${coin.id}/market_chart?vs_currency=usd&days=${days}`, headers);
    const daily = Rates.toDaily(Rates.parseCoinGeckoChart(json));
    if (!daily.length) throw new Error(`no history for ${code}`);
    return daily;
  }
  const perUsd = await ffSeries('USD', code, start, group); // units of `code` per 1 USD
  return perUsd.map(([d, v]) => [d, 1 / v]);
}
async function fetchHistory({ from, to, days }) {
  try {
    days = Math.max(1, Math.min(Number(days) || 30, 1830));
    if ((isCrypto(from) || isCrypto(to)) && days > 365) return { ok: false, error: 'Crypto history is limited to 1 year on the free data plan.' };
    const key = `${from}>${to}:${days}`;
    const hit = histMem.get(key);
    if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.res;
    const s = loadSettings();
    const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const group = days > 400 ? 'week' : '';
    let points;
    if (!isCrypto(from) && !isCrypto(to)) {
      points = (await ffSeries(from, to, start, group)).map(([d, v]) => [Date.parse(d + 'T00:00:00Z'), v]);
    } else {
      const a = await usdLeg(from, days, start, group, s);
      const b = await usdLeg(to, days, start, group, s);
      points = Rates.ratioSeries(a, b);
    }
    if (points.length < 2) return { ok: false, error: 'Not enough history for this pair yet.' };
    const res = { ok: true, points };
    histMem.set(key, { t: Date.now(), res });
    return res;
  } catch (err) {
    return { ok: false, error: `History unavailable: ${err.message}` };
  }
}
ipcMain.handle('history:fetch', (_e, args) => fetchHistory(args || {}));

ipcMain.handle('rates:fetch', (_e, mode) => (mode === 'market' ? fetchMarket() : fetchCbn()));

// Only one copy of the app at a time; a second launch focuses the first.
if (!app.requestSingleInstanceLock()) { app.quit(); }
else app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });

app.whenReady().then(() => {
  createWindow();
  setupUpdater();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
