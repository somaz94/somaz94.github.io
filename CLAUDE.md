# CLAUDE.md — somaz94-blog-source

Jekyll personal blog with an integrated Economy Dashboard feature.

<br/>

## Project Overview

- **Framework**: Jekyll 4.3.4
- **Theme**: Jekflix (customized)
- **Deployment**: GitHub Actions → GitHub Pages (`somaz94/somaz94.github.io`)
- **Economy data**: Fetched via Python scripts on a schedule, stored as `_data/*.json`

<br/>

## Economy Dashboard Structure

### Pages

| File | URL | Description | Language |
|---|---|---|---|
| `economy.html` | `/economy/` | Global hub — indices, commodities, crypto, forex, news, KR/US comparison | English |
| `economy/kr.html` | `/economy/kr/` | KR macro dashboard (ECOS data) | Korean |
| `economy/us.html` | `/economy/us/` | US macro dashboard (FRED data) | English |

### Section Order (KR / US parallel structure)

| # | KR (`kr.html`) | US (`us.html`) |
|---|---|---|
| 1 | 주가지수 (KOSPI, KOSDAQ, KOSPI 200) | Stock Indices (S&P 500, NASDAQ, NASDAQ 100, Dow Jones) |
| 2 | 금리 | Interest Rates |
| 3 | 환율 (X/KRW) | Exchange Rates (X/USD) |
| 4 | 물가 | Inflation |
| 5 | 무역·경상수지 | Trade |
| 6 | 고용 · 거시 (실업률, 취업자 수, 외환보유액) | Employment |
| 7 | 성장 · 경기심리 (GDP, CCSI, 뉴스심리지수) | Growth & Sentiment |
| 8 | 경제 뉴스 | Economic News |

### Exchange Rate Pairs

| Page | Pairs | Source |
|---|---|---|
| Main | EUR/USD, USD/JPY, GBP/USD, USD/CNY, USD/KRW | Frankfurter (live JS) |
| KR | USD/KRW, JPY/KRW, EUR/KRW, CNY/KRW, GBP/KRW | ECOS API (server-side) |
| US | EUR/USD, GBP/USD, CHF/USD, CAD/USD, 100 JPY/USD | Frankfurter (live JS) |

### Layout & Styles

- **Layout**: `_layouts/economy.html` — shared layout for all economy pages
  - Contains hover tooltip HTML (`#eco-htip`) and large chart modal (`#eco-modal`)
  - Shared `drawChart(canvas, history)` — custom canvas line chart renderer (no Chart.js)
  - Hover tooltip: small preview on mouseover (desktop), tap for modal (mobile)
  - Click/tap → large modal with full 90-day chart
  - Touch: `touchend` + movement check to avoid 300ms delay
  - Relative timestamp display (`eco-updated` → "2h ago")
  - Modal opens with `body.overflow = hidden` (scroll lock)
  - Mobile sticky bottom nav on KR/US pages (`eco-mobile-nav`)
- **Styles**: `_sass/_economy.scss`

### Data Files (`_data/`)

| File | Source | Keys |
|---|---|---|
| `market_data.json` | yfinance, CoinGecko, Frankfurter, RSS | `updated_at, summary, indices, commodities, rates, crypto, news` |
| `kr_data.json` | BOK ECOS API, RSS (연합뉴스, 한국경제) | `updated_at, rates, prices, macro, fx, trade, growth, news` |
| `us_data.json` | FRED API | `updated_at, inflation, employment, rates, trade, sentiment` |

### Data Scripts (`scripts/`)

| Script | Steps | Purpose |
|---|---|---|
| `fetch_economy_data.py` | 6 | Indices, commodities, rates, crypto 90-day history, news, Gemini AI summary |
| `fetch_korea_data.py` | 7 | KR rates, prices, employment, FX, trade, GDP, news (연합뉴스+한경 RSS) |
| `fetch_us_data.py` | 5 | Inflation, employment, rates, trade, growth & sentiment |

<br/>

## Economy Dashboard — Key Technical Decisions

### Chart System
- **No Chart.js** — custom `drawChart(canvas, history)` renderer using raw Canvas API
- `history` object format: `{ times: ["2025-01-01", ...], values: [100.0, ...] }`
- Responsive padding: `isLg = W > 400` → different padding for small/large canvas
- Modal canvas sized via `requestAnimationFrame` after `display:flex` to get real width

### Crypto Data Flow
- **Current price**: fetched live from CoinGecko `/simple/price` (client JS, 1 API call)
- **90-day chart history**: fetched server-side by `fetch_economy_data.py`, stored in `market_data.json` under `crypto[]`
- Jekyll embeds history into `cryptoHistoryMap` JS variable via Liquid at build time
- Hover tooltip uses pre-stored `data-history` — no client-side `/market_chart` calls
- localStorage cache: 5-min TTL, key `eco_crypto_v2`

### CoinGecko Rate Limit Strategy
- Server-side history fetch: **7-second delay** between each coin (8 coins ≈ 56s total)
- Retry on 429: waits 30s then 60s before giving up
- Client side: only 1 `/simple/price` call for live prices — no rate limit risk

### Color Logic
- `eco-up` (green) = good, `eco-down` (red) = bad
- **Inverted** for: inflation (rising = eco-down), unemployment rate (rising = eco-down)
- Compare table in `economy.html` already applies correct inversion

### Forex Chart History
- Main/US: fetched client-side from Frankfurter API, 90-day window
- KR: server-side from ECOS `731Y001` series, stored in `kr_data.json`

### News Sources
- **Main** (`market_data.json`): Reuters, CNBC, MarketWatch, AP News — parallel fetch via `ThreadPoolExecutor`
- **KR** (`kr_data.json`): 연합뉴스 (`yna.co.kr/rss/economy.xml`), 한국경제 (`hankyung.com/feed/economy`) — top 12 newest
- **US** (`us.html`): reuses `market_data.json` news (already US-centric)

### AI Market Summary
- Gemini API generates both KO and EN summaries from news headlines
- Model fallback order: `gemini-3.1-flash-lite-preview` → `gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemini-3-flash-preview`
- Main page shows EN first, KO below (bilingual)
- Skipped gracefully if `GEMINI_API_KEY` is not set

### ECOS Error Handling
- ECOS returns `{"RESULT": {"CODE": "...", "MESSAGE": "..."}}` on error (not HTTP 4xx)
- Script detects `RESULT` key and prints WARN instead of silently returning empty data
- Retry logic: 429 → wait 15s/30s, other errors → wait 3s, up to 3 attempts

### Weekend Stale Warning
- Threshold: 25h on weekdays, 72h on weekends/Monday-before-08:00 KST
- Implemented in `_layouts/economy.html` JS using UTC day/hour calculation

<br/>

## GitHub Actions Workflows

### `daily-economy.yml`
- **Schedule**: Weekdays 08:00 KST (`0 23 * * 0-4`) and 18:00 KST (`0 9 * * 1-5`)
- **Steps**: fetch_economy_data → fetch_korea_data → fetch_us_data → verify → commit
- **Verify step** checks:
  - Required keys presence per file
  - Data quality: fails if >60% of price items are zero
  - `kr_data.json` arrays checked: `rates, prices, macro, fx`
  - `us_data.json` arrays checked: `inflation, employment, rates, trade`
- `fetch_economy_data` has `timeout-minutes: 10` (crypto retry can take ~3 min)

### `deploy.yml`
- Triggers on push to `main` OR on `Update Economy Data` workflow completion
- Builds Jekyll and deploys to `somaz94/somaz94.github.io`

<br/>

## Required Secrets

| Secret | Used by |
|---|---|
| `GEMINI_API_KEY` | `fetch_economy_data.py` — AI market summary (optional, skipped if missing) |
| `ECOS_API_KEY` | `fetch_korea_data.py` — BOK ECOS API |
| `FRED_API_KEY` | `fetch_us_data.py` — Federal Reserve FRED API |
| `DEPLOY_TOKEN` | `deploy.yml` — push to public GitHub Pages repo |

<br/>

## Development Notes

- All documentation and code comments in English
- Sensitive values (domains, tokens) must be sanitized when working in this repo
- Commit messages in English, Conventional Commits style
- Do not push to remote unless explicitly requested
- API keys stored in `~/.bash_profile` — source before running scripts locally
