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

| File | URL | Description |
|---|---|---|
| `economy.html` | `/economy/` | Main dashboard — live crypto, forex, indices, commodities, news |
| `economy/kr.html` | `/economy/kr/` | Korea macro dashboard (ECOS data) |
| `economy/us.html` | `/economy/us/` | US macro dashboard (FRED data) |

### Layout & Styles

- **Layout**: `_layouts/economy.html` — shared layout for all economy pages
  - Contains hover tooltip HTML (`#eco-htip`) and large chart modal (`#eco-modal`)
  - Shared `drawChart(c, history)` — custom canvas line chart renderer (no Chart.js)
  - Hover tooltip: small preview on mouseover (desktop), tap for modal (mobile)
  - Click/tap → large modal with full 90-day chart
  - Touch: `touchend` + movement check to avoid 300ms delay
  - Relative timestamp display (`eco-updated` → "2h ago")
  - Modal opens with `body.overflow = hidden` (scroll lock)
- **Styles**: `_sass/_economy.scss`

### Data Files (`_data/`)

| File | Source | Updated |
|---|---|---|
| `market_data.json` | Yahoo Finance (yfinance), CoinGecko, Reuters/CNBC/MarketWatch RSS | Weekdays 08:00 & 18:00 KST |
| `kr_data.json` | BOK ECOS API | Weekdays 08:00 & 18:00 KST |
| `us_data.json` | FRED API | Weekdays 08:00 & 18:00 KST |

### Data Scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `fetch_economy_data.py` | Indices, commodities, interest rates, crypto 90-day history, news, Gemini AI summary |
| `fetch_korea_data.py` | KR rates, FX, inflation, trade, employment, GDP |
| `fetch_us_data.py` | US inflation, employment, rates, sentiment/growth |

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
- `data-coin-id` stays on cards as fallback if history is missing
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
- Fetched client-side from Frankfurter API (`/fromDate..?from=USD&to=KRW,EUR,JPY,CNY,GBP`)
- 90-day window, builds per-pair history arrays, attaches via `setAttribute('data-history', ...)`

<br/>

## GitHub Actions Workflows

### `daily-economy.yml`
- **Schedule**: Weekdays 08:00 KST (`0 23 * * 0-4`) and 18:00 KST (`0 9 * * 1-5`)
- **Steps**: fetch_economy_data → fetch_korea_data → fetch_us_data → verify → commit
- **Verify step** checks required keys: `market_data.json` must have `[updated_at, indices, commodities, rates, crypto, news]`
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

## Known Issues / Future Work

- ECOS API calls lack retry logic (FRED and CoinGecko have retry)
- Weekend stale warning threshold (25h) doesn't account for Mon morning after weekend gap
- KR/US comparison section vanishes silently if one data source fails
- Crypto tooltip fetch has no timeout (shows "Loading..." indefinitely on 429)
- `fetch_economy_data.py` runs 4/5 → 5/5 step numbering in logs (cosmetic bug)

<br/>

## Development Notes

- All documentation and code comments in English
- Sensitive values (domains, tokens) must be sanitized when working in this repo
- Commit messages in English, Conventional Commits style
- Do not push to remote unless explicitly requested
