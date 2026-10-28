// Rate handling + conversion. Works in Node (main/tests) and the browser (renderer).
// Internal table shape:
//   { date: 'YYYY-MM-DD', source: string, rates: { USD: { buy, central, sell }, ... } }
// Every value is NGN per 1 unit of the currency (NGN itself is implicit, = 1).
(function (root) {
  const num = (v) => {
    const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : v;
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  function entryToRate(e) {
    const buy = num(e.buying_rate ?? e.buying ?? e.buy);
    const sell = num(e.selling_rate ?? e.selling ?? e.sell);
    let central = num(e.central_rate ?? e.central ?? e.mid ?? e.rate);
    if (!central && buy && sell) central = (buy + sell) / 2;
    if (!central) return null;
    return { buy: buy ?? central, central, sell: sell ?? central };
  }

  // Tolerant reader: provider schemas differ, so accept the common shapes.
  function normalizeApiResponse(json) {
    if (!json || typeof json !== 'object') return null;
    const list = Array.isArray(json) ? json : (json.rates || json.data || json.results);
    const date = json.rate_date || json.date || (list && list[0] && (list[0].rate_date || list[0].date)) || null;
    const rates = {};
    if (Array.isArray(list)) {
      for (const e of list) {
        const code = String(e.currency || e.code || e.source || e.base || '').toUpperCase();
        if (!/^[A-Z]{3}$/.test(code) || code === 'NGN') continue;
        const r = entryToRate(e);
        if (r) rates[code] = r;
      }
    } else if (list && typeof list === 'object') {
      for (const [k, v] of Object.entries(list)) {
        const code = k.toUpperCase();
        if (!/^[A-Z]{3}$/.test(code) || code === 'NGN') continue;
        const r = typeof v === 'object' ? entryToRate(v) : entryToRate({ rate: v });
        if (r) rates[code] = r;
      }
    }
    if (!Object.keys(rates).length) return null;
    return { date: date || new Date().toISOString().slice(0, 10), source: 'CBN official rate (via provider)', rates };
  }

  // Manual paste: one per line. "USD,1450.20" or "USD,buy,central,sell". Separators: comma, tab, space.
  function parseManual(text, date) {
    const rates = {};
    for (const line of String(text).split(/\r?\n/)) {
      const parts = line.trim().split(/[,\t ]+/).filter(Boolean);
      if (parts.length < 2) continue;
      const code = parts[0].toUpperCase();
      if (!/^[A-Z]{3}$/.test(code) || code === 'NGN') continue;
      const nums = parts.slice(1).map(num);
      if (nums.some((n) => n === null)) continue;
      if (nums.length === 1) rates[code] = { buy: nums[0], central: nums[0], sell: nums[0] };
      else if (nums.length === 2) rates[code] = { buy: nums[0], central: (nums[0] + nums[1]) / 2, sell: nums[1] };
      else if (nums.length === 3) rates[code] = { buy: nums[0], central: nums[1], sell: nums[2] };
    }
    if (!Object.keys(rates).length) return null;
    return { date: date || new Date().toISOString().slice(0, 10), source: 'Manual entry (CBN official rate)', rates };
  }

  // Which NGN value to use for a given currency and mode.
  // Converting FROM a currency into NGN: bank buys it from you  -> 'buy'.
  // Converting NGN INTO a currency: bank sells it to you        -> 'sell'.
  // 'central' uses the central rate both ways.
  function ngnPerUnit(code, table, mode, side) {
    if (code === 'NGN') return 1;
    const r = table.rates[code];
    if (!r) throw new Error(`No rate for ${code}`);
    if (mode === 'central') return r.central;
    return side === 'from' ? r.buy : r.sell;
  }

  function convert(amount, from, to, table, mode) {
    if (!(amount >= 0)) throw new Error('Invalid amount');
    if (from === to) return { result: amount, rate: 1 };
    const fromNgn = ngnPerUnit(from, table, mode, 'from');
    const toNgn = ngnPerUnit(to, table, mode, 'to');
    const rate = fromNgn / toNgn;
    return { result: amount * rate, rate };
  }

  // ---------- Live market sources ----------
  const COINS = [
    { id: 'bitcoin', code: 'BTC', name: 'Bitcoin' },
    { id: 'ethereum', code: 'ETH', name: 'Ethereum' },
    { id: 'tether', code: 'USDT', name: 'Tether' },
    { id: 'binancecoin', code: 'BNB', name: 'BNB' },
    { id: 'solana', code: 'SOL', name: 'Solana' },
    { id: 'ripple', code: 'XRP', name: 'XRP' },
    { id: 'usd-coin', code: 'USDC', name: 'USD Coin' },
    { id: 'cardano', code: 'ADA', name: 'Cardano' },
    { id: 'dogecoin', code: 'DOGE', name: 'Dogecoin' },
    { id: 'tron', code: 'TRX', name: 'TRON' },
    { id: 'litecoin', code: 'LTC', name: 'Litecoin' },
    { id: 'chainlink', code: 'LINK', name: 'Chainlink' },
    { id: 'stellar', code: 'XLM', name: 'Stellar' },
    { id: 'avalanche-2', code: 'AVAX', name: 'Avalanche' },
    { id: 'shiba-inu', code: 'SHIB', name: 'Shiba Inu' },
    { id: 'bitcoin-cash', code: 'BCH', name: 'Bitcoin Cash' },
    { id: 'polkadot', code: 'DOT', name: 'Polkadot' },
    { id: 'dai', code: 'DAI', name: 'Dai' }
  ];
  const CRYPTO_CODES = new Set(COINS.map((c) => c.code));

  // ExchangeRate-API (open or keyed v6), base USD -> { map: { CODE: NGN per 1 unit }, ... }
  function fromErApi(json) {
    if (!json || json.result !== 'success') return null;
    if (json.base_code && json.base_code !== 'USD') return null;
    const r = json.rates || json.conversion_rates;
    if (!r || !(r.NGN > 0)) return null;
    const map = {};
    for (const [code, v] of Object.entries(r)) {
      if (code === 'NGN' || !/^[A-Z]{3}$/.test(code) || !(v > 0)) continue;
      map[code] = r.NGN / v;
    }
    return {
      map,
      updated: json.time_last_update_utc || null,
      nextUpdate: json.time_next_update_unix ? json.time_next_update_unix * 1000 : null
    };
  }

  // CoinGecko /simple/price?ids=...&vs_currencies=ngn -> { CODE: NGN per 1 coin }
  function fromCoinGecko(json) {
    if (!json || typeof json !== 'object') return null;
    const map = {};
    for (const c of COINS) {
      const v = json[c.id] && json[c.id].ngn;
      if (v > 0) map[c.code] = v;
    }
    return Object.keys(map).length ? map : null;
  }

  // Coinbase /v2/exchange-rates?currency=USD -> data.rates[CODE] = units of CODE per 1 USD. NGN per coin = (NGN per USD) / rate.
  function fromCoinbase(json, fallbackNgnPerUsd) {
    const rates = json && json.data && json.data.rates;
    if (!rates || typeof rates !== 'object') return null;
    const ngn = parseFloat(rates.NGN) > 0 ? parseFloat(rates.NGN) : fallbackNgnPerUsd;
    if (!(ngn > 0)) return null;
    const map = {};
    for (const c of COINS) {
      const r = parseFloat(rates[c.code]);
      if (r > 0) map[c.code] = ngn / r;
    }
    return Object.keys(map).length ? map : null;
  }

  // Binance /api/v3/ticker/price -> [{symbol:'BTCUSDT', price:'...'}]; priced in NGN via ngnPerUsd (USDT treated as 1 USD).
  function fromBinance(json, ngnPerUsd) {
    if (!Array.isArray(json) || !(ngnPerUsd > 0)) return null;
    const px = {};
    for (const t of json) {
      if (t && typeof t.symbol === 'string' && t.symbol.endsWith('USDT')) px[t.symbol.slice(0, -4)] = parseFloat(t.price);
    }
    const map = {};
    for (const c of COINS) {
      if (c.code === 'USDT') { map.USDT = ngnPerUsd; continue; }
      if (px[c.code] > 0) map[c.code] = px[c.code] * ngnPerUsd;
    }
    return Object.keys(map).length > 1 ? map : null;
  }

  function buildMarketTable({ fiat, crypto, fiatUpdated, fiatNext, warnings, now, cryptoSource, cryptoQuotes }) {
    const rates = {};
    for (const src of [fiat || {}, crypto || {}]) {
      for (const [code, v] of Object.entries(src)) rates[code] = { buy: v, central: v, sell: v };
    }
    const t = now ? new Date(now) : new Date();
    return {
      type: 'market',
      date: t.toISOString().slice(0, 10),
      fetchedAt: t.toISOString(),
      source: 'Live market rates',
      fiat: fiat || {}, crypto: crypto || {},
      fiatUpdated: fiatUpdated || null, fiatNext: fiatNext || null,
      warnings: warnings || [],
      cryptoSource: cryptoSource || 'coingecko',
      cryptoQuotes: cryptoQuotes || null,
      rates
    };
  }

  // ---------- History helpers ----------
  const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);

  // [[tsMs, value], ...] ascending -> [[ 'YYYY-MM-DD', lastValueOfDay ], ...]
  function toDaily(points) {
    const m = new Map();
    for (const [ts, v] of points || []) if (v > 0) m.set(dayOf(ts), v);
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
  // Frankfurter v2 /rates -> [[ 'YYYY-MM-DD', rate ], ...]
  function parseFrankfurter(json, quote) {
    if (!Array.isArray(json)) return null;
    return json.filter((r) => r && r.quote === quote && r.rate > 0).map((r) => [r.date, r.rate]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
  // CoinGecko /coins/{id}/market_chart -> [[tsMs, price], ...]
  function parseCoinGeckoChart(json) {
    return json && Array.isArray(json.prices) ? json.prices.filter((p) => p && p[1] > 0) : [];
  }
  // Series of (a / b) per day. Each input is [[day, value]] ascending, or null meaning a constant 1.
  // Missing days are carried forward (weekends etc). Output: [[tsMs, ratio]].
  function ratioSeries(a, b) {
    const days = new Set();
    for (const s of [a, b]) if (s) for (const [d] of s) days.add(d);
    const fill = (s) => {
      if (!s) return () => 1;
      let i = 0, last = null;
      return (d) => { while (i < s.length && s[i][0] <= d) { last = s[i][1]; i++; } return last; };
    };
    const fa = fill(a), fb = fill(b), out = [];
    for (const d of [...days].sort()) {
      const x = fa(d), y = fb(d);
      if (x && y) out.push([Date.parse(d + 'T00:00:00Z'), x / y]);
    }
    return out;
  }


  // ---------- Bank website text -> rates ----------
  const BANK_CODE_RE = /\b(USD|GBP|EUR|CAD|ZAR|JPY|CNY|CHF|AED|INR|TRY|AUD|SGD|XOF)\b/;
  const BANK_CROSS_RE = /^\s*[\/\-]\s*(USD|GBP|EUR|CAD|ZAR|JPY|CNY|CHF|AED|INR|TRY|AUD|SGD|XOF)\b/i;
  const BANK_NAMES = [
    [/US DOLLAR|U\.S\. DOLLAR|UNITED STATES DOLLAR/, 'USD'], [/POUND STERLING|BRITISH POUND/, 'GBP'], [/\bEUROS?\b/, 'EUR'],
    [/CANADIAN DOLLAR/, 'CAD'], [/SOUTH AFRICAN RAND|S\.? ?AFRICA RAND/, 'ZAR'], [/JAPANESE YEN/, 'JPY'],
    [/CHINESE YUAN|RENMINBI/, 'CNY'], [/SWISS FRANC/, 'CHF']
  ];
  // Reads the visible text of a bank's rates page. Rows look like "US Dollars USD 1,460.50 1,470.50 ..." (first two
  // numbers = buy, sell) or "USD / NGN 1392.00" (one number = single rate). `ref` (optional, e.g. the CBN table)
  // rejects numbers more than 30% away from the official rate, which filters out wrong columns and cross rates.
  function parseBankText(text, ref) {
    const rates = {}, single = [];
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.replace(/[₦$£€]/g, ' ').replace(/\b\d{1,2}[\/.\-](?:[A-Za-z]{3,9}|\d{1,2})[\/.\-]\d{2,4}\b/g, ' ').trim();
      if (!line) continue;
      const up = line.toUpperCase();
      let code = null, tail = line;
      const m = up.match(BANK_CODE_RE);
      if (m) { code = m[1]; tail = line.slice(m.index + 3); }
      else {
        for (const [re, c] of BANK_NAMES) {
          const mm = up.match(re);
          if (mm) { code = c; tail = line.slice(mm.index + mm[0].length); break; }
        }
      }
      if (!code || rates[code] || BANK_CROSS_RE.test(tail)) continue;
      let nums = (tail.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) || []).map((x) => parseFloat(x.replace(/,/g, ''))).filter((n) => n > 0);
      const refC = ref && ref.rates && ref.rates[code] && ref.rates[code].central;
      nums = refC ? nums.filter((n) => Math.abs(n / refC - 1) < 0.3) : nums.filter((n) => n >= 1);
      if (!nums.length) continue;
      if (nums.length >= 2) {
        let b = nums[0], s = nums[1];
        if (b > s) { const t = b; b = s; s = t; }
        rates[code] = { buy: b, central: (b + s) / 2, sell: s };
      } else { rates[code] = { buy: nums[0], central: nums[0], sell: nums[0] }; single.push(code); }
    }
    return Object.keys(rates).length ? { rates, single } : null;
  }

  // ---------- Comparison helpers ----------
  const SOURCE_NAMES = { coingecko: 'CoinGecko', binance: 'Binance', coinbase: 'Coinbase' };
  // Same amount priced by each crypto source in table.cryptoQuotes.
  function compareExchanges(amount, from, to, table) {
    if (!table || !table.cryptoQuotes) return [];
    const out = [];
    for (const [k, q] of Object.entries(table.cryptoQuotes)) {
      if (!q) continue;
      const t = buildMarketTable({ fiat: table.fiat, crypto: q });
      try { const r = convert(amount, from, to, t, 'central'); out.push({ name: SOURCE_NAMES[k] || k, result: r.result, rate: r.rate }); } catch { /* source lacks a leg */ }
    }
    return out;
  }
  // Same amount at each saved bank: bank buys foreign currency at 'buy', sells at 'sell'.
  function compareBanks(amount, from, to, store) {
    const out = [];
    for (const [name, b] of Object.entries((store && store.banks) || {})) {
      try { const r = convert(amount, from, to, { rates: b.rates }, 'buysell'); out.push({ name, result: r.result, rate: r.rate, date: b.date }); } catch { /* bank lacks a currency */ }
    }
    return out;
  }

  const api = { parseBankText, compareExchanges, compareBanks, fromCoinbase, normalizeApiResponse, parseManual, convert, COINS, CRYPTO_CODES, fromErApi, fromCoinGecko, fromBinance, buildMarketTable, toDaily, parseFrankfurter, parseCoinGeckoChart, ratioSeries };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rates = api;
})(typeof window !== 'undefined' ? window : globalThis);
