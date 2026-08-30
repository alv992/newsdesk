# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx"]
# ///
"""Newsdesk markets.

Reads markets.toml, pulls price history for each symbol, computes the
percentage change over nine windows, and writes markets.js.

Two requests per symbol:
  range=1y  interval=1d   daily,   for DoD through 1y
  range=max interval=1mo  monthly, for 2y, 5y and all

Yahoo's chart API is keyless but unofficial — see D17. The adapter is one
function so swapping to a keyed provider later touches nothing else.

Run with:  uv run markets.py
"""

import json
import os
import sys
import time
import tomllib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import httpx

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "markets.js")
API = "https://query1.finance.yahoo.com/v8/finance/chart/"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) newsdesk/0.1"}
TIMEOUT = 25
WORKERS = 4          # gentle: this is an undocumented endpoint
SPARK_POINTS = 60

# label -> (series, how many points back)   d = daily, m = monthly
WINDOWS = [
    ("DoD", "d", 1),
    ("1W",  "d", 5),
    ("1M",  "d", 21),
    ("3M",  "d", 63),
    ("6M",  "d", 126),
    ("1Y",  "d", 251),
    ("2Y",  "m", 24),
    ("5Y",  "m", 60),
    ("All", "m", None),      # None = since the first point on record
]


def log(msg):
    print(msg, file=sys.stderr)


def series(symbol, rng, interval):
    """One Yahoo chart request -> [(timestamp, close)], nulls dropped."""
    r = httpx.get(f"{API}{symbol.replace('^', '%5E')}?range={rng}&interval={interval}",
                  timeout=TIMEOUT, headers=UA, follow_redirects=True)
    r.raise_for_status()
    res = r.json()["chart"]["result"]
    if not res:
        raise ValueError("empty result")
    node = res[0]
    stamps = node.get("timestamp") or []
    closes = node["indicators"]["quote"][0].get("close") or []
    pairs = [(t, c) for t, c in zip(stamps, closes) if c is not None]
    if not pairs:
        raise ValueError("no closes")
    return pairs, node["meta"]


def pct(now, then):
    return round((now - then) / then * 100, 2) if then else None


def fetch_one(job):
    """Never raises. One bad symbol must not lose the rest."""
    sym, name, market, kind = job
    try:
        daily, meta = series(sym, "1y", "1d")
        monthly, _ = series(sym, "max", "1mo")
        time.sleep(0.15)

        last = daily[-1][1]
        changes = {}
        for label, which, back in WINDOWS:
            data = daily if which == "d" else monthly
            if back is None:
                ref = data[0][1]
            elif len(data) > back:
                ref = data[-1 - back][1]
            else:
                continue                      # not enough history for this window
            changes[label] = pct(last, ref)

        spark = [round(c, 4) for _, c in monthly[-SPARK_POINTS:]]
        return {
            "symbol": sym,
            "name": name,
            "market": market,
            "kind": kind,                     # index | stock
            "currency": meta.get("currency", ""),
            "price": round(last, 4),
            "changes": changes,
            "spark": spark,
            "since": datetime.fromtimestamp(monthly[0][0], timezone.utc).strftime("%Y"),
        }, None
    except Exception as e:
        code = getattr(getattr(e, "response", None), "status_code", "")
        return None, (sym, f"{type(e).__name__} {code}".strip())


def write(rows, failed, markets):
    payload = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "failed": failed,
        "windows": [w[0] for w in WINDOWS],
        "markets": markets,
        "rows": rows,
    }
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("window.MARKETS = ")
        json.dump(payload, f, ensure_ascii=False)
        f.write(";\n")
    os.replace(tmp, OUT)


def main():
    with open(os.path.join(HERE, "markets.toml"), "rb") as f:
        cfg = tomllib.load(f)

    jobs, markets = [], {}
    for m in cfg["market"]:
        markets[m["id"]] = m["label"]
        for sym, name in m.get("index", {}).items():
            jobs.append((sym, name, m["id"], "index"))
        for sym, name in m.get("stocks", {}).items():
            jobs.append((sym, name, m["id"], "stock"))

    log(f"{len(jobs)} symbols across {len(markets)} markets\n")
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(fetch_one, jobs))

    rows, failed = [], []
    for row, err in results:
        if err:
            failed.append(err[0])
            log(f"FAIL  {err[0]:14} {err[1]}")
        else:
            rows.append(row)

    rows.sort(key=lambda r: (r["market"], r["kind"] != "index", r["name"]))
    write(rows, failed, markets)
    log(f"\n{len(rows)} symbols · {len(failed)} failed · {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
