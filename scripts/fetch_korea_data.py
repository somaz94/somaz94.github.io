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


def fetch_ecos(api_key: str, stat_code: str, period: str,
               start: str, end: str, item_code: str = "") -> list:
    url = (f"{ECOS_BASE}/{api_key}/json/kr/1/100"
           f"/{stat_code}/{period}/{start}/{end}/{item_code}")
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        rows = data.get("StatisticSearch", {}).get("row", [])
        return sorted(rows, key=lambda r: r.get("TIME", ""))
    except Exception as exc:
        print(f"  WARN: {stat_code}/{item_code} — {exc}", file=sys.stderr)
        return []


def latest_two(rows: list) -> tuple:
    """Return (latest_val, prev_val, time_label) from sorted rows."""
    valid = [r for r in rows if r.get("DATA_VALUE", "").strip()]
    if not valid:
        return None, None, ""
    latest_val = float(valid[-1]["DATA_VALUE"])
    prev_val = float(valid[-2]["DATA_VALUE"]) if len(valid) >= 2 else latest_val
    return latest_val, prev_val, valid[-1].get("TIME", "")


def build_entry(name: str, unit: str, latest, prev, time_label: str,
                scale: float = 1.0) -> dict:
    if latest is None:
        return {"name": name, "unit": unit,
                "price": 0, "prev": 0, "change": 0, "change_pct": 0, "time": ""}
    latest = latest / scale
    prev = prev / scale
    change = round(latest - prev, 4)
    change_pct = round((change / prev * 100) if prev else 0, 2)
    price = round(latest, 2) if latest >= 10 else round(latest, 3)
    return {"name": name, "unit": unit,
            "price": price, "prev": round(prev, 3),
            "change": change, "change_pct": change_pct, "time": time_label}


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    api_key = os.environ.get("ECOS_API_KEY", "")
    if not api_key:
        print("ERROR: ECOS_API_KEY environment variable not set.", file=sys.stderr)
        sys.exit(1)

    kst = timezone(timedelta(hours=9))
    now_kst = datetime.now(kst)
    updated_at = now_kst.strftime("%Y-%m-%d %H:%M KST")
    print(f"[fetch_korea_data] Starting — {updated_at}")

    d_start, d_end = daily_range(15)
    m_start, m_end = monthly_range(15)

    # ── Interest Rates ────────────────────────────────────────────────────────
    print("\n[1/5] Fetching interest rates ...")
    rates = []

    specs = [
        ("722Y001", "D", d_start, d_end, "0101000",   "기준금리",   "%",  1.0),
        ("817Y002", "D", d_start, d_end, "010200000",  "국고채 3년", "%",  1.0),
        ("817Y002", "D", d_start, d_end, "010210000",  "국고채 10년", "%", 1.0),
    ]
    for stat, period, s, e, item, name, unit, scale in specs:
        rows = fetch_ecos(api_key, stat, period, s, e, item)
        v, p, t = latest_two(rows)
        entry = build_entry(name, unit, v, p, t, scale)
        rates.append(entry)
        if v is not None:
            print(f"  OK  {name:12s}  {entry['price']}%  {entry['change_pct']:+.3f}%")
        time.sleep(0.3)

    # ── Prices ────────────────────────────────────────────────────────────────
    print("\n[2/5] Fetching price data ...")
    prices = []

    price_specs = [
        ("901Y009", "M", m_start, m_end, "0",  "소비자물가 (CPI)", "", 1.0),
        ("901Y010", "M", m_start, m_end, "QB", "근원물가",         "", 1.0),
    ]
    for stat, period, s, e, item, name, unit, scale in price_specs:
        rows = fetch_ecos(api_key, stat, period, s, e, item)
        v, p, t = latest_two(rows)
        entry = build_entry(name, unit, v, p, t, scale)
        prices.append(entry)
        if v is not None:
            print(f"  OK  {name:20s}  {entry['price']}  {entry['change_pct']:+.3f}%")
        time.sleep(0.3)

    # ── Macro (Employment) ────────────────────────────────────────────────────
    print("\n[3/5] Fetching macro indicators ...")
    macro = []

    macro_specs = [
        ("901Y027", "M", m_start, m_end, "I61BC", "실업률", "%", 1.0),
    ]
    for stat, period, s, e, item, name, unit, scale in macro_specs:
        rows = fetch_ecos(api_key, stat, period, s, e, item)
        v, p, t = latest_two(rows)
        entry = build_entry(name, unit, v, p, t, scale)
        # Rate indicators: use absolute pp change, not relative %
        entry["change_pct"] = entry["change"]
        macro.append(entry)
        if v is not None:
            print(f"  OK  {name:12s}  {entry['price']}%  {entry['change']:+.2f}pp")
        time.sleep(0.3)

    # ── Exchange Rates ────────────────────────────────────────────────────────
    print("\n[4/5] Fetching exchange rates ...")
    fx = []

    fx_specs = [
        ("731Y001", "D", d_start, d_end, "0000001", "USD/KRW",    "원",      1.0),
        ("731Y001", "D", d_start, d_end, "0000002", "JPY/KRW",    "원/100¥", 1.0),
        ("731Y001", "D", d_start, d_end, "0000003", "EUR/KRW",    "원",      1.0),
    ]
    for stat, period, s, e, item, name, unit, scale in fx_specs:
        rows = fetch_ecos(api_key, stat, period, s, e, item)
        v, p, t = latest_two(rows)
        entry = build_entry(name, unit, v, p, t, scale)
        fx.append(entry)
        if v is not None:
            print(f"  OK  {name:12s}  {entry['price']:,.2f}  {entry['change_pct']:+.3f}%")
        time.sleep(0.3)

    # ── Trade ────────────────────────────────────────────────────────────────
    print("\n[5/5] Fetching trade data ...")
    trade = []

    # 901Y118 values are in thousands of USD; divide by 1,000,000 → billions
    trade_specs = [
        ("901Y118", "M", m_start, m_end, "T002", "수출", "B$", 1_000_000.0),
        ("901Y118", "M", m_start, m_end, "T004", "수입", "B$", 1_000_000.0),
    ]
    exports_v, imports_v, trade_time = None, None, ""
    for stat, period, s, e, item, name, unit, scale in trade_specs:
        rows = fetch_ecos(api_key, stat, period, s, e, item)
        v, p, t = latest_two(rows)
        entry = build_entry(name, unit, v, p, t, scale)
        trade.append(entry)
        if v is not None:
            print(f"  OK  {name:8s}  ${entry['price']:.2f}B  {entry['change_pct']:+.2f}%")
            if name == "수출":
                exports_v, trade_time = entry["price"], t
            elif name == "수입":
                imports_v = entry["price"]
        time.sleep(0.3)

    # Trade balance (무역수지) = exports - imports
    if exports_v is not None and imports_v is not None:
        balance = round(exports_v - imports_v, 2)
        sign = "+" if balance >= 0 else ""
        trade.append({
            "name": "무역수지", "unit": "B$",
            "price": balance, "prev": 0, "change": 0, "change_pct": 0,
            "time": trade_time,
        })
        print(f"  OK  무역수지    {sign}${balance:.2f}B")

    # ── Write output ──────────────────────────────────────────────────────────
    output = {
        "updated_at": updated_at,
        "rates": rates,
        "prices": prices,
        "macro": macro,
        "fx": fx,
        "trade": trade,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nDone — written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
