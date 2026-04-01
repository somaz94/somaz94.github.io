#!/usr/bin/env python3
"""
Fetch JP macroeconomic data from FRED (Federal Reserve Economic Data).
Writes results to _data/jp_data.json for Jekyll to render.

Dependencies: requests, feedparser
Usage: FRED_API_KEY=<key> python scripts/fetch_jp_data.py
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

OUTPUT_FILE = Path(__file__).parent.parent / "_data" / "jp_data.json"
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

ESTAT_BASE = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData"


def fetch_estat(estat_key: str, stats_data_id: str, params: dict, retries: int = 3, lang: str = "E") -> list:
    """Fetch observations from e-Stat API. Returns list of VALUE dicts sorted by time code asc."""
    p = {"appId": estat_key, "statsDataId": stats_data_id, "lang": lang, **params}
    for attempt in range(retries):
        try:
            resp = requests.get(ESTAT_BASE, params=p, timeout=15)
            resp.raise_for_status()
            vals = resp.json().get("GET_STATS_DATA", {}).get("STATISTICAL_DATA", {}).get("DATA_INF", {}).get("VALUE", [])
            if isinstance(vals, dict):
                vals = [vals]
            return sorted(vals, key=lambda v: v.get("@time", ""))
        except Exception as exc:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                print(f"  WARN: e-Stat {stats_data_id} — {exc}", file=sys.stderr)
    return []


def estat_time_to_ym(code: str, meta_map: dict) -> str:
    """Convert e-Stat time code to YYYY-MM string using meta name map."""
    name = meta_map.get(code, "")
    # name is like '202502' → '2025-02', or 'Feb. 2026' → '2026-02'
    if len(name) == 6 and name.isdigit():
        return f"{name[:4]}-{name[4:]}"
    return name


def fetch_estat_meta_time(estat_key: str, stats_data_id: str, lang: str = "E") -> dict:
    """Return {time_code: YYYY-MM} mapping from e-Stat meta."""
    url = "https://api.e-stat.go.jp/rest/3.0/app/json/getMetaInfo"
    try:
        resp = requests.get(url, params={"appId": estat_key, "statsDataId": stats_data_id, "lang": lang}, timeout=15)
        resp.raise_for_status()
        cls_objs = resp.json().get("GET_META_INFO", {}).get("METADATA_INF", {}).get("CLASS_INF", {}).get("CLASS_OBJ", [])
        if isinstance(cls_objs, dict):
            cls_objs = [cls_objs]
        for obj in cls_objs:
            if obj.get("@id") == "time":
                cls = obj.get("CLASS", [])
                if isinstance(cls, dict):
                    cls = [cls]
                result = {}
                for c in cls:
                    name = c.get("@name", "")
                    # e-Stat CPI: 'Feb. 2026' → 2026-02
                    if "." in name and len(name) > 6:
                        import re
                        m = re.match(r"(\w+)\.\s+(\d{4})", name)
                        if m:
                            months = {"Jan":1,"Feb":2,"Mar":3,"Apr":4,"May":5,"Jun":6,
                                      "Jul":7,"Aug":8,"Sep":9,"Oct":10,"Nov":11,"Dec":12}
                            mon = months.get(m.group(1), 0)
                            if mon:
                                result[c.get("@code", "")] = f"{m.group(2)}-{mon:02d}"
                    elif len(name) == 6 and name.isdigit():
                        result[c.get("@code", "")] = f"{name[:4]}-{name[4:]}"
                    # skip non-date entries (e.g. weights like 付加生産ウエイト)
                return result
    except Exception as exc:
        print(f"  WARN: e-Stat meta {stats_data_id} — {exc}", file=sys.stderr)
    return {}


def main() -> None:
    api_key = os.environ.get("FRED_API_KEY", "").strip()
    if not api_key:
        print("ERROR: FRED_API_KEY environment variable not set.", file=sys.stderr)
        sys.exit(1)

    estat_key = os.environ.get("ESTAT_API_KEY", "").strip()
    if not estat_key:
        print("WARN: ESTAT_API_KEY not set — CPI/Unemployment/Industrial Production will use FRED fallback.", file=sys.stderr)

    kst = timezone(timedelta(hours=9))
    now_kst = datetime.now(kst)
    updated_at = now_kst.strftime("%Y-%m-%d %H:%M KST")
    print(f"[fetch_jp_data] Starting — {updated_at}")

    prev = load_previous(OUTPUT_FILE)

    # ── Interest Rates ────────────────────────────────────────────────────────
    print("\n[1/6] Fetching interest rates ...")
    rates = []

    # BOJ Policy Rate — lookup table (updated manually when BOJ changes target)
    # BOJ holds 8 Monetary Policy Meetings per year. Check after each meeting.
    # 2026 schedule: Jan 22-23, Mar 18-19, Apr 27-28, Jun 15-16,
    #                Jul 30-31, Sep 17-18, Oct 29-30, Dec 17-18
    # Source: https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm
    BOJ_POLICY_RATES = [
        ("2016-02-01", -0.10),  # negative interest rate policy
        ("2024-03-19",  0.10),  # ended negative rates
        ("2024-07-31",  0.25),  # first hike
        ("2025-01-24",  0.50),  # second hike
        ("2025-12-19",  0.75),  # third hike — highest since 1995
    ]
    today_str = now_kst.strftime("%Y-%m-%d")
    boj_rate = 0.0
    boj_prev = 0.0
    boj_date = ""
    for i, (date, rate) in enumerate(BOJ_POLICY_RATES):
        if date <= today_str:
            boj_rate = rate
            boj_prev = BOJ_POLICY_RATES[i - 1][1] if i > 0 else 0.0
            boj_date = date[:7]
    boj_change = round(boj_rate - boj_prev, 3)
    boj_hist = {"times": [d[:7] for d, _ in BOJ_POLICY_RATES], "values": [r for _, r in BOJ_POLICY_RATES]}
    rates.append({"name": "Policy Rate (BOJ)", "unit": "%",
                  "price": boj_rate, "change": boj_change, "change_pct": boj_change,
                  "time": boj_date, "history": boj_hist})
    print(f"  OK  Policy Rate (BOJ)   {boj_rate}%  {boj_change:+.3f}pp  [lookup]")

    # Call Money Rate — use Call Money/Interbank Rate (IRSTCI01JPM156N, end=2026-02)
    # IRSTCB01JPM156N (OECD series) was discontinued in Dec 2023
    rows = fetch_fred(api_key, "IRSTCI01JPM156N", limit=15)
    hist = mom_history(rows)
    entry = mom_entry("Call Money Rate", "%", rows, history=hist)
    entry["change_pct"] = entry["change"]  # absolute pp for rate indicators
    rates.append(entry)
    if entry["price"]:
        print(f"  OK  Call Money Rate            {entry['price']}%  {entry['change']:+.3f}pp  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # JGB 10Y — monthly, absolute pp change
    rows = fetch_fred(api_key, "IRLTLT01JPM156N", limit=15)
    hist = mom_history(rows)
    entry = mom_entry("JGB 10Y", "%", rows, history=hist)
    entry["change_pct"] = entry["change"]  # absolute pp for rate indicators
    rates.append(entry)
    if entry["price"]:
        print(f"  OK  JGB 10Y             {entry['price']}%  {entry['change']:+.3f}pp  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # 3M Call Rate — IR3TIB01JPM156N (3-month interbank, end=2026-02), absolute pp change
    rows = fetch_fred(api_key, "IR3TIB01JPM156N", limit=15)
    hist = mom_history(rows)
    entry = mom_entry("3M Call Rate", "%", rows, history=hist)
    entry["change_pct"] = entry["change"]  # absolute pp for rate indicators
    rates.append(entry)
    if entry["price"]:
        print(f"  OK  3M Call Rate        {entry['price']}%  {entry['change']:+.3f}pp  [{len(hist['times'])} pts]")
    time.sleep(0.3)

    # ── Inflation (e-Stat: 2020-Base CPI, statsDataId=0003427113) ────────────
    print("\n[2/6] Fetching inflation data ...")
    prices = []
    cpi_time_map = fetch_estat_meta_time(estat_key, "0003427113") if estat_key else {}

    def estat_cpi_entry(name: str, cat01_code: str) -> dict:
        """Fetch CPI YoY from e-Stat (tab=3 = Change over the year) for a given item code."""
        base = {"name": name, "unit": "%", "price": 0, "change": 0, "change_pct": 0, "time": "", "history": EMPTY_HIST}
        if not estat_key:
            return base
        vals = fetch_estat(estat_key, "0003427113", {"cdTab": "3", "cdArea": "00000", "cdCat01": cat01_code, "cdTimeFrom": "2024000101"})
        if len(vals) < 2:
            return base
        def to_ym(v):
            return cpi_time_map.get(v.get("@time", ""), v.get("@time", ""))
        sorted_vals = sorted(vals, key=lambda v: to_ym(v))
        times  = [to_ym(v) for v in sorted_vals if v.get("$") not in ("", None)]
        values = [round(float(v["$"]), 2) for v in sorted_vals if v.get("$") not in ("", None)]
        if len(values) < 2:
            return base
        hist = {"times": times, "values": values}
        latest = values[-1]
        change = round(latest - values[-2], 2)
        return {"name": name, "unit": "%",
                "price": latest, "change": change, "change_pct": change,
                "time": times[-1], "history": hist}

    # CPI YoY — All items (cat01=0001)
    entry = estat_cpi_entry("CPI YoY", "0001")
    prices.append(entry)
    if entry["price"]:
        print(f"  OK  CPI YoY             {entry['price']}%  {entry['change']:+.2f}pp  [{len(entry['history']['times'])} pts]")
    time.sleep(0.3)

    # Core CPI YoY — All items less fresh food (cat01=0161)
    entry = estat_cpi_entry("Core CPI YoY", "0161")
    prices.append(entry)
    if entry["price"]:
        print(f"  OK  Core CPI YoY        {entry['price']}%  {entry['change']:+.2f}pp  [{len(entry['history']['times'])} pts]")
    time.sleep(0.3)

    # ── Employment & Macro ────────────────────────────────────────────────────
    print("\n[3/6] Fetching employment & macro data ...")
    macro = []

    # Unemployment Rate — e-Stat Labour Force Survey (0003005865), cat02=08 (Unemployed)
    unemp_entry = {"name": "Unemployment Rate", "unit": "%",
                   "price": 0, "change": 0, "change_pct": 0, "time": "", "history": EMPTY_HIST}
    if estat_key:
        unemp_time_map = fetch_estat_meta_time(estat_key, "0003005865")
        unemp_vals = fetch_estat(estat_key, "0003005865",
                                 {"cdTab": "02", "cdCat01": "000", "cdCat02": "08", "cdCat03": "0", "cdArea": "00000", "cdTimeFrom": "2024000101"})
        def unemp_ym(v):
            return unemp_time_map.get(v.get("@time", ""), v.get("@time", ""))
        def _is_valid(v):
            s = v.get("$", "")
            try:
                float(s)
                return True
            except (TypeError, ValueError):
                return False
        unemp_sorted = sorted([v for v in unemp_vals if _is_valid(v)], key=unemp_ym)
        if len(unemp_sorted) >= 2:
            u_times  = [unemp_ym(v) for v in unemp_sorted]
            u_values = [round(float(v["$"]), 2) for v in unemp_sorted]
            latest = u_values[-1]
            change = round(latest - u_values[-2], 2)
            unemp_entry = {"name": "Unemployment Rate", "unit": "%",
                           "price": latest, "change": change, "change_pct": change,
                           "time": u_times[-1],
                           "history": {"times": u_times, "values": u_values}}
            print(f"  OK  Unemployment Rate   {latest}%  {change:+.2f}pp  [{len(u_times)} pts]")
    else:
        rows = fetch_fred(api_key, "LRUNTTTTJPM156S", limit=30)
        hist = mom_history(rows)
        if len(rows) >= 2:
            latest = float(rows[-1]["value"])
            prev_v = float(rows[-2]["value"])
            change = round(latest - prev_v, 2)
            unemp_entry = {"name": "Unemployment Rate", "unit": "%",
                           "price": round(latest, 2), "change": change, "change_pct": change,
                           "time": rows[-1]["date"][:7], "history": hist}
            print(f"  OK  Unemployment Rate   {latest}%  {change:+.2f}pp (FRED)  [{len(hist['times'])} pts]")
    macro.append(unemp_entry)
    time.sleep(0.3)

    # Employed — FRED values in persons (ones) → scale /1_000_000 for M
    rows = fetch_fred(api_key, "LFEMTTTTJPM647N", limit=30)
    hist = mom_history(rows, scale=1_000_000.0)
    if len(rows) >= 2:
        latest = round(float(rows[-1]["value"]) / 1_000_000.0, 2)
        prev_v = round(float(rows[-2]["value"]) / 1_000_000.0, 2)
        change = round(latest - prev_v, 4)
        change_pct = round((change / prev_v * 100) if prev_v else 0, 2)
        entry = {"name": "Employed", "unit": "M",
                 "price": latest, "change": change, "change_pct": change_pct,
                 "time": rows[-1]["date"][:7], "history": hist}
        macro.append(entry)
        print(f"  OK  Employed            {latest}M  {change_pct:+.2f}%  [{len(hist['times'])} pts]")
    else:
        macro.append({"name": "Employed", "unit": "M",
                      "price": 0, "change": 0, "change_pct": 0, "time": "",
                      "history": EMPTY_HIST})
    time.sleep(0.3)

    # FX Reserves — TRESEGJPM052N (monthly, million USD) → B$
    rows = fetch_fred(api_key, "TRESEGJPM052N", limit=30)
    hist = mom_history(rows, scale=1_000.0)
    if len(rows) >= 2:
        latest = round(float(rows[-1]["value"]) / 1_000.0, 1)
        prev_v = round(float(rows[-2]["value"]) / 1_000.0, 1)
        change = round(latest - prev_v, 2)
        change_pct = round((change / prev_v * 100) if prev_v else 0, 2)
        entry = {"name": "FX Reserves", "unit": "B$",
                 "price": latest, "change": change, "change_pct": change_pct,
                 "time": rows[-1]["date"][:7], "history": hist}
        macro.append(entry)
        print(f"  OK  FX Reserves         ${latest}B  {change_pct:+.2f}%  [{len(hist['times'])} pts]")
    else:
        macro.append({"name": "FX Reserves", "unit": "B$",
                      "price": 0, "change": 0, "change_pct": 0, "time": "",
                      "history": EMPTY_HIST})
    time.sleep(0.3)

    # ── Trade ─────────────────────────────────────────────────────────────────
    print("\n[4/6] Fetching trade data ...")
    trade = []

    # Exports — FRED values in USD (ones) → scale /1_000_000_000 for B$, MoM% change
    exp_rows = fetch_fred(api_key, "XTEXVA01JPM667S", limit=30)
    hist = mom_history(exp_rows, scale=1_000_000_000.0)
    exports_entry = {"name": "Exports", "unit": "B$",
                     "price": 0, "change": 0, "change_pct": 0, "time": "",
                     "history": EMPTY_HIST}
    if len(exp_rows) >= 2:
        latest = round(float(exp_rows[-1]["value"]) / 1_000_000_000.0, 2)
        prev_v = round(float(exp_rows[-2]["value"]) / 1_000_000_000.0, 2)
        change = round(latest - prev_v, 4)
        change_pct = round((change / prev_v * 100) if prev_v else 0, 2)
        exports_entry = {"name": "Exports", "unit": "B$",
                         "price": latest, "change": change, "change_pct": change_pct,
                         "time": exp_rows[-1]["date"][:7], "history": hist}
        print(f"  OK  Exports             ${latest}B  {change_pct:+.2f}%  [{len(hist['times'])} pts]")
    trade.append(exports_entry)
    time.sleep(0.3)

    # Imports — FRED values in USD (ones) → scale /1_000_000_000 for B$, MoM% change
    imp_rows = fetch_fred(api_key, "XTIMVA01JPM667S", limit=30)
    hist = mom_history(imp_rows, scale=1_000_000_000.0)
    imports_entry = {"name": "Imports", "unit": "B$",
                     "price": 0, "change": 0, "change_pct": 0, "time": "",
                     "history": EMPTY_HIST}
    if len(imp_rows) >= 2:
        latest = round(float(imp_rows[-1]["value"]) / 1_000_000_000.0, 2)
        prev_v = round(float(imp_rows[-2]["value"]) / 1_000_000_000.0, 2)
        change = round(latest - prev_v, 4)
        change_pct = round((change / prev_v * 100) if prev_v else 0, 2)
        imports_entry = {"name": "Imports", "unit": "B$",
                         "price": latest, "change": change, "change_pct": change_pct,
                         "time": imp_rows[-1]["date"][:7], "history": hist}
        print(f"  OK  Imports             ${latest}B  {change_pct:+.2f}%  [{len(hist['times'])} pts]")
    trade.append(imports_entry)
    time.sleep(0.3)

    # Trade Balance = Exports - Imports (computed, with monthly history)
    if exports_entry["price"] and imports_entry["price"]:
        balance = round(exports_entry["price"] - imports_entry["price"], 2)
        exp_by_month = {r["date"][:7]: float(r["value"]) for r in exp_rows if r.get("value", "") not in (".", "")}
        imp_by_month = {r["date"][:7]: float(r["value"]) for r in imp_rows if r.get("value", "") not in (".", "")}
        common = sorted(set(exp_by_month) & set(imp_by_month))
        bal_hist = {
            "times":  [m for m in common],
            "values": [round((exp_by_month[m] - imp_by_month[m]) / 1_000_000_000.0, 4) for m in common],
        }
        trade_balance = {"name": "Trade Balance", "unit": "B$",
                         "price": balance, "prev": 0, "change": 0, "change_pct": 0,
                         "time": exports_entry["time"], "history": bal_hist}
        trade.append(trade_balance)
        print(f"  OK  Trade Balance       {'+'if balance >= 0 else ''}${balance}B  [{len(bal_hist['times'])} pts]")

    # ── Growth & Sentiment ────────────────────────────────────────────────────
    print("\n[5/6] Fetching growth & sentiment data ...")
    growth = []

    # GDP Growth QoQ — quarterly real GDP index → compute QoQ%
    rows = fetch_fred(api_key, "JPNRGDPEXP", limit=20)
    qoq_times, qoq_vals = [], []
    for i in range(1, len(rows)):
        if rows[i]["value"] not in (".", "") and rows[i-1]["value"] not in (".", ""):
            curr = float(rows[i]["value"])
            prev_v = float(rows[i-1]["value"])
            if prev_v:
                qoq_times.append(rows[i]["date"][:7])
                qoq_vals.append(round((curr / prev_v - 1) * 100, 2))
    gdp_hist = {"times": qoq_times, "values": qoq_vals}
    if len(qoq_vals) >= 2:
        latest_gdp = qoq_vals[-1]
        prev_gdp = qoq_vals[-2]
        gdp_change = round(latest_gdp - prev_gdp, 2)
        gdp_entry = {"name": "GDP Growth QoQ", "unit": "%",
                     "price": latest_gdp, "change": gdp_change, "change_pct": gdp_change,
                     "time": qoq_times[-1], "history": gdp_hist}
        print(f"  OK  GDP Growth QoQ      {latest_gdp}%  {gdp_change:+.2f}pp  [{len(qoq_times)} pts]")
    else:
        gdp_entry = {"name": "GDP Growth QoQ", "unit": "%",
                     "price": 0, "change": 0, "change_pct": 0, "time": "", "history": EMPTY_HIST}
    growth = [gdp_entry]
    time.sleep(0.3)

    # Industrial Production MoM% — e-Stat 2020-base seasonally adjusted (0004015800)
    # cat01=0001000 (전 광공업), time codes mapped via meta
    ip_entry = {"name": "Industrial Production", "unit": "%",
                "price": 0, "change": 0, "change_pct": 0, "time": "", "history": EMPTY_HIST}
    if estat_key:
        ip_time_map = fetch_estat_meta_time(estat_key, "0004015800", lang="J")
        ip_vals = fetch_estat(estat_key, "0004015800", {"cdCat01": "0001000"}, lang="J")
        def ip_ym(v):
            return ip_time_map.get(v.get("@time", ""), "")
        def _valid_float(v):
            try:
                float(v.get("$", ""))
                return True
            except (TypeError, ValueError):
                return False
        ip_sorted = sorted([v for v in ip_vals if _valid_float(v) and ip_ym(v)], key=ip_ym)
        if len(ip_sorted) >= 2:
            ip_times  = [ip_ym(v) for v in ip_sorted]
            ip_index  = [round(float(v["$"]), 2) for v in ip_sorted]
            # compute MoM% from index values for history
            ip_mom_times  = ip_times[1:]
            ip_mom_values = [round((ip_index[i] - ip_index[i-1]) / ip_index[i-1] * 100, 2) for i in range(1, len(ip_index))]
            latest_mom = ip_mom_values[-1]
            ip_entry = {"name": "Industrial Production", "unit": "%",
                        "price": latest_mom, "change": latest_mom, "change_pct": latest_mom,
                        "time": ip_mom_times[-1],
                        "history": {"times": ip_mom_times, "values": ip_mom_values}}
            print(f"  OK  Industrial Prod.    {latest_mom:+.2f}% MoM  [{len(ip_mom_times)} pts]")
    else:
        rows = fetch_fred(api_key, "JPNPROINDMISMEI", limit=30)
        if len(rows) >= 2:
            latest = float(rows[-1]["value"])
            prev_v = float(rows[-2]["value"])
            change_pct = round((latest - prev_v) / prev_v * 100, 2) if prev_v else 0
            ip_entry = {"name": "Industrial Production", "unit": "%",
                        "price": change_pct, "change": change_pct, "change_pct": change_pct,
                        "time": rows[-1]["date"][:7], "history": EMPTY_HIST}
            print(f"  OK  Industrial Prod.    {change_pct:+.2f}% MoM (FRED)  [{len(rows)} pts]")
    growth.append(ip_entry)
    time.sleep(0.3)

    # Consumer Confidence — e-Stat Leading Indicator L6 (0003446462, cat01=1060)
    cc_entry = {"name": "Consumer Confidence", "unit": "",
                "price": 0, "change": 0, "change_pct": 0, "time": "", "history": EMPTY_HIST}
    if estat_key:
        cc_time_map = fetch_estat_meta_time(estat_key, "0003446462")
        cc_vals = fetch_estat(estat_key, "0003446462", {"cdCat01": "1060", "cdTimeFrom": "2024000101"})
        def cc_ym(v):
            return cc_time_map.get(v.get("@time", ""), "")
        def _valid_cc(v):
            try:
                float(v.get("$", ""))
                return True
            except (TypeError, ValueError):
                return False
        cc_sorted = sorted([v for v in cc_vals if _valid_cc(v) and cc_ym(v)], key=cc_ym)
        if len(cc_sorted) >= 2:
            cc_times  = [cc_ym(v) for v in cc_sorted]
            cc_values = [round(float(v["$"]), 2) for v in cc_sorted]
            latest = cc_values[-1]
            change = round(latest - cc_values[-2], 2)
            cc_entry = {"name": "Consumer Confidence", "unit": "",
                        "price": latest, "change": change, "change_pct": change,
                        "time": cc_times[-1],
                        "history": {"times": cc_times, "values": cc_values}}
            print(f"  OK  Consumer Confidence {latest}  {change:+.2f}  [{len(cc_times)} pts]")
    else:
        rows = fetch_fred(api_key, "CSCICP03JPM665S", limit=30)
        hist = mom_history(rows)
        cc_entry = mom_entry("Consumer Confidence", "", rows, history=hist)
        cc_entry["change_pct"] = cc_entry["change"]
        if cc_entry["price"]:
            print(f"  OK  Consumer Confidence {cc_entry['price']}  {cc_entry['change']:+.2f} (FRED)  [{len(hist['times'])} pts]")
    growth.append(cc_entry)

    # ── News ─────────────────────────────────────────────────────────────────
    print("\n[6/6] Fetching JP news ...")
    jp_feeds = [
        {"url": "https://www3.nhk.or.jp/rss/news/cat6.xml",        "source": "NHK"},
    ]
    news_items = []
    for feed_cfg in jp_feeds:
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

    # ── Fallback: replace failed (price=0) items with previous data ───────────
    rates  = fallback_list(rates,  prev.get("rates",  []))
    prices = fallback_list(prices, prev.get("prices", []))
    macro  = fallback_list(macro,  prev.get("macro",  []))
    trade  = fallback_list(trade,  prev.get("trade",  []))
    growth = fallback_list(growth, prev.get("growth", []))

    # ── Write output ──────────────────────────────────────────────────────────
    output = {
        "updated_at": updated_at,
        "rates": rates,
        "prices": prices,
        "macro": macro,
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
