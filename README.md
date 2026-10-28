# ICE Rates Terminal (Windows desktop, Electron)

Converts between NGN, ~160 world currencies and 18 major cryptocurrencies, and compares Nigerian bank rates, the CBN official rate and crypto exchanges.

## What's new in 1.4
- **Bank rates from official websites:** in Edit bank rates, paste a bank's own exchange-rate page link and press *Fetch from website*. The app opens the page in a hidden window, reads the rate table, and fills the rates for you to check before saving. *Update all banks from websites* refreshes every bank that has a saved link (also runs once at start-up).
- Best effort only: it reads the page's visible text, so a redesigned page may need a new link, PDF rate sheets cannot be read, and numbers far from the CBN rate are ignored as likely mistakes. Always confirm important figures with the bank.

## What's new in 1.3
- Renamed **ICE Rates Terminal** (the name is set in `package.json` productName and a few labels; easy to change).
- **Nigerian bank rates:** GTBank, Zenith, Access, UBA, First Bank, Stanbic IBTC, FCMB, Fidelity, Sterling, Union, Wema, Polaris, Ecobank, Standard Chartered. Banks have no free standard rate feed, so you enter each bank's buy/sell rates (Edit bank rates). The Bank comparison panel then shows what each bank would give for your amount, beside the CBN official rate, with the highest payout marked.
- **Crypto exchanges:** Binance and Coinbase added next to CoinGecko. Choose a preferred source, or leave Auto. The Exchange comparison panel shows the same amount priced by each.
- **Amount field** adds thousands commas as you type (1,000 / 1,234,567.89).

## Features
- Bold, large-type dark/light interface with a live scrolling rate ticker (green/red arrows when a rate moves)
- Live market and CBN official modes, ~160 currencies + 18 cryptocurrencies
- One-click quick pairs, instant swap, copy result
- Watchlist: your amount shown in several currencies at once (click a row to convert to it)
- Trend chart that builds as the app runs and is saved between sessions
- Rate alerts with desktop notifications
- Trend chart with 7D / 30D / 90D / 1Y / 5Y history and hover read-out (crypto up to 1Y)
- Auto-update from GitHub Releases (installed version)
- Pin-on-top mini mode, offline cache, single-instance, keyboard shortcuts

## Run
    npm install
    npm start

## Build the Windows installer / portable .exe
    npm run dist       # output in dist/ (installer with desktop shortcut + portable .exe)

Or build in the cloud with no setup on your PC: push this folder to a GitHub repo, open
Actions > "Build Windows app" > Run workflow, then download the .exe from the run's artifacts
(`.github/workflows/build-windows.yml`). Pushing a tag like `v1.1.0` triggers it too.

## Rate sources (switch in the app)
1. **Live market** (default)
   - Crypto: CoinGecko `/simple/price` (priced directly in NGN), refreshed every 60 s.
   - Currencies: ExchangeRate-API. Without a key it uses the open endpoint, which updates about once a day.
     Paste an ExchangeRate-API key in Settings for the faster update tiers of your plan.
     The app only re-requests currency rates when the provider's "next update" time has passed.
   - If one half fails (e.g. rate limit), the other still updates and the app shows a warning plus last-saved values.
2. **CBN official rate** (fiat, once per business day)
   - Provider API (default AllRatesToday CBN endpoint, key in Settings), or
   - Manual paste from cbn.gov.ng: `USD,1450.20` or `USD,buy,central,sell`.

Each source keeps its own offline cache.

## Important
- Market rates are NOT the CBN official rate and not the parallel-market rate; they are aggregated/interbank-style reference prices.
- Attribution to ExchangeRate-API and CoinGecko is shown in the app, as their free terms require.
- CoinGecko's free plan may require a (free) demo key; add it in Settings if you get HTTP 401/429.
- Crypto coin list lives in `COINS` in `src/rates.js`; add coins by CoinGecko id.

## Conversion rules
- All rates are NGN per 1 unit; NGN is the pivot (cross rate = from/to).
- CBN mode: central uses mid both ways; buying/selling uses buy when you sell foreign currency, sell when you buy it.
- Market mode uses a single mid price.

## Test
    npm test

## Auto-update setup (one time)
1. Create a GitHub repo and put your username/repo in `package.json` > `build.publish` (replace `YOUR_GITHUB_USERNAME`).
2. Push the project. Bump `version` in `package.json`, then `git tag v1.2.1 && git push --tags`.
3. The workflow builds the installer and publishes it (plus `latest.yml`) to GitHub Releases.
4. Installed copies check on start and every 4 hours, download in the background, and show "Restart & update".
- Works for the installer (NSIS) build only; the portable .exe does not self-update.
- Private repos need a token on user machines; use a public repo (or a release-only public repo) for simplicity.
- Unsigned builds still update, but Windows SmartScreen may warn on first install.

## History data
- Currency pairs (including NGN): Frankfurter v2 (free, no key; central-bank data). For NGN the data may be less frequent than daily.
- Crypto pairs: CoinGecko market_chart, combined with Frankfurter when the other side is a currency. Free plan allows up to 1 year.
- Results are cached for 10 minutes. These are reference rates and can differ from live market and CBN official rates.
