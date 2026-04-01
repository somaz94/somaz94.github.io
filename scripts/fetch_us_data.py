#!/usr/bin/env python3
"""
Fetch US macroeconomic data from FRED (Federal Reserve Economic Data).
Writes results to _data/us_data.json for Jekyll to render.

Dependencies: requests
Usage: FRED_API_KEY=<key> python scripts/fetch_us_data.py
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

OUTPUT_FILE = Path(__file__).parent.parent / "_data" / "us_data.json"
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"

# ── Helpers ──────────────────────────────────────────────────────────────────

def fetch_fred(api_key: str, series_id: str, limit: int = 15, retries: int = 3) -> list:
    """Fetch observations from FRED API, sorted ascending."""
    params = {
        "series_id": series_id,
        "api_key": api_key,
        "file_type": "json",
        "limit": limit,
        "sort_order": "desc",
    }
    for attempt in range(retries):
        try:
            resp = requests.get(FRED_BASE, params=params, timeout=15)
            resp.raise_for_status()
            obs = [o for o in resp.json().get("observations", []) if o["value"] != "."]
            return sorted(obs, key=lambda o: o["date"])
        except Exception as exc:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)  # 1s, 2s
            else:
                print(f"  WARN: {series_id} — {exc}", file=sys.stderr)
    return []


EMPTY_HIST = {"times": [], "values": []}


def load_previous(path: Path) -> dict:
    """Load existing JSON output if it exists, for fallback on fetch failure."""
    try:
        if path.exists():
            with open(path, encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def fallback_list(new_items: list, prev_items: list, key: str = "name") -> list:
    """Replace price=0 entries in new_items with previous data keyed by name."""
    prev_map = {item[key]: item for item in prev_items if key in item}
    result = []
    for item in new_items:
        if item.get("price", 0) == 0 and item.get(key) in prev_map:
            result.append(prev_map[item[key]])
            print(f"  FALLBACK  {item[key]} — using previous data")
        else:
            result.append(item)
    return result


def mom_history(rows: list, scale: float = 1.0) -> dict:
    """Build price history array from FRED observations."""
    valid = [r for r in rows if r.get("value", "") not in (".", "")]
    times  = [r["date"][:7] for r in valid]
    values = [round(float(r["value"]) / scale, 4) for r in valid]
    return {"times": times, "values": values}


def yoy_history(rows: list) -> dict:
    """Build YoY% history array — needs 13+ raw observations per point."""
    valid = [r for r in rows if r.get("value", "") not in (".", "")]
    times, values = [], []
    for i in range(12, len(valid)):
        try:
            val  = float(valid[i]["value"])
            base = float(valid[i - 12]["value"])
            if base:
                times.append(valid[i]["date"][:7])
                values.append(round((val / base - 1) * 100, 2))
        except (ValueError, ZeroDivisionError):
            continue
    return {"times": times, "values": values}


def mom_entry(name: str, unit: str, rows: list, history: dict = None) -> dict:
    """Build entry from latest two observations (MoM change)."""
    base = {"name": name, "unit": unit,
            "price": 0, "change": 0, "change_pct": 0, "time": "",
            "history": history or EMPTY_HIST}
    if len(rows) < 2:
        return base
    latest = float(rows[-1]["value"])
    prev = float(rows[-2]["value"])
    change = round(latest - prev, 4)
    change_pct = round((change / prev * 100) if prev else 0, 2)
    price = round(latest, 2) if latest >= 10 else round(latest, 3)
    return {"name": name, "unit": unit,
            "price": price, "change": change, "change_pct": change_pct,
            "time": rows[-1]["date"][:7], "history": history or EMPTY_HIST}


def yoy_entry(name: str, unit: str, rows: list, history: dict = None) -> dict:
    """Build entry showing YoY% as the main value (for CPI etc.)."""
    base = {"name": name, "unit": unit,
            "price": 0, "change": 0, "change_pct": 0, "time": "",
            "history": history or EMPTY_HIST}
    if len(rows) < 13:
        return base
    latest = float(rows[-1]["value"])
    year_ago = float(rows[-13]["value"])
    yoy_now = round((latest / year_ago - 1) * 100, 2)

    # Change in YoY rate vs previous month
    if len(rows) >= 14:
        prev = float(rows[-2]["value"])
        year_ago_prev = float(rows[-14]["value"])
        yoy_prev = round((prev / year_ago_prev - 1) * 100, 2)
        change = round(yoy_now - yoy_prev, 2)
    else:
        change = 0

    return {"name": name, "unit": unit,
            "price": yoy_now, "change": change, "change_pct": change,
            "time": rows[-1]["date"][:7], "history": history or EMPTY_HIST}


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    api_key = os.environ.get("FRED_API_KEY", "").strip()
    if not api_key:
        print("ERROR: FRED_API_KEY environment variable not set.", file=sys.stderr)
        sys.exit(1)

    kst = timezone(timedelta(hours=9))
    now_kst = datetime.now(kst)
    updated_at = now_kst.strftime("%Y-%m-%d %H:%M KST")
    print(f"[fetch_us_data] Starting — {updated_at}")

    prev = load_previous(OUTPUT_FILE)

    # ── Inflation ─────────────────────────────────────────────────────────────
    print("\n[1/5] Fetching inflation data ...")
    inflation = []

    for series, name in [("CPIAUCSL", "CPI YoY"), ("CPILFESL", "Core CPI YoY"),
                          ("PCEPI", "PCE YoY"), ("PCEPILFE", "Core PCE YoY"),
                          ("PPIFIS", "PPI YoY")]:
        rows = fetch_fred(api_key, series, limit=40)   # 24 months YoY + 13 base months
        hist = yoy_history(rows)
        entry = yoy_entry(name, "%", rows, history=hist)
        inflation.append(entry)
        if entry["price"]:
            print(f"  OK  {name:18s}  {entry['price']}%  {entry['change']:+.2f}pp  [{len(hist['times'])} pts]")
        time.sleep(0.3)

    # ── Employment ────────────────────────────────────────────────────────────
    print("\n[2/5] Fetching employment data ...")
    employment = []

    # Unemployment Rate — change shown in pp (absolute), not relative %
    rows = fetch_fred(api_key, "UNRATE", limit=30)
    hist = mom_history(rows)
    if len(rows) >= 2:
        latest = float(rows[-1]["value"])
        prev = float(rows[-2]["value"])
        change = round(latest - prev, 2)
        entry = {"name": "Unemployment Rate", "unit": "%",
                 "price": round(latest, 2), "change": change, "change_pct": change,
                 "time": rows[-1]["date"][:7], "history": hist}
        employment.append(entry)
        print(f"  OK  Unemployment Rate    {latest}%  {change:+.2f}pp  [{len(hist['times'])} pts]")
    else:
        employment.append({"name": "Unemployment Rate", "unit": "%",
                            "price": 0, "change": 0, "change_pct": 0, "time": "",
                            "history": EMPTY_HIST})
    time.sleep(0.3)

    # Nonfarm Payrolls — show MoM change (thousands); history shows MoM changes
    rows = fetch_fred(api_key, "PAYEMS", limit=30)
    nfp_hist_vals = [round(float(rows[i]["value"]) - float(rows[i-1]["value"]), 1)
                     for i in range(1, len(rows)) if rows[i]["value"] not in (".", "")]
    nfp_hist_times = [rows[i]["date"][:7] for i in range(1, len(rows)) if rows[i]["value"] not in (".", "")]
    nfp_hist = {"times": nfp_hist_times, "values": nfp_hist_vals}
    if len(rows) >= 2:
        latest = float(rows[-1]["value"])
        prev = float(rows[-2]["value"])
        change = round(latest - prev, 1)
        entry = {"name": "Nonfarm Payrolls", "unit": "K",
                 "price": round(change, 1), "change": change, "change_pct": change,
                 "time": rows[-1]["date"][:7], "history": nfp_hist}
        employment.append(entry)
        print(f"  OK  Nonfarm Payrolls     {change:+.0f}K  [{len(nfp_hist['times'])} pts]")
    else:
        employment.append({"name": "Nonfarm Payrolls", "unit": "K",
                            "price": 0, "change": 0, "change_pct": 0, "time": "",
                            "history": EMPTY_HIST})
    time.sleep(0.3)

    # Initial Jobless Claims — ICSA is in number of claims, display as K
    rows = fetch_fred(api_key, "ICSA", limit=52)   # 52 weeks
    hist = mom_history(rows, scale=1000.0)
    if len(rows) >= 2:
        latest = float(rows[-1]["value"]) / 1000
        prev = float(rows[-2]["value"]) / 1000
        change = round(latest - prev, 1)
        change_pct = round((change / prev * 100) if prev else 0, 2)
        entry = {"name": "Initial Claims", "unit": "K",
                 "price": round(latest, 1), "change": change, "change_pct": change_pct,
                 "time": rows[-1]["date"][:7], "history": hist}
        employment.append(entry)
        print(f"  OK  Initial Claims       {round(latest, 1)}K  {change_pct:+.2f}%  [{len(hist['times'])} pts]")
    else:
        employment.append({"name": "Initial Claims", "unit": "K",
                            "price": 0, "change": 0, "change_pct": 0, "time": "",
                            "history": EMPTY_HIST})
    time.sleep(0.3)

    # Job Openings (JOLTS) — JTSJOL in thousands, display as M
    rows = fetch_fred(api_key, "JTSJOL", limit=30)
    hist = mom_history(rows, scale=1000.0)
    if len(rows) >= 2:
        latest = round(float(rows[-1]["value"]) / 1000, 2)
        prev = round(float(rows[-2]["value"]) / 1000, 2)
        change = round(latest - prev, 2)
        change_pct = round((change / prev * 100) if prev else 0, 2)
        entry = {"name": "Job Openings", "unit": "M",
                 "price": latest, "change": change, "change_pct": change_pct,
                 "time": rows[-1]["date"][:7], "history": hist}
        employment.append(entry)
        print(f"  OK  Job Openings         {latest}M  {change_pct:+.2f}%  [{len(hist['times'])} pts]")
    else:
        employment.append({"name": "Job Openings", "unit": "M",
                            "price": 0, "change": 0, "change_pct": 0, "time": "",
                            "history": EMPTY_HIST})
    time.sleep(0.3)

    # ── Rates ─────────────────────────────────────────────────────────────────
    print("\n[3/5] Fetching rate data ...")
    rates = []

    for series, name, unit in [
        ("FEDFUNDS",    "Fed Funds Rate", "%"),
        ("MORTGAGE30US","30Y Mortgage",   "%"),
    ]:
        rows = fetch_fred(api_key, series, limit=52)  # ~1 year for weekly/monthly
        hist = mom_history(rows)
        entry = mom_entry(name, unit, rows, history=hist)
        entry["change_pct"] = entry["change"]  # absolute pp for rate indicators
        rates.append(entry)
        if entry["price"]:
            print(f"  OK  {name:18s}  {entry['price']}%  {entry['change']:+.3f}pp  [{len(hist['times'])} pts]")
        time.sleep(0.3)

    # 10Y-2Y Spread — T10Y2Y daily, already in pp; use absolute pp change
    rows = fetch_fred(api_key, "T10Y2Y", limit=90)   # 90 trading days
    hist = {"times": [r["date"][:10] for r in rows if r["value"] not in (".", "")],
            "values": [round(float(r["value"]), 3) for r in rows if r["value"] not in (".", "")]}
    if len(rows) >= 2:
        latest = float(rows[-1]["value"])
        prev = float(rows[-2]["value"])
        change = round(latest - prev, 3)
        entry = {"name": "10Y-2Y Spread", "unit": "pp",
                 "price": round(latest, 3), "change": change, "change_pct": change,
                 "time": rows[-1]["date"][:10], "history": hist}
        rates.append(entry)
        print(f"  OK  10Y-2Y Spread        {latest}pp  {change:+.3f}pp  [{len(hist['times'])} pts]")
    else:
        rates.append({"name": "10Y-2Y Spread", "unit": "pp",
                       "price": 0, "change": 0, "change_pct": 0, "time": "",
                       "history": EMPTY_HIST})
    time.sleep(0.3)

    # ── Trade ─────────────────────────────────────────────────────────────────
    print("\n[4/5] Fetching trade data ...")
    trade = []

    # Trade Balance (Goods & Services) — BOPGSTB: millions USD, monthly
    rows = fetch_fred(api_key, "BOPGSTB", limit=30)
    hist = mom_history(rows, scale=1000.0)
    if len(rows) >= 2:
        latest = round(float(rows[-1]["value"]) / 1000, 2)
        prev   = round(float(rows[-2]["value"]) / 1000, 2)
        change = round(latest - prev, 2)
        change_pct = round((change / abs(prev) * 100) if prev else 0, 2)
        entry = {"name": "Trade Balance", "unit": "B$",
                 "price": latest, "change": change, "change_pct": change_pct,
                 "time": rows[-1]["date"][:7], "history": hist}
        trade.append(entry)
        print(f"  OK  Trade Balance        ${latest}B  [{len(hist['times'])} pts]")
    else:
        trade.append({"name": "Trade Balance", "unit": "B$",
                       "price": 0, "change": 0, "change_pct": 0, "time": "",
                       "history": EMPTY_HIST})
    time.sleep(0.3)

    # Exports of Goods & Services — EXPGS: quarterly, billions chained 2017$ (annualized)
    rows = fetch_fred(api_key, "EXPGS", limit=20)
    hist = mom_history(rows)
    entry = mom_entry("Exports (Ann.)", "B$", rows, history=hist)
    trade.append(entry)
    if entry["price"]:
        print(f"  OK  Exports (Ann.)       ${entry['price']}B  {entry['change_pct']:+.2f}%  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # Imports of Goods & Services — IMPGS: quarterly, billions chained 2017$ (annualized)
    rows = fetch_fred(api_key, "IMPGS", limit=20)
    hist = mom_history(rows)
    entry = mom_entry("Imports (Ann.)", "B$", rows, history=hist)
    trade.append(entry)
    if entry["price"]:
        print(f"  OK  Imports (Ann.)       ${entry['price']}B  {entry['change_pct']:+.2f}%  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # ── Growth & Sentiment ────────────────────────────────────────────────────
    print("\n[5/5] Fetching growth & sentiment data ...")
    sentiment = []

    # Real GDP Growth QoQ% (already a rate series — use absolute pp change)
    rows = fetch_fred(api_key, "A191RL1Q225SBEA", limit=20)  # ~5 years quarterly
    hist = mom_history(rows)
    entry = mom_entry("GDP Growth QoQ", "%", rows, history=hist)
    entry["change_pct"] = entry["change"]
    sentiment.append(entry)
    if entry["price"]:
        print(f"  OK  GDP Growth QoQ       {entry['price']}%  {entry['change']:+.2f}pp  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # Michigan Consumer Sentiment
    rows = fetch_fred(api_key, "UMCSENT", limit=30)
    hist = mom_history(rows)
    entry = mom_entry("Consumer Sentiment", "", rows, history=hist)
    sentiment.append(entry)
    if entry["price"]:
        print(f"  OK  Consumer Sentiment   {entry['price']}  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # Chicago Fed National Activity Index — CFNAI, >0 = above-average growth
    rows = fetch_fred(api_key, "CFNAI", limit=30)
    hist = mom_history(rows)
    entry = mom_entry("Chicago Fed NAI", "", rows, history=hist)
    entry["change_pct"] = entry["change"]  # absolute change
    sentiment.append(entry)
    if entry["price"]:
        print(f"  OK  Chicago Fed NAI      {entry['price']}  {entry['change']:+.2f}  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # Durable Goods Orders — DGORDER in millions USD, show MoM%
    rows = fetch_fred(api_key, "DGORDER", limit=30)
    dg_hist_vals = [round((float(rows[i]["value"]) - float(rows[i-1]["value"])) / float(rows[i-1]["value"]) * 100, 2)
                    for i in range(1, len(rows)) if rows[i]["value"] not in (".", "") and rows[i-1]["value"] not in (".", "")]
    dg_hist_times = [rows[i]["date"][:7] for i in range(1, len(rows)) if rows[i]["value"] not in (".", "")]
    dg_hist = {"times": dg_hist_times, "values": dg_hist_vals}
    if len(rows) >= 2:
        latest = float(rows[-1]["value"])
        prev   = float(rows[-2]["value"])
        change_pct = round((latest - prev) / prev * 100, 2) if prev else 0
        entry = {"name": "Durable Goods MoM", "unit": "%",
                 "price": change_pct, "change": change_pct, "change_pct": change_pct,
                 "time": rows[-1]["date"][:7], "history": dg_hist}
        sentiment.append(entry)
        print(f"  OK  Durable Goods MoM    {change_pct:+.2f}%  [{len(dg_hist['times'])} pts]")
    else:
        sentiment.append({"name": "Durable Goods MoM", "unit": "%",
                           "price": 0, "change": 0, "change_pct": 0, "time": "",
                           "history": EMPTY_HIST})
    time.sleep(0.3)

    # Retail Sales MoM — RSXFS in millions USD, show MoM%; history shows MoM% changes
    rows = fetch_fred(api_key, "RSXFS", limit=30)
    rs_hist_vals = [round((float(rows[i]["value"]) - float(rows[i-1]["value"])) / float(rows[i-1]["value"]) * 100, 2)
                    for i in range(1, len(rows)) if rows[i]["value"] not in (".", "") and rows[i-1]["value"] not in (".", "")]
    rs_hist_times = [rows[i]["date"][:7] for i in range(1, len(rows)) if rows[i]["value"] not in (".", "")]
    rs_hist = {"times": rs_hist_times, "values": rs_hist_vals}
    if len(rows) >= 2:
        latest = float(rows[-1]["value"])
        prev = float(rows[-2]["value"])
        change_pct = round((latest - prev) / prev * 100, 2) if prev else 0
        entry = {"name": "Retail Sales MoM", "unit": "%",
                 "price": change_pct, "change": change_pct, "change_pct": change_pct,
                 "time": rows[-1]["date"][:7], "history": rs_hist}
        sentiment.append(entry)
        print(f"  OK  Retail Sales MoM     {change_pct:+.2f}%  [{len(rs_hist['times'])} pts]")
    else:
        sentiment.append({"name": "Retail Sales MoM", "unit": "%",
                           "price": 0, "change": 0, "change_pct": 0, "time": "",
                           "history": EMPTY_HIST})
    time.sleep(0.3)

    # Housing Starts — HOUST in thousands of units (annualized)
    rows = fetch_fred(api_key, "HOUST", limit=30)
    hist = mom_history(rows)
    if len(rows) >= 2:
        latest = float(rows[-1]["value"])
        prev = float(rows[-2]["value"])
        change = round(latest - prev, 1)
        change_pct = round((change / prev * 100) if prev else 0, 2)
        entry = {"name": "Housing Starts", "unit": "K",
                 "price": round(latest, 1), "change": change, "change_pct": change_pct,
                 "time": rows[-1]["date"][:7], "history": hist}
        sentiment.append(entry)
        print(f"  OK  Housing Starts       {round(latest, 1)}K  {change_pct:+.2f}%  [{len(hist['times'])} pts]")
    else:
        sentiment.append({"name": "Housing Starts", "unit": "K",
                           "price": 0, "change": 0, "change_pct": 0, "time": "",
                           "history": EMPTY_HIST})

    # ── Fallback: replace failed (price=0) items with previous data ───────────
    inflation  = fallback_list(inflation,  prev.get("inflation",  []))
    employment = fallback_list(employment, prev.get("employment", []))
    rates      = fallback_list(rates,      prev.get("rates",      []))
    trade      = fallback_list(trade,      prev.get("trade",      []))
    sentiment  = fallback_list(sentiment,  prev.get("sentiment",  []))

    # ── Write output ──────────────────────────────────────────────────────────
    output = {
        "updated_at": updated_at,
        "inflation": inflation,
        "employment": employment,
        "rates": rates,
        "trade": trade,
        "sentiment": sentiment,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nDone — written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
