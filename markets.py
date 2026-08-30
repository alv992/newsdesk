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
ECB = "https://data-api.ecb.europa.eu/service/data/"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) newsdesk/0.1"}
TIMEOUT = 25
WORKERS = 4          # gentle: this is an undocumented endpoint
SPARK_POINTS = 60
MAX_STOCKS = 35      # per market. Indices are never capped.

# Ranking is by market capitalisation, and it comes from the ORDER of the
# stocks in markets.toml — largest first. Yahoo does not expose market cap
# on any endpoint that still works without a crumb: the chart meta has no
# such field and both quoteSummary and v7/quote now answer 401.
#
# So the order is curated. It is a snapshot and it drifts; re-check it once
# or twice a year. The alternative was ranking by price x volume, which is
# turnover, not size — a cheap heavily-traded stock would outrank a large one.

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


def ecb_series(key, n):
    """ECB SDMX-JSON -> [(period, value)] oldest first."""
    r = httpx.get(f"{ECB}{key}?format=jsondata&lastNObservations={n}",
                  timeout=TIMEOUT, headers=UA, follow_redirects=True)
    r.raise_for_status()
    j = r.json()
    ser = j["dataSets"][0]["series"]
    if not ser:
        raise ValueError("no series")
    obs = next(iter(ser.values()))["observations"]
    periods = j["structure"]["dimensions"]["observation"][0]["values"]
    out = [(periods[int(k)]["id"], float(v[0]))
           for k, v in sorted(obs.items(), key=lambda kv: int(kv[0]))
           if v and v[0] is not None]
    if not out:
        raise ValueError("no observations")
    return out


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


def fetch_bond(job):
    """Government bond yields. Change is in basis points, not percent: a
    yield moving 3.0 to 3.5 is +50bp, and calling that +16.7% would be
    arithmetically true and useless.

    Three resolutions, and the window has to be counted in the right unit:
      Yahoo ^TNX etc     business-daily
      ECB YC curve       business-daily
      ECB IRS national   monthly — so DoD and 1W do not exist
    """
    key, name, market, kind, rank = job

    long = None
    if key.startswith("^"):                      # US treasuries, via Yahoo
        points, _ = series(key, "5y", "1d")
        long, _ = series(key, "max", "1mo")      # 5Y and All need real depth
        since = str(datetime.fromtimestamp(long[0][0], timezone.utc).year)
        daily = True
    elif "/B." in key:                           # ECB euro area AAA curve
        points = ecb_series(key, 6000)           # the curve starts in 2004
        daily, since = True, points[0][0][:4]
    else:                                        # ECB national, monthly
        points = ecb_series(key, 400)
        daily, since = False, points[0][0][:4]

    last = points[-1][1]

    # How many observations back each window is, at this resolution.
    BUSINESS_DAYS = {"DoD": 1, "1W": 5, "1M": 21, "3M": 63, "6M": 126,
                     "1Y": 251, "2Y": 502, "5Y": 1255}
    MONTHS = {"1M": 1, "3M": 3, "6M": 6, "1Y": 12, "2Y": 24, "5Y": 60}

    changes = {}
    for label, _which, _back in WINDOWS:
        if label == "All":
            oldest = (long or points)[0][1]
            changes[label] = round((last - oldest) * 100, 1)
            continue

        step = (BUSINESS_DAYS if daily else MONTHS).get(label)
        if step is not None and len(points) > step:
            changes[label] = round((last - points[-1 - step][1]) * 100, 1)
        elif long and (m := MONTHS.get(label)) and len(long) > m:
            changes[label] = round((last - long[-1 - m][1]) * 100, 1)   # fall back to monthly

    return {
        "symbol": key if key.startswith("^") else key.split("/")[-1][:24],
        "name": name,
        "market": market,
        "kind": kind,
        "rank": rank,
        "metric": "bp",
        "currency": "%",
        "price": round(last, 3),
        "changes": changes,
        "spark": [round(v, 4) for _, v in points[-SPARK_POINTS:]],
        "since": since,
    }, None


def fetch_one(job):
    """Never raises. One bad symbol must not lose the rest."""
    sym, name, market, kind, rank = job
    if kind == "bond":
        try:
            return fetch_bond(job)
        except Exception as e:
            code = getattr(getattr(e, "response", None), "status_code", "")
            return None, (name, f"{type(e).__name__} {code}".strip())
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
            "kind": kind,                     # index | stock | bond
            "rank": rank,                     # position by market cap, largest = 0
            "metric": "pct",
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
        for rank, (sym, name) in enumerate(m.get("index", {}).items()):
            jobs.append((sym, name, m["id"], "index", rank))

        # tomllib preserves document order, so position in the file is the rank.
        stocks = list(m.get("stocks", {}).items())
        if len(stocks) > MAX_STOCKS:
            log(f"  {m['label']}: keeping the largest {MAX_STOCKS} of {len(stocks)}")
            stocks = stocks[:MAX_STOCKS]
        for rank, (sym, name) in enumerate(stocks):
            jobs.append((sym, name, m["id"], "stock", rank))
        for rank, (key, name) in enumerate(m.get("bonds", {}).items()):
            jobs.append((key, name, m["id"], "bond", rank))

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

    order = {"index": 0, "bond": 1, "stock": 2}   # index, then bonds, then stocks
    rows.sort(key=lambda r: (r["market"], order[r["kind"]], r["rank"]))
    write(rows, failed, markets)
    log(f"\n{len(rows)} symbols · {len(failed)} failed · {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
