#!/usr/bin/env python3
"""
Fetch Korean economic data from ECOS (한국은행 경제통계시스템).
Writes results to _data/kr_data.json for Jekyll to render.

Dependencies: requests
Usage: ECOS_API_KEY=<key> python scripts/fetch_korea_data.py
"""

import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: 'requests' not installed. Run: pip install requests", file=sys.stderr)
    sys.exit(1)

# ── Configuration ────────────────────────────────────────────────────────────

OUTPUT_FILE = Path(__file__).parent.parent / "_data" / "kr_data.json"
ECOS_BASE = "https://ecos.bok.or.kr/api/StatisticSearch"

# ── Helpers ──────────────────────────────────────────────────────────────────

def daily_range(days: int = 15) -> tuple[str, str]:
    end = datetime.now()
    start = end - timedelta(days=days)
    return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")


def monthly_range(months: int = 15) -> tuple[str, str]:
    end = datetime.now()
    start = end - timedelta(days=months * 31)
    return start.strftime("%Y%m"), end.strftime("%Y%m")


def quarterly_range(years: int = 2) -> tuple[str, str]:
    now = datetime.now()
    return f"{now.year - years}Q1", f"{now.year}Q4"


def fetch_ecos(api_key: str, stat_code: str, period: str,
               start: str, end: str, item_code: str = "", retries: int = 3) -> list:
    url = (f"{ECOS_BASE}/{api_key}/json/kr/1/100"
           f"/{stat_code}/{period}/{start}/{end}/{item_code}")
    for attempt in range(retries):
        try:
            resp = requests.get(url, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            if "RESULT" in data:
                print(f"  WARN: ECOS error {stat_code}/{item_code} — {data['RESULT']}", file=sys.stderr)
                return []
            rows = data.get("StatisticSearch", {}).get("row", [])
            return sorted(rows, key=lambda r: r.get("TIME", ""))
        except requests.exceptions.HTTPError as exc:
            code = exc.response.status_code if exc.response is not None else 0
            if code == 429 and attempt < retries - 1:
                wait = 15 * (attempt + 1)
                print(f"  RATE LIMIT {stat_code}/{item_code}, waiting {wait}s ...", file=sys.stderr)
                time.sleep(wait)
            elif attempt < retries - 1:
                time.sleep(3)
            else:
                print(f"  WARN: {stat_code}/{item_code} — {exc}", file=sys.stderr)
                return []
        except Exception as exc:
            if attempt < retries - 1:
                time.sleep(3)
            else:
                print(f"  WARN: {stat_code}/{item_code} — {exc}", file=sys.stderr)
                return []
    return []


def latest_two(rows: list) -> tuple:
    """Return (latest_val, prev_val, time_label) from sorted rows.
    Deduplicates by TIME so mixed series (e.g. 원계열/계절조정) don't corrupt results."""
    valid = [r for r in rows if r.get("DATA_VALUE", "").strip()]
    # Keep last occurrence per TIME period (ECOS appends 계절조정 after 원계열)
    deduped: dict = {}
    for r in valid:
        deduped[r.get("TIME", "")] = r
    sorted_rows = sorted(deduped.values(), key=lambda r: r.get("TIME", ""))
    if not sorted_rows:
        return None, None, ""
    latest_val = float(sorted_rows[-1]["DATA_VALUE"])
    prev_val = float(sorted_rows[-2]["DATA_VALUE"]) if len(sorted_rows) >= 2 else latest_val
    return latest_val, prev_val, sorted_rows[-1].get("TIME", "")


def extract_history(rows: list, scale: float = 1.0) -> dict:
    """Extract deduplicated time-series history from ECOS rows for charting."""
    valid = [r for r in rows if r.get("DATA_VALUE", "").strip()]
    deduped: dict = {}
    for r in valid:
        deduped[r.get("TIME", "")] = r
    sorted_rows = sorted(deduped.values(), key=lambda r: r.get("TIME", ""))
    times  = [fmt_time(r.get("TIME", "")) for r in sorted_rows]
    values = [round(float(r["DATA_VALUE"]) / scale, 4) for r in sorted_rows]
    return {"times": times, "values": values}


def fmt_time(raw: str) -> str:
    """Normalize ECOS time labels to human-readable format.
    '20260330' → '2026-03-30', '202602' → '2026-02', '2025Q4' → '2025 Q4'"""
    raw = raw.strip()
    if len(raw) == 8 and raw.isdigit():
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"
    if len(raw) == 6 and raw.isdigit():
        return f"{raw[:4]}-{raw[4:]}"
    if len(raw) == 6 and "Q" in raw:
        return raw.replace("Q", " Q")
    return raw


def build_entry(name: str, unit: str, latest, prev, time_label: str,
                scale: float = 1.0, history: dict = None) -> dict:
    empty_hist = {"times": [], "values": []}
    if latest is None:
        return {"name": name, "unit": unit,
                "price": 0, "prev": 0, "change": 0, "change_pct": 0, "time": "",
                "history": empty_hist}
    latest = latest / scale
    prev = prev / scale
    change = round(latest - prev, 4)
    change_pct = round((change / prev * 100) if prev else 0, 2)
    price = round(latest, 2) if latest >= 10 else round(latest, 3)
    return {"name": name, "unit": unit,
            "price": price, "prev": round(prev, 3),
            "change": change, "change_pct": change_pct, "time": fmt_time(time_label),
            "history": history if history is not None else empty_hist}


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    api_key = os.environ.get("ECOS_API_KEY", "").strip()
    if not api_key:
        print("ERROR: ECOS_API_KEY environment variable not set.", file=sys.stderr)
        sys.exit(1)

    kst = timezone(timedelta(hours=9))
    now_kst = datetime.now(kst)
    updated_at = now_kst.strftime("%Y-%m-%d %H:%M KST")
    print(f"[fetch_korea_data] Starting — {updated_at}")

    d_start, d_end = daily_range(90)    # 90 days for daily (rates, FX)
    m_start, m_end = monthly_range(24)   # 24 months for monthly series
    q_start, q_end = quarterly_range(3)  # 3 years for quarterly (GDP)

    # ── Interest Rates ────────────────────────────────────────────────────────
    print("\n[1/6] Fetching interest rates ...")
    rates = []

    specs = [
        ("722Y001", "D", d_start, d_end, "0101000",   "기준금리",    "%", 1.0),
        ("817Y002", "D", d_start, d_end, "010200000",  "국고채 3년",  "%", 1.0),
        ("817Y002", "D", d_start, d_end, "010210000",  "국고채 10년", "%", 1.0),
    ]
    for stat, period, s, e, item, name, unit, scale in specs:
        rows = fetch_ecos(api_key, stat, period, s, e, item)
        v, p, t = latest_two(rows)
        hist = extract_history(rows, scale)
        entry = build_entry(name, unit, v, p, t, scale, history=hist)
        entry["change_pct"] = entry["change"]  # absolute pp for rate indicators
        rates.append(entry)
        if v is not None:
            print(f"  OK  {name:12s}  {entry['price']}%  {entry['change']:+.3f}pp  [{len(hist['times'])} pts]")
        time.sleep(0.3)

    # ── Prices ────────────────────────────────────────────────────────────────
    print("\n[2/6] Fetching price data ...")
    prices = []

    price_specs = [
        ("901Y009", "M", m_start, m_end, "0",  "소비자물가 (CPI)", "", 1.0),
        ("901Y010", "M", m_start, m_end, "QB", "근원물가",         "", 1.0),
    ]
    for stat, period, s, e, item, name, unit, scale in price_specs:
        rows = fetch_ecos(api_key, stat, period, s, e, item)
        v, p, t = latest_two(rows)
        hist = extract_history(rows, scale)
        entry = build_entry(name, unit, v, p, t, scale, history=hist)
        prices.append(entry)
        if v is not None:
            print(f"  OK  {name:20s}  {entry['price']}  {entry['change_pct']:+.3f}%  [{len(hist['times'])} pts]")
        time.sleep(0.3)

    # ── Employment ────────────────────────────────────────────────────────────
    print("\n[3/6] Fetching employment data ...")
    macro = []

    # 실업률 — pp change
    rows = fetch_ecos(api_key, "901Y027", "M", m_start, m_end, "I61BC")
    v, p, t = latest_two(rows)
    hist = extract_history(rows)
    entry = build_entry("실업률", "%", v, p, t, history=hist)
    entry["change_pct"] = entry["change"]  # absolute pp
    macro.append(entry)
    if v is not None:
        print(f"  OK  실업률          {entry['price']}%  {entry['change']:+.2f}pp  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # 취업자 수 — scale to M명, dedup handles 원계열/계절조정
    rows = fetch_ecos(api_key, "901Y027", "M", m_start, m_end, "I61BA")
    v, p, t = latest_two(rows)
    hist = extract_history(rows, scale=1000.0)
    entry = build_entry("취업자 수", "M명", v, p, t, scale=1000.0, history=hist)
    macro.append(entry)
    if v is not None:
        print(f"  OK  취업자 수       {entry['price']}M명  {entry['change_pct']:+.2f}%  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # ── Exchange Rates ────────────────────────────────────────────────────────
    print("\n[4/6] Fetching exchange rates ...")
    fx = []

    fx_specs = [
        ("731Y001", "D", d_start, d_end, "0000001", "USD/KRW", "원",      1.0),
        ("731Y001", "D", d_start, d_end, "0000002", "JPY/KRW", "원/100¥", 1.0),
        ("731Y001", "D", d_start, d_end, "0000003", "EUR/KRW", "원",      1.0),
        ("731Y001", "D", d_start, d_end, "0000053", "CNY/KRW", "원",      1.0),
        ("731Y001", "D", d_start, d_end, "0000012", "GBP/KRW", "원",      1.0),
    ]
    for stat, period, s, e, item, name, unit, scale in fx_specs:
        rows = fetch_ecos(api_key, stat, period, s, e, item)
        v, p, t = latest_two(rows)
        hist = extract_history(rows, scale)
        entry = build_entry(name, unit, v, p, t, scale, history=hist)
        fx.append(entry)
        if v is not None:
            print(f"  OK  {name:10s}  {entry['price']:,.2f}  {entry['change_pct']:+.3f}%  [{len(hist['times'])} pts]")
        time.sleep(0.3)

    # ── Trade & Current Account ───────────────────────────────────────────────
    print("\n[5/6] Fetching trade data ...")
    trade = []

    # 수출/수입: 901Y118 values in thousands USD → divide by 1,000,000 for B$
    exports_v, imports_v, trade_time = None, None, ""
    for item, name in [("T002", "수출"), ("T004", "수입")]:
        rows = fetch_ecos(api_key, "901Y118", "M", m_start, m_end, item)
        v, p, t = latest_two(rows)
        hist = extract_history(rows, scale=1_000_000.0)
        entry = build_entry(name, "B$", v, p, t, scale=1_000_000.0, history=hist)
        trade.append(entry)
        if v is not None:
            print(f"  OK  {name:6s}  ${entry['price']:.2f}B  {entry['change_pct']:+.2f}%  [{len(hist['times'])} pts]")
            if name == "수출":
                exports_v, trade_time = entry["price"], t
            elif name == "수입":
                imports_v = entry["price"]
        time.sleep(0.3)

    # 무역수지 = 수출 - 수입  (compute monthly balance history)
    if exports_v is not None and imports_v is not None:
        balance = round(exports_v - imports_v, 2)
        # Build balance history by matching months from exports/imports rows
        exp_rows = fetch_ecos(api_key, "901Y118", "M", m_start, m_end, "T002")
        imp_rows = fetch_ecos(api_key, "901Y118", "M", m_start, m_end, "T004")
        exp_by_month = {r["TIME"]: float(r["DATA_VALUE"]) for r in exp_rows if r.get("DATA_VALUE", "").strip()}
        imp_by_month = {r["TIME"]: float(r["DATA_VALUE"]) for r in imp_rows if r.get("DATA_VALUE", "").strip()}
        common_months = sorted(set(exp_by_month) & set(imp_by_month))
        bal_times  = [fmt_time(m) for m in common_months]
        bal_values = [round((exp_by_month[m] - imp_by_month[m]) / 1_000_000.0, 4) for m in common_months]
        bal_history = {"times": bal_times, "values": bal_values}
        trade.append({"name": "무역수지", "unit": "B$",
                      "price": balance, "prev": 0, "change": 0, "change_pct": 0,
                      "time": fmt_time(trade_time), "history": bal_history})
        print(f"  OK  무역수지  {'+'if balance>=0 else ''}${balance:.2f}B  [{len(bal_times)} pts]")

    # 경상수지: 301Y017/SA000, values in million USD → divide by 1,000 for B$
    rows = fetch_ecos(api_key, "301Y017", "M", m_start, m_end, "SA000")
    v, p, t = latest_two(rows)
    hist = extract_history(rows, scale=1000.0)
    entry = build_entry("경상수지", "B$", v, p, t, scale=1000.0, history=hist)
    trade.append(entry)
    if v is not None:
        print(f"  OK  경상수지  {'+'if entry['price']>=0 else ''}${entry['price']:.2f}B  {entry['change_pct']:+.2f}%  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # ── GDP Growth ────────────────────────────────────────────────────────────
    print("\n[6/6] Fetching GDP growth ...")
    growth = []

    # 902Y015/KOR: 국제 주요국 경제성장률 한국, quarterly QoQ%
    rows = fetch_ecos(api_key, "902Y015", "Q", q_start, q_end, "KOR")
    v, p, t = latest_two(rows)
    hist = extract_history(rows)
    entry = build_entry("GDP 성장률", "%", v, p, t, history=hist)
    entry["change_pct"] = entry["change"]  # absolute pp
    growth.append(entry)
    if v is not None:
        print(f"  OK  GDP 성장률     {entry['price']}%  {entry['change']:+.2f}pp  ({t})  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # ── News ─────────────────────────────────────────────────────────────────
    print("\n[7/7] Fetching Korea news ...")
    import feedparser, calendar
    kr_feeds = [
        {"url": "https://www.yna.co.kr/rss/economy.xml",   "source": "연합뉴스"},
        {"url": "https://www.hankyung.com/feed/economy",    "source": "한국경제"},
    ]
    news_items = []
    for feed_cfg in kr_feeds:
        try:
            parsed = feedparser.parse(feed_cfg["url"])
            for entry in parsed.entries[:6]:
                title = entry.get("title", "").strip()
                link  = entry.get("link",  "").strip()
                published  = entry.get("published", "")[:16] if entry.get("published") else ""
                pub_parsed = entry.get("published_parsed")
                pub_ts = int(calendar.timegm(pub_parsed)) if pub_parsed else 0
                if title and link:
                    news_items.append({"title": title, "url": link,
                                       "source": feed_cfg["source"],
                                       "published": published, "_ts": pub_ts})
        except Exception as exc:
            print(f"  WARN: {feed_cfg['source']} — {exc}", file=sys.stderr)
    seen, unique = set(), []
    for item in news_items:
        key = item["title"].lower()
        if key not in seen:
            seen.add(key)
            unique.append(item)
    unique.sort(key=lambda x: x["_ts"], reverse=True)
    for item in unique:
        item.pop("_ts", None)
    news = unique[:12]
    print(f"  Collected {len(news)} headlines")

    # ── Write output ──────────────────────────────────────────────────────────
    output = {
        "updated_at": updated_at,
        "rates": rates,
        "prices": prices,
        "macro": macro,
        "fx": fx,
        "trade": trade,
        "growth": growth,
        "news": news,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nDone — written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
