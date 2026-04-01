#!/usr/bin/env python3
"""
Fetch EU (Eurozone) macroeconomic data from FRED and Eurostat.
Writes results to _data/eu_data.json for Jekyll to render.

Dependencies: requests, feedparser
Usage: FRED_API_KEY=<key> python scripts/fetch_eu_data.py
"""

import calendar
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

try:
    import feedparser
except ImportError:
    print("ERROR: 'feedparser' not installed. Run: pip install feedparser", file=sys.stderr)
    sys.exit(1)

# ── Configuration ────────────────────────────────────────────────────────────

OUTPUT_FILE = Path(__file__).parent.parent / "_data" / "eu_data.json"
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
EUROSTAT_BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"

# ── Helpers ──────────────────────────────────────────────────────────────────

EMPTY_HIST = {"times": [], "values": []}


def load_previous(path: Path) -> dict:
    try:
        if path.exists():
            with open(path, encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def fallback_list(new_items: list, prev_items: list, key: str = "name") -> list:
    prev_map = {item[key]: item for item in prev_items if key in item}
    result = []
    for item in new_items:
        if item.get("price", 0) == 0 and item.get(key) in prev_map:
            result.append(prev_map[item[key]])
            print(f"  FALLBACK  {item[key]} — using previous data")
        else:
            result.append(item)
    return result


def fetch_fred(api_key: str, series_id: str, limit: int = 15, retries: int = 3) -> list:
    params = {
        "series_id": series_id, "api_key": api_key,
        "file_type": "json", "limit": limit, "sort_order": "desc",
    }
    for attempt in range(retries):
        try:
            resp = requests.get(FRED_BASE, params=params, timeout=15)
            resp.raise_for_status()
            obs = [o for o in resp.json().get("observations", []) if o["value"] != "."]
            return sorted(obs, key=lambda o: o["date"])
        except Exception as exc:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                print(f"  WARN: {series_id} — {exc}", file=sys.stderr)
    return []


def fetch_eurostat(dataset: str, params: dict, retries: int = 3) -> dict:
    """Fetch from Eurostat JSON API. Returns {time_period: value} dict."""
    p = {"format": "JSON", **params}
    for attempt in range(retries):
        try:
            resp = requests.get(f"{EUROSTAT_BASE}/{dataset}", params=p, timeout=20)
            resp.raise_for_status()
            data = resp.json()
            vals = data.get("value", {})
            dims = data.get("dimension", {}).get("time", {}).get("category", {}).get("index", {})
            result = {}
            for period, idx in sorted(dims.items(), key=lambda x: x[1]):
                v = vals.get(str(idx))
                if v is not None:
                    result[period] = v
            return result
        except Exception as exc:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                print(f"  WARN: Eurostat {dataset} — {exc}", file=sys.stderr)
    return {}


def mom_history(rows: list, scale: float = 1.0) -> dict:
    valid = [r for r in rows if r.get("value", "") not in (".", "")]
    times = [r["date"][:7] for r in valid]
    values = [round(float(r["value"]) / scale, 4) for r in valid]
    return {"times": times, "values": values}


def mom_entry(name: str, unit: str, rows: list, history: dict = None) -> dict:
    base = {"name": name, "unit": unit,
            "price": 0, "change": 0, "change_pct": 0, "time": "",
            "history": history or EMPTY_HIST}
    if len(rows) < 2:
        return base
    latest = float(rows[-1]["value"])
    prev_val = float(rows[-2]["value"])
    change = round(latest - prev_val, 4)
    change_pct = round((change / prev_val * 100) if prev_val else 0, 2)
    price = round(latest, 2) if latest >= 10 else round(latest, 3)
    return {"name": name, "unit": unit,
            "price": price, "change": change, "change_pct": change_pct,
            "time": rows[-1]["date"][:7], "history": history or EMPTY_HIST}


def eurostat_entry(name: str, unit: str, data: dict) -> dict:
    """Build entry from Eurostat {time_period: value} dict."""
    base = {"name": name, "unit": unit,
            "price": 0, "change": 0, "change_pct": 0, "time": "",
            "history": EMPTY_HIST}
    if len(data) < 2:
        return base
    items = sorted(data.items())
    times = [t for t, _ in items]
    values = [round(v, 2) for _, v in items]
    hist = {"times": times, "values": values}
    latest = values[-1]
    prev_val = values[-2]
    change = round(latest - prev_val, 2)
    return {"name": name, "unit": unit,
            "price": latest, "change": change, "change_pct": change,
            "time": times[-1], "history": hist}


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    api_key = os.environ.get("FRED_API_KEY", "").strip()
    if not api_key:
        print("ERROR: FRED_API_KEY environment variable not set.", file=sys.stderr)
        sys.exit(1)

    kst = timezone(timedelta(hours=9))
    now_kst = datetime.now(kst)
    updated_at = now_kst.strftime("%Y-%m-%d %H:%M KST")
    print(f"[fetch_eu_data] Starting — {updated_at}")

    prev_data = load_previous(OUTPUT_FILE)

    # ── Interest Rates (FRED) ────────────────────────────────────────────────
    print("\n[1/5] Fetching interest rates ...")
    rates = []

    # ECB Main Refinancing Rate (policy rate)
    rows = fetch_fred(api_key, "ECBMRRFR", limit=90)
    hist = mom_history(rows)
    entry = mom_entry("Policy Rate (ECB)", "%", rows, history=hist)
    entry["change_pct"] = entry["change"]
    rates.append(entry)
    if entry["price"]:
        print(f"  OK  Policy Rate (ECB)   {entry['price']}%  {entry['change']:+.3f}pp  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # ECB Deposit Facility Rate
    rows = fetch_fred(api_key, "ECBDFR", limit=90)
    hist = mom_history(rows)
    entry = mom_entry("Deposit Rate", "%", rows, history=hist)
    entry["change_pct"] = entry["change"]
    rates.append(entry)
    if entry["price"]:
        print(f"  OK  Deposit Rate        {entry['price']}%  {entry['change']:+.3f}pp  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # ECB Marginal Lending Rate
    rows = fetch_fred(api_key, "ECBMLFR", limit=90)
    hist = mom_history(rows)
    entry = mom_entry("Marginal Lending", "%", rows, history=hist)
    entry["change_pct"] = entry["change"]
    rates.append(entry)
    if entry["price"]:
        print(f"  OK  Marginal Lending    {entry['price']}%  {entry['change']:+.3f}pp  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # EU 10Y Government Bond Yield
    rows = fetch_fred(api_key, "IRLTLT01EZM156N", limit=30)
    hist = mom_history(rows)
    entry = mom_entry("EU 10Y Bond", "%", rows, history=hist)
    entry["change_pct"] = entry["change"]
    rates.append(entry)
    if entry["price"]:
        print(f"  OK  EU 10Y Bond         {entry['price']}%  {entry['change']:+.3f}pp  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # ── Inflation (Eurostat) ─────────────────────────────────────────────────
    print("\n[2/5] Fetching inflation data ...")
    prices = []

    # CPI YoY (HICP all items, annual rate of change)
    cpi_data = fetch_eurostat("prc_hicp_manr", {
        "geo": "EA20", "coicop": "CP00", "freq": "M",
        "sinceTimePeriod": "2024-01",
    })
    entry = eurostat_entry("CPI YoY", "%", cpi_data)
    prices.append(entry)
    if entry["price"]:
        print(f"  OK  CPI YoY             {entry['price']}%  {entry['change']:+.2f}pp  [{len(cpi_data)} pts]")
    time.sleep(0.3)

    # Core CPI YoY (HICP excl. energy and food)
    core_data = fetch_eurostat("prc_hicp_manr", {
        "geo": "EA20", "coicop": "TOT_X_NRG_FOOD", "freq": "M",
        "sinceTimePeriod": "2024-01",
    })
    entry = eurostat_entry("Core CPI YoY", "%", core_data)
    prices.append(entry)
    if entry["price"]:
        print(f"  OK  Core CPI YoY        {entry['price']}%  {entry['change']:+.2f}pp  [{len(core_data)} pts]")
    time.sleep(0.3)

    # ── Employment & Macro (Eurostat) ────────────────────────────────────────
    print("\n[3/5] Fetching employment data ...")
    macro = []

    # Unemployment Rate (EA20, seasonally adjusted)
    unemp_data = fetch_eurostat("une_rt_m", {
        "geo": "EA20", "age": "TOTAL", "sex": "T", "unit": "PC_ACT",
        "s_adj": "SA", "freq": "M",
        "sinceTimePeriod": "2024-01",
    })
    entry = eurostat_entry("Unemployment Rate", "%", unemp_data)
    entry["change_pct"] = entry["change"]
    macro.append(entry)
    if entry["price"]:
        print(f"  OK  Unemployment Rate   {entry['price']}%  {entry['change']:+.2f}pp  [{len(unemp_data)} pts]")
    time.sleep(0.3)

    # Employed (EA20, quarterly, thousands → M)
    emp_data = fetch_eurostat("lfsi_emp_q", {
        "geo": "EA20", "age": "Y15-64", "sex": "T", "unit": "THS_PER",
        "s_adj": "SA", "freq": "Q",
        "sinceTimePeriod": "2023-Q1",
    })
    if len(emp_data) >= 2:
        emp_items = sorted(emp_data.items())
        emp_times = [t for t, _ in emp_items]
        emp_values = [round(v / 1000, 2) for _, v in emp_items]
        emp_hist = {"times": emp_times, "values": emp_values}
        latest = emp_values[-1]
        prev_val = emp_values[-2]
        change = round(latest - prev_val, 2)
        change_pct = round((change / prev_val * 100) if prev_val else 0, 2)
        emp_entry = {"name": "Employed", "unit": "M",
                     "price": latest, "change": change, "change_pct": change_pct,
                     "time": emp_times[-1], "history": emp_hist}
        macro.append(emp_entry)
        print(f"  OK  Employed            {latest}M  {change_pct:+.2f}%  [{len(emp_times)} pts]")
    else:
        macro.append({"name": "Employed", "unit": "M",
                      "price": 0, "change": 0, "change_pct": 0, "time": "",
                      "history": EMPTY_HIST})
    time.sleep(0.3)

    # ── Growth & Sentiment ───────────────────────────────────────────────────
    print("\n[4/5] Fetching growth & sentiment data ...")
    growth = []

    # GDP Growth QoQ (chain-linked volumes, % change on previous period)
    gdp_data = fetch_eurostat("namq_10_gdp", {
        "geo": "EA20", "unit": "CLV_PCH_PRE", "na_item": "B1GQ",
        "s_adj": "SCA", "freq": "Q",
        "sinceTimePeriod": "2023-Q1",
    })
    entry = eurostat_entry("GDP Growth QoQ", "%", gdp_data)
    entry["change_pct"] = entry["change"]
    growth.append(entry)
    if entry["price"]:
        print(f"  OK  GDP Growth QoQ      {entry['price']}%  {entry['change']:+.2f}pp  [{len(gdp_data)} pts]")
    time.sleep(0.3)

    # Industrial Production (index 2021=100, seasonally adjusted, MoM%)
    ip_data = fetch_eurostat("sts_inpr_m", {
        "geo": "EA20", "unit": "I21", "nace_r2": "B-D",
        "s_adj": "SCA", "freq": "M",
        "sinceTimePeriod": "2024-01",
    })
    if len(ip_data) >= 2:
        ip_items = sorted(ip_data.items())
        ip_times = [t for t, _ in ip_items]
        ip_values = [v for _, v in ip_items]
        # Compute MoM% from index
        ip_mom_times = ip_times[1:]
        ip_mom_values = [round((ip_values[i] - ip_values[i-1]) / ip_values[i-1] * 100, 2)
                         for i in range(1, len(ip_values))]
        latest_mom = ip_mom_values[-1]
        ip_entry = {"name": "Industrial Production", "unit": "%",
                    "price": latest_mom, "change": latest_mom, "change_pct": latest_mom,
                    "time": ip_mom_times[-1],
                    "history": {"times": ip_mom_times, "values": ip_mom_values}}
        growth.append(ip_entry)
        print(f"  OK  Industrial Prod.    {latest_mom:+.2f}% MoM  [{len(ip_mom_times)} pts]")
    else:
        growth.append({"name": "Industrial Production", "unit": "%",
                       "price": 0, "change": 0, "change_pct": 0, "time": "",
                       "history": EMPTY_HIST})

    # Consumer Confidence — FRED CSCICP02EZM460S (OECD, monthly)
    rows = fetch_fred(api_key, "CSCICP02EZM460S", limit=30)
    hist = mom_history(rows)
    entry = mom_entry("Consumer Confidence", "", rows, history=hist)
    entry["change_pct"] = entry["change"]
    growth.append(entry)
    if entry["price"]:
        print(f"  OK  Consumer Confidence {entry['price']}  {entry['change']:+.2f}  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # ── News ─────────────────────────────────────────────────────────────────
    print("\n[5/5] Fetching EU news ...")
    eu_feeds = [
        {"url": "https://www.ecb.europa.eu/rss/press.html", "source": "ECB"},
        {"url": "https://feeds.bbci.co.uk/news/business/rss.xml", "source": "BBC Business"},
    ]
    news_items = []
    for feed_cfg in eu_feeds:
        try:
            parsed = feedparser.parse(feed_cfg["url"])
            for entry in parsed.entries[:6]:
                title = entry.get("title", "").strip()
                link = entry.get("link", "").strip()
                published = entry.get("published", "")[:16] if entry.get("published") else ""
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

    # ── Fallback ─────────────────────────────────────────────────────────────
    rates  = fallback_list(rates,  prev_data.get("rates",  []))
    prices = fallback_list(prices, prev_data.get("prices", []))
    macro  = fallback_list(macro,  prev_data.get("macro",  []))
    growth = fallback_list(growth, prev_data.get("growth", []))

    # ── Write output ─────────────────────────────────────────────────────────
    output = {
        "updated_at": updated_at,
        "rates": rates,
        "prices": prices,
        "macro": macro,
        "growth": growth,
        "news": news,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nDone — written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
