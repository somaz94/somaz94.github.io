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


def mom_entry(name: str, unit: str, rows: list) -> dict:
    """Build entry from latest two observations (MoM change)."""
    base = {"name": name, "unit": unit,
            "price": 0, "change": 0, "change_pct": 0, "time": ""}
    if len(rows) < 2:
        return base
    latest = float(rows[-1]["value"])
    prev = float(rows[-2]["value"])
    change = round(latest - prev, 4)
    change_pct = round((change / prev * 100) if prev else 0, 2)
    price = round(latest, 2) if latest >= 10 else round(latest, 3)
    return {"name": name, "unit": unit,
            "price": price, "change": change, "change_pct": change_pct,
            "time": rows[-1]["date"][:7]}


def yoy_entry(name: str, unit: str, rows: list) -> dict:
    """Build entry showing YoY% as the main value (for CPI etc.)."""
    base = {"name": name, "unit": unit,
            "price": 0, "change": 0, "change_pct": 0, "time": ""}
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
            "time": rows[-1]["date"][:7]}


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    api_key = os.environ.get("FRED_API_KEY", "")
    if not api_key:
        print("ERROR: FRED_API_KEY environment variable not set.", file=sys.stderr)
        sys.exit(1)

    kst = timezone(timedelta(hours=9))
    now_kst = datetime.now(kst)
    updated_at = now_kst.strftime("%Y-%m-%d %H:%M KST")
    print(f"[fetch_us_data] Starting — {updated_at}")

    # ── Inflation ─────────────────────────────────────────────────────────────
    print("\n[1/4] Fetching inflation data ...")
    inflation = []

    for series, name in [("CPIAUCSL", "CPI YoY"), ("CPILFESL", "Core CPI YoY"),
                          ("PCEPI", "PCE YoY"), ("PCEPILFE", "Core PCE YoY"),
                          ("PPIFIS", "PPI YoY")]:
        rows = fetch_fred(api_key, series, limit=15)
        entry = yoy_entry(name, "%", rows)
        inflation.append(entry)
        if entry["price"]:
            print(f"  OK  {name:18s}  {entry['price']}%  {entry['change']:+.2f}pp")
        time.sleep(0.3)

    # ── Employment ────────────────────────────────────────────────────────────
    print("\n[2/4] Fetching employment data ...")
    employment = []

    # Unemployment Rate — change shown in pp (absolute), not relative %
    rows = fetch_fred(api_key, "UNRATE", limit=3)
    if len(rows) >= 2:
        latest = float(rows[-1]["value"])
        prev = float(rows[-2]["value"])
        change = round(latest - prev, 2)
        entry = {"name": "Unemployment Rate", "unit": "%",
                 "price": round(latest, 2), "change": change, "change_pct": change,
                 "time": rows[-1]["date"][:7]}
        employment.append(entry)
        print(f"  OK  Unemployment Rate    {latest}%  {change:+.2f}pp")
    else:
        employment.append({"name": "Unemployment Rate", "unit": "%",
                            "price": 0, "change": 0, "change_pct": 0, "time": ""})
    time.sleep(0.3)

    # Nonfarm Payrolls — show MoM change (thousands)
    rows = fetch_fred(api_key, "PAYEMS", limit=3)
    if len(rows) >= 2:
        latest = float(rows[-1]["value"])
        prev = float(rows[-2]["value"])
        change = round(latest - prev, 1)
        entry = {"name": "Nonfarm Payrolls", "unit": "K",
                 "price": round(change, 1), "change": change, "change_pct": change,
                 "time": rows[-1]["date"][:7]}
        employment.append(entry)
        print(f"  OK  Nonfarm Payrolls     {change:+.0f}K")
    else:
        employment.append({"name": "Nonfarm Payrolls", "unit": "K",
                            "price": 0, "change": 0, "change_pct": 0, "time": ""})
    time.sleep(0.3)

    # Initial Jobless Claims — ICSA is in number of claims, display as K
    rows = fetch_fred(api_key, "ICSA", limit=3)
    if len(rows) >= 2:
        latest = float(rows[-1]["value"]) / 1000
        prev = float(rows[-2]["value"]) / 1000
        change = round(latest - prev, 1)
        change_pct = round((change / prev * 100) if prev else 0, 2)
        entry = {"name": "Initial Claims", "unit": "K",
                 "price": round(latest, 1), "change": change, "change_pct": change_pct,
                 "time": rows[-1]["date"][:7]}
        employment.append(entry)
        print(f"  OK  Initial Claims       {round(latest, 1)}K  {change_pct:+.2f}%")
    else:
        employment.append({"name": "Initial Claims", "unit": "K",
                            "price": 0, "change": 0, "change_pct": 0, "time": ""})
    time.sleep(0.3)

    # ── Rates ─────────────────────────────────────────────────────────────────
    print("\n[3/4] Fetching rate data ...")
    rates = []

    for series, name, unit in [
        ("FEDFUNDS",    "Fed Funds Rate", "%"),
        ("MORTGAGE30US","30Y Mortgage",   "%"),
    ]:
        rows = fetch_fred(api_key, series, limit=3)
        entry = mom_entry(name, unit, rows)
        rates.append(entry)
        if entry["price"]:
            print(f"  OK  {name:18s}  {entry['price']}%  {entry['change_pct']:+.3f}%")
        time.sleep(0.3)

    # ── Growth & Sentiment ────────────────────────────────────────────────────
    print("\n[4/4] Fetching growth & sentiment data ...")
    sentiment = []

    # Real GDP Growth QoQ% (already a rate series — use absolute pp change)
    rows = fetch_fred(api_key, "A191RL1Q225SBEA", limit=3)
    entry = mom_entry("GDP Growth QoQ", "%", rows)
    entry["change_pct"] = entry["change"]
    sentiment.append(entry)
    if entry["price"]:
        print(f"  OK  GDP Growth QoQ       {entry['price']}%  {entry['change']:+.2f}pp")
    time.sleep(0.3)

    # Michigan Consumer Sentiment
    rows = fetch_fred(api_key, "UMCSENT", limit=3)
    entry = mom_entry("Consumer Sentiment", "", rows)
    sentiment.append(entry)
    if entry["price"]:
        print(f"  OK  Consumer Sentiment   {entry['price']}")
    time.sleep(0.3)

    # Retail Sales MoM — RSXFS in millions USD, show MoM%
    rows = fetch_fred(api_key, "RSXFS", limit=3)
    if len(rows) >= 2:
        latest = float(rows[-1]["value"])
        prev = float(rows[-2]["value"])
        change_pct = round((latest - prev) / prev * 100, 2) if prev else 0
        entry = {"name": "Retail Sales MoM", "unit": "%",
                 "price": change_pct, "change": change_pct, "change_pct": change_pct,
                 "time": rows[-1]["date"][:7]}
        sentiment.append(entry)
        print(f"  OK  Retail Sales MoM     {change_pct:+.2f}%")
    else:
        sentiment.append({"name": "Retail Sales MoM", "unit": "%",
                           "price": 0, "change": 0, "change_pct": 0, "time": ""})
    time.sleep(0.3)

    # Housing Starts — HOUST in thousands of units (annualized)
    rows = fetch_fred(api_key, "HOUST", limit=3)
    if len(rows) >= 2:
        latest = float(rows[-1]["value"])
        prev = float(rows[-2]["value"])
        change = round(latest - prev, 1)
        change_pct = round((change / prev * 100) if prev else 0, 2)
        entry = {"name": "Housing Starts", "unit": "K",
                 "price": round(latest, 1), "change": change, "change_pct": change_pct,
                 "time": rows[-1]["date"][:7]}
        sentiment.append(entry)
        print(f"  OK  Housing Starts       {round(latest, 1)}K  {change_pct:+.2f}%")
    else:
        sentiment.append({"name": "Housing Starts", "unit": "K",
                           "price": 0, "change": 0, "change_pct": 0, "time": ""})

    # ── Write output ──────────────────────────────────────────────────────────
    output = {
        "updated_at": updated_at,
        "inflation": inflation,
        "employment": employment,
        "rates": rates,
        "sentiment": sentiment,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nDone — written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
