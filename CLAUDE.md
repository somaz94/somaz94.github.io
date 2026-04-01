# CLAUDE.md — somaz94-blog-source

Jekyll personal blog with an integrated Economy Dashboard feature.

<br/>

## Project Overview

- **Framework**: Jekyll 4.3.4
- **Theme**: Jekflix (customized)
- **Deployment**: GitHub Actions → GitHub Pages (`somaz94/somaz94.github.io`)
- **Economy data**: Fetched via Python scripts on a schedule, stored as `_data/*.json`

<br/>

## Economy Dashboard

### Pages

| File | URL | Description |
|---|---|---|
| `economy.html` | `/economy/` | Global hub — indices, commodities, crypto, forex, news, 3-country comparison |
| `economy/kr.html` | `/economy/kr/` | KR macro dashboard (BOK ECOS) |
| `economy/us.html` | `/economy/us/` | US macro dashboard (FRED) |
| `economy/jp.html` | `/economy/jp/` | JP macro dashboard (FRED + e-Stat) |

### Country Page Convention

Country pages (KR, US, JP, and future additions) must follow a **consistent structure**.
See **[`docs/ECONOMY-STRUCTURE.md`](docs/ECONOMY-STRUCTURE.md)** for the full specification:
- 8-section order, section titles, card format, empty state messages
- Side-by-side data comparison (rates, inflation, FX, trade, employment, growth, news)
- JSON key mapping per country
- Card data format spec

See **[`docs/ECONOMY-TECHNICAL.md`](docs/ECONOMY-TECHNICAL.md)** for implementation details:
- Chart system, crypto data flow, CoinGecko rate limits
- Color logic, forex history, news sources, AI summary
- ECOS error handling, weekend stale warning

### Policy Rate Sources

| Country | Source | Auto-update? |
|---|---|---|
| KR — Policy Rate (BOK) | BOK ECOS API | ✅ Automatic |
| US — Policy Rate (Fed) | FRED `DFEDTARU` | ✅ Automatic |
| JP — Policy Rate (BOJ) | Lookup table in `fetch_jp_data.py` | ❌ Manual — add a line when BOJ changes rate |

BOJ holds 8 meetings/year. 2026 schedule in script comments.
Source: https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm

### Layout & Styles

- **Layout**: `_layouts/economy.html` — shared for all economy pages
- **Styles**: `_sass/_economy.scss`

### Data Scripts

| Script | Primary API | Env Key |
|---|---|---|
| `fetch_economy_data.py` | yfinance, CoinGecko, Frankfurter, RSS, Gemini | `GEMINI_API_KEY` |
| `fetch_kr_data.py` | BOK ECOS | `ECOS_API_KEY` |
| `fetch_us_data.py` | FRED | `FRED_API_KEY` |
| `fetch_jp_data.py` | FRED + e-Stat | `FRED_API_KEY`, `ESTAT_API_KEY` |

<br/>

## GitHub Actions Workflows

### `daily-economy.yml`
- **Schedule**: Weekdays 08:00 KST (`0 23 * * 0-4`) and 18:00 KST (`0 9 * * 1-5`)
- **Steps**: fetch_economy_data → fetch_kr_data → fetch_us_data → fetch_jp_data → verify → commit
- **Verify**: required keys check + data quality (>60% zero = fail)
- `fetch_economy_data` has `timeout-minutes: 10` (crypto retry can take ~3 min)

### `deploy.yml`
- Triggers on push to `main` OR on `Update Economy Data` workflow completion
- Builds Jekyll and deploys to `somaz94/somaz94.github.io`

<br/>

## Required Secrets

| Secret | Used by |
|---|---|
| `GEMINI_API_KEY` | `fetch_economy_data.py` — AI summary (optional) |
| `ECOS_API_KEY` | `fetch_kr_data.py` — BOK ECOS API |
| `FRED_API_KEY` | `fetch_us_data.py`, `fetch_jp_data.py` — FRED API |
| `ESTAT_API_KEY` | `fetch_jp_data.py` — Japan e-Stat API |
| `DEPLOY_TOKEN` | `deploy.yml` — push to GitHub Pages repo |

<br/>

## Development Notes

- All documentation and code comments in English
- Sensitive values (domains, tokens) must be sanitized when working in this repo
- Commit messages in English, Conventional Commits style
- Do not push to remote unless explicitly requested
- API keys stored in `~/.bash_profile` — source before running scripts locally
