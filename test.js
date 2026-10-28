const assert = require('assert');
const R = require('./src/rates.js');
const t = { date: '2026-01-01', source: 'test', rates: { USD: { buy: 1000, central: 1010, sell: 1020 }, EUR: { buy: 1100, central: 1110, sell: 1120 } } };
assert.strictEqual(R.convert(10, 'USD', 'NGN', t, 'central').result, 10100);
assert.strictEqual(R.convert(10, 'USD', 'NGN', t, 'buysell').result, 10000);   // bank buys USD
assert.strictEqual(R.convert(10200, 'NGN', 'USD', t, 'buysell').result, 10);   // bank sells USD
assert.ok(Math.abs(R.convert(1, 'USD', 'EUR', t, 'central').rate - 1010 / 1110) < 1e-12); // cross via NGN
assert.strictEqual(R.convert(5, 'USD', 'USD', t, 'central').result, 5);
const m = R.parseManual('USD,1450.5\nGBP,1800,1810,1820\nbad line', '2026-02-02');
assert.deepStrictEqual(Object.keys(m.rates).sort(), ['GBP', 'USD']);
const n = R.normalizeApiResponse({ rate_date: '2026-03-03', rates: [{ currency: 'USD', buying_rate: '1,000', central_rate: 1010, selling_rate: 1020 }] });
assert.strictEqual(n.rates.USD.central, 1010);
assert.strictEqual(n.date, '2026-03-03');
console.log('all tests passed');

// ---- live market helpers ----
const er = R.fromErApi({ result: 'success', base_code: 'USD', rates: { USD: 1, NGN: 1500, EUR: 0.5, JPY: 150 }, time_next_update_unix: 2000000000 });
assert.strictEqual(er.map.USD, 1500);
assert.strictEqual(er.map.EUR, 3000);          // 1 EUR = 1500/0.5 NGN
assert.strictEqual(er.map.JPY, 10);
assert.strictEqual(R.fromErApi({ result: 'error' }), null);
assert.strictEqual(R.fromErApi({ result: 'success', base_code: 'EUR', rates: { NGN: 1 } }), null);
const cg = R.fromCoinGecko({ bitcoin: { ngn: 150000000 }, 'shiba-inu': { ngn: 0.015 } });
assert.strictEqual(cg.BTC, 150000000);
assert.strictEqual(cg.SHIB, 0.015);
assert.strictEqual(R.fromCoinGecko({}), null);
const mt = R.buildMarketTable({ fiat: er.map, crypto: cg, warnings: [] });
assert.strictEqual(mt.type, 'market');
const c = R.convert(1, 'BTC', 'USD', mt, 'central');
assert.strictEqual(c.result, 150000000 / 1500);
const tiny = R.convert(1, 'NGN', 'SHIB', mt, 'central');
assert.ok(Math.abs(tiny.result - 1 / 0.015) < 1e-9);
console.log('market tests passed');

// ---- history helpers ----
const day = (s) => Date.parse(s + 'T00:00:00Z');
const dly = R.toDaily([[day('2026-01-01') + 1000, 10], [day('2026-01-01') + 5000, 11], [day('2026-01-02'), 12]]);
assert.deepStrictEqual(dly, [['2026-01-01', 11], ['2026-01-02', 12]]);   // last value of each day wins
const ff = R.parseFrankfurter([{ date: '2026-01-02', base: 'USD', quote: 'NGN', rate: 1500 }, { date: '2026-01-01', base: 'USD', quote: 'NGN', rate: 1490 }, { date: '2026-01-01', base: 'USD', quote: 'USD', rate: 1 }], 'NGN');
assert.deepStrictEqual(ff, [['2026-01-01', 1490], ['2026-01-02', 1500]]);
assert.strictEqual(R.parseFrankfurter({ message: 'x' }, 'NGN'), null);
assert.strictEqual(R.parseCoinGeckoChart({ prices: [[1, 5], [2, 0], [3, 7]] }).length, 2);
// BTC (USD price series) in NGN: BTC/USD divided by value-of-1-NGN-in-USD (= 1/rate)
const btcUsd = [['2026-01-01', 100000], ['2026-01-02', 110000], ['2026-01-03', 120000]];
const ngnUsd = [['2026-01-01', 1 / 1500], ['2026-01-03', 1 / 1600]];       // Jan 2 carried forward
const rs = R.ratioSeries(btcUsd, ngnUsd);
assert.strictEqual(rs.length, 3);
assert.ok(Math.abs(rs[0][1] - 100000 * 1500) < 1e-3);
assert.ok(Math.abs(rs[1][1] - 110000 * 1500) < 1e-3);                      // carry-forward
assert.ok(Math.abs(rs[2][1] - 120000 * 1600) < 1e-3);
const rs2 = R.ratioSeries(null, ngnUsd);                                   // USD -> NGN
assert.ok(Math.abs(rs2[0][1] - 1500) < 1e-9);
const late = R.ratioSeries(btcUsd, [['2026-02-01', 1]]);                    // other leg starts later
assert.strictEqual(late.length, 1);                                         // nothing before both legs exist
assert.strictEqual(late[0][0], day('2026-02-01'));
console.log('history tests passed');

// ---- Binance fallback ----
const bn = R.fromBinance([{ symbol: 'BTCUSDT', price: '100000.50' }, { symbol: 'ETHUSDT', price: '4000' }, { symbol: 'BTCEUR', price: '1' }, { symbol: 'XRPUSDT', price: '0' }], 1500);
assert.strictEqual(bn.BTC, 100000.5 * 1500);
assert.strictEqual(bn.ETH, 4000 * 1500);
assert.strictEqual(bn.USDT, 1500);
assert.strictEqual(bn.XRP, undefined);
assert.strictEqual(R.fromBinance([], 1500), null);
assert.strictEqual(R.fromBinance([{ symbol: 'BTCUSDT', price: '1' }], 0), null);
assert.strictEqual(R.buildMarketTable({ fiat: {}, crypto: bn, cryptoSource: 'binance' }).cryptoSource, 'binance');
console.log('binance tests passed');

// ---- v1.3 additions ----
const two = R.parseManual('USD,1440,1465', '2026-10-26');
assert.strictEqual(two.rates.USD.buy, 1440); assert.strictEqual(two.rates.USD.sell, 1465); assert.strictEqual(two.rates.USD.central, 1452.5);
const cbn2 = R.fromCoinbase({ data: { currency: 'USD', rates: { NGN: '1500', BTC: '0.00001', ETH: '0.00025', XYZ: '1' } } });
assert.strictEqual(cbn2.BTC, 1500 / 0.00001); assert.strictEqual(cbn2.ETH, 1500 / 0.00025);
assert.strictEqual(R.fromCoinbase({ data: { rates: { BTC: '0.00001' } } }), null);            // no NGN anywhere
assert.ok(R.fromCoinbase({ data: { rates: { BTC: '0.00001' } } }, 1500));                      // fallback NGN per USD
const store = { banks: { GTBank: { date: '2026-10-26', rates: { USD: { buy: 1440, central: 1452.5, sell: 1465 } } }, Zenith: { date: '2026-10-26', rates: { USD: { buy: 1445, central: 1455, sell: 1465 } } } } };
const cb = R.compareBanks(100, 'USD', 'NGN', store);                                           // bank buys USD from you
assert.deepStrictEqual(cb.map((x) => x.result).sort(), [144000, 144500]);
const cs = R.compareBanks(146500, 'NGN', 'USD', store);                                        // you buy USD at sell rate
assert.strictEqual(cs[0].result, 100);
assert.deepStrictEqual(R.compareBanks(1, 'GBP', 'NGN', store), []);                            // banks lack GBP
const mkt = R.buildMarketTable({ fiat: { USD: 1500 }, crypto: { BTC: 150000000 }, cryptoQuotes: { binance: { BTC: 151000000 }, coinbase: { BTC: 149000000 }, coingecko: { BTC: 150000000 } } });
const ex = R.compareExchanges(1, 'BTC', 'NGN', mkt).sort((a, b) => b.result - a.result);
assert.deepStrictEqual(ex.map((x) => x.name), ['Binance', 'CoinGecko', 'Coinbase']);
assert.strictEqual(R.compareExchanges(1, 'BTC', 'NGN', R.buildMarketTable({ fiat: {}, crypto: {} })).length, 0);
console.log('v1.3 tests passed');

// ---- bank website text parser ----
const page = [
  'FX Rates', 'Exchange Rates of Today: 29/Apr/2026', 'CODE WE BUY WE SELL WE BUY WE SELL DATE MODIFIED',
  'US Dollars  USD 1,460.50 1,470.50 1,460.50 1,470.50 27/Apr/2026',
  'Euro EUR 1,712.00 1,732.00 1,712.00 1,732.00 27/Apr/2026',
  'British Pound GBP 1,977.00 1,997.00 0.00 0.00 27/Apr/2026',
  'Japanese Yen JPY 8.49 11.49 0.00 0.00 27/Apr/2026',
  'EUR / USD 1.1604', 'Canadian Dollar CAD 0.00 0.00 0.00 0.00'
].join('\n');
const bp = R.parseBankText(page, null);
assert.strictEqual(bp.rates.USD.buy, 1460.5); assert.strictEqual(bp.rates.USD.sell, 1470.5);
assert.strictEqual(bp.rates.EUR.sell, 1732); assert.strictEqual(bp.rates.GBP.buy, 1977);
assert.strictEqual(bp.rates.JPY.buy, 8.49);
assert.strictEqual(bp.rates.CAD, undefined);                    // zero rates ignored
assert.deepStrictEqual(bp.single, []);
const card = R.parseBankText('Access Bank Daily Naira Card Rate\nUSD / NGN ₦1392.00\nGBP / NGN ₦1887.06', null);
assert.strictEqual(card.rates.USD.buy, 1392); assert.strictEqual(card.rates.USD.sell, 1392); assert.deepStrictEqual(card.single, ['USD', 'GBP']);
const refT = { rates: { USD: { central: 1465 }, GBP: { central: 1950 } } };
const filtered = R.parseBankText('USD 12.5 13.1\nGBP 1,977.00 1,997.00', refT);
assert.strictEqual(filtered.rates.USD, undefined);              // 12.5 is nowhere near the official rate
assert.strictEqual(filtered.rates.GBP.sell, 1997);
assert.strictEqual(R.parseBankText('nothing useful here', null), null);
console.log('bank parser tests passed');
