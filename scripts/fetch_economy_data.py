#!/usr/bin/env python3
"""
Fetch daily economy data: market indices, commodities, and news.
Writes results to _data/market_data.json for Jekyll to render.

Dependencies: yfinance, feedparser, google-generativeai
Usage: python scripts/fetch_economy_data.py
"""

import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

try:
    import yfinance as yf
except ImportError:
    print("ERROR: 'yfinance' not installed. Run: pip install yfinance", file=sys.stderr)
    sys.exit(1)

try:
    import feedparser
except ImportError:
    print("ERROR: 'feedparser' not installed. Run: pip install feedparser", file=sys.stderr)
    sys.exit(1)

try:
    from google import genai
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False

# ── Configuration ────────────────────────────────────────────────────────────

OUTPUT_FILE = Path(__file__).parent.parent / "_data" / "market_data.json"

INDICES = [
    {"symbol": "^GSPC",  "name": "S&P 500",    "currency": "USD"},
    {"symbol": "^IXIC",  "name": "NASDAQ",      "currency": "USD"},
    {"symbol": "^NDX",   "name": "NASDAQ 100",  "currency": "USD"},
    {"symbol": "^DJI",   "name": "Dow Jones",   "currency": "USD"},
    {"symbol": "^KS11",  "name": "KOSPI",       "currency": "KRW"},
    {"symbol": "^KQ11",  "name": "KOSDAQ",      "currency": "KRW"},
    {"symbol": "^N225",  "name": "Nikkei 225",  "currency": "JPY"},
    {"symbol": "^HSI",   "name": "Hang Seng",   "currency": "HKD"},
    {"symbol": "^FTSE",  "name": "FTSE 100",    "currency": "GBP"},
    {"symbol": "^GDAXI", "name": "DAX",         "currency": "EUR"},
]

COMMODITIES = [
    {"symbol": "GC=F", "name": "Gold",        "unit": "USD/oz"},
    {"symbol": "SI=F", "name": "Silver",      "unit": "USD/oz"},
    {"symbol": "CL=F", "name": "WTI Crude",   "unit": "USD/bbl"},
    {"symbol": "BZ=F", "name": "Brent",       "unit": "USD/bbl"},
    {"symbol": "NG=F",  "name": "Nat. Gas",   "unit": "USD/MMBtu"},
]

RATES = [
    {"symbol": "^VIX",     "name": "VIX",       "unit": ""},
    {"symbol": "^TNX",     "name": "US 10Y",    "unit": "%"},
    {"symbol": "^IRX",     "name": "US 3M",     "unit": "%"},
    {"symbol": "DX-Y.NYB", "name": "USD Index", "unit": ""},
]

NEWS_FEEDS = [
    {"url": "https://feeds.reuters.com/reuters/businessNews",           "source": "Reuters"},
    {"url": "https://www.cnbc.com/id/10000664/device/rss/rss.html",    "source": "CNBC"},
    {"url": "http://feeds.marketwatch.com/marketwatch/topstories/",    "source": "MarketWatch"},
    {"url": "https://feeds.bloomberg.com/markets/news.rss",             "source": "Bloomberg"},
]

# ── Helpers ──────────────────────────────────────────────────────────────────

def fetch_quote(symbol: str) -> dict | None:
    """Fetch latest price and daily change via yfinance."""
    try:
        ticker = yf.Ticker(symbol)
        fi = ticker.fast_info

        current = float(fi.last_price or 0)
        prev = float(fi.previous_close or 0)
        if current == 0:
            return None

        change = round(current - prev, 4)
        change_pct = round((change / prev * 100) if prev else 0, 2)

        # Round price based on magnitude
        if current >= 1000:
            price = round(current, 2)
        elif current >= 10:
            price = round(current, 3)
        else:
            price = round(current, 4)

        return {"price": price, "change": change, "change_pct": change_pct}
    except Exception as exc:
        print(f"  WARN: {symbol} — {exc}", file=sys.stderr)
        return None


def fetch_news(feeds: list, per_feed: int = 5, total_limit: int = 15) -> list:
    """Fetch news headlines from RSS feeds."""
    items = []
    for feed_cfg in feeds:
        try:
            parsed = feedparser.parse(feed_cfg["url"])
            for entry in parsed.entries[:per_feed]:
                title = entry.get("title", "").strip()
                link = entry.get("link", "").strip()
                published = entry.get("published", "")[:16] if entry.get("published") else ""
                if title and link:
                    items.append({
                        "title": title,
                        "url": link,
                        "source": feed_cfg["source"],
                        "published": published,
                    })
        except Exception as exc:
            print(f"  WARN: feed {feed_cfg['source']} — {exc}", file=sys.stderr)
        time.sleep(0.3)

    # Deduplicate by title
    seen = set()
    unique = []
    for item in items:
        key = item["title"].lower()
        if key not in seen:
            seen.add(key)
            unique.append(item)

    return unique[:total_limit]


# Fallback order: highest RPD first, then quality
GEMINI_MODELS = [
    "gemini-3.1-flash-lite-preview",  # RPD=500, RPM=15
    "gemini-2.5-flash",               # RPD=20,  RPM=5
    "gemini-2.5-flash-lite",          # RPD=20,  RPM=10
    "gemini-3-flash-preview",         # RPD=20,  RPM=5
]


def summarize_news(news_items: list) -> dict:
    """Generate Korean and English market summaries from headlines using Gemini.
    Tries each model in GEMINI_MODELS order until one succeeds."""
    empty = {"ko": "", "en": ""}
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key or not GENAI_AVAILABLE or not news_items:
        return empty

    client = genai.Client(api_key=api_key)
    headlines = "\n".join(
        f"- {item['title']} ({item['source']})" for item in news_items
    )
    prompt = (
        "Based on the following global economic/financial news headlines, "
        "provide two market summaries — one in Korean and one in English — "
        "each within 3 sentences. Focus on key issues and market impact.\n\n"
        f"Headlines:\n{headlines}\n\n"
        "Respond in this exact format:\n"
        "KO: <Korean summary here>\n"
        "EN: <English summary here>"
    )

    for model in GEMINI_MODELS:
        try:
            response = client.models.generate_content(model=model, contents=prompt)
            text = response.text.strip()
            ko, en = "", ""
            for line in text.splitlines():
                if line.startswith("KO:"):
                    ko = line[3:].strip()
                elif line.startswith("EN:"):
                    en = line[3:].strip()
            if ko or en:
                print(f"  OK  model={model}")
                return {"ko": ko, "en": en}
        except Exception as exc:
            print(f"  WARN: {model} — {exc}", file=sys.stderr)

    return empty


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    kst = timezone(timedelta(hours=9))
    now_kst = datetime.now(kst)
    updated_at = now_kst.strftime("%Y-%m-%d %H:%M KST")

    print(f"[fetch_economy_data] Starting — {updated_at}")

    # ── Indices ───────────────────────────────────────────────────────────────
    print("\n[1/4] Fetching market indices ...")
    indices_result = []
    for item in INDICES:
        quote = fetch_quote(item["symbol"])
        if quote:
            indices_result.append({
                "symbol": item["symbol"],
                "name": item["name"],
                "currency": item["currency"],
                **quote,
            })
            print(f"  OK  {item['name']:15s} {quote['price']:>12,}  {quote['change_pct']:+.2f}%")
        else:
            indices_result.append({
                "symbol": item["symbol"],
                "name": item["name"],
                "currency": item["currency"],
                "price": 0, "change": 0, "change_pct": 0,
            })

    # ── Commodities ───────────────────────────────────────────────────────────
    print("\n[2/4] Fetching commodities ...")
    commodities_result = []
    for item in COMMODITIES:
        quote = fetch_quote(item["symbol"])
        if quote:
            commodities_result.append({
                "symbol": item["symbol"],
                "name": item["name"],
                "unit": item["unit"],
                **quote,
            })
            print(f"  OK  {item['name']:12s} ${quote['price']:>10,}  {quote['change_pct']:+.2f}%")
        else:
            commodities_result.append({
                "symbol": item["symbol"],
                "name": item["name"],
                "unit": item["unit"],
                "price": 0, "change": 0, "change_pct": 0,
            })

    # ── Interest Rates ────────────────────────────────────────────────────────
    print("\n[3/4] Fetching interest rates & USD index ...")
    rates_result = []
    for item in RATES:
        quote = fetch_quote(item["symbol"])
        if quote:
            rates_result.append({
                "symbol": item["symbol"],
                "name": item["name"],
                "unit": item["unit"],
                **quote,
            })
            print(f"  OK  {item['name']:12s} {quote['price']:>10,}  {quote['change_pct']:+.2f}%")
        else:
            rates_result.append({
                "symbol": item["symbol"],
                "name": item["name"],
                "unit": item["unit"],
                "price": 0, "change": 0, "change_pct": 0,
            })

    # ── News ──────────────────────────────────────────────────────────────────
    print("\n[4/4] Fetching news ...")
    news_result = fetch_news(NEWS_FEEDS)
    print(f"  Collected {len(news_result)} headlines")

    # ── News Summary ──────────────────────────────────────────────────────────
    print("\n[5/5] Generating news summary ...")
    summary = summarize_news(news_result)
    if summary.get("ko"):
        print(f"  OK  KO ({len(summary['ko'])} chars) / EN ({len(summary['en'])} chars)")
    else:
        print("  SKIP  No API key or generation failed")

    # ── Write output ──────────────────────────────────────────────────────────
    output = {
        "updated_at": updated_at,
        "summary": summary,
        "indices": indices_result,
        "commodities": commodities_result,
        "rates": rates_result,
        "news": news_result,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nDone — written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
