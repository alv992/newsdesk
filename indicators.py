# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx"]
# ///
"""Newsdesk indicators.

Reads indicators.toml, pulls each series from its agency, normalises them
all into one shape, writes indicators.js.

Numbers over time, not stories — so this has its own timer. Most of these
publish monthly or yearly; daily is already generous. See D14.

Run with:  uv run indicators.py
"""

import json
import os
import sys
import tomllib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import httpx

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "indicators.js")
TIMEOUT = 30
POINTS = 24          # how much history to keep per series

GEO_LABEL = {"ES": "Spain", "EUU": "European Union", "WLD": "World", "EA": "Euro area"}


def log(msg):
    print(msg, file=sys.stderr)


def get(url):
    r = httpx.get(url, timeout=TIMEOUT, follow_redirects=True,
                  headers={"User-Agent": "newsdesk/0.1", "Accept": "application/json"})
    r.raise_for_status()
    return r.json()


# ─────────────────────────────── adapters ────────────────────────────────
# Every agency returns a different shape. Each adapter's job is to produce
# the same thing: [{"period": "2025-10", "value": 2.1}, ...] oldest first.

def from_worldbank(ind):
    """World Bank: [metadata, [{date, value}, ...]] — newest first, nulls common."""
    url = (f"https://api.worldbank.org/v2/country/{ind['geo']}"
           f"/indicator/{ind['series']}?format=json&per_page={POINTS * 2}")
    payload = get(url)
    if not isinstance(payload, list) or len(payload) < 2 or not payload[1]:
        raise ValueError("no data")
    rows = [r for r in payload[1] if r.get("value") is not None]
    if not rows:
        raise ValueError("all values null")
    rows.reverse()
    return [{"period": r["date"], "value": round(float(r["value"]), 4)} for r in rows[-POINTS:]]


def from_ecb(ind):
    """ECB SDMX-JSON: observations keyed by position, periods in the structure."""
    url = (f"https://data-api.ecb.europa.eu/service/data/{ind['series']}"
           f"?format=jsondata&lastNObservations={POINTS}")
    payload = get(url)
    series = payload["dataSets"][0]["series"]
    if not series:
        raise ValueError("no series")
    obs = next(iter(series.values()))["observations"]
    periods = payload["structure"]["dimensions"]["observation"][0]["values"]
    out = []
    for pos, vals in sorted(obs.items(), key=lambda kv: int(kv[0])):
        if vals and vals[0] is not None:
            out.append({"period": periods[int(pos)]["id"], "value": round(float(vals[0]), 4)})
    if not out:
        raise ValueError("no observations")
    return out


ADAPTERS = {"worldbank": from_worldbank, "ecb": from_ecb}
AGENCY_NAME = {"worldbank": "World Bank", "ecb": "ECB"}


def fetch_one(ind):
    """Never raises. One dead series must not lose the rest."""
    name = f"{ind['label']} ({ind.get('geo', '')})"
    try:
        series = ADAPTERS[ind["agency"]](ind)
        latest, prev = series[-1], (series[-2] if len(series) > 1 else None)
        return {
            "id": f"{ind['agency']}:{ind['series']}:{ind.get('geo','')}",
            "label": ind["label"],
            "agency": AGENCY_NAME[ind["agency"]],
            "geo": ind.get("geo", ""),
            "geoLabel": GEO_LABEL.get(ind.get("geo", ""), ind.get("geo", "")),
            "unit": ind.get("unit", ""),
            "value": latest["value"],
            "period": latest["period"],
            "change": round(latest["value"] - prev["value"], 4) if prev else None,
            "series": series,
        }, None
    except Exception as e:
        return None, (name, f"{type(e).__name__}: {e}")


def write(indicators, failed):
    payload = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "failed": failed,
        "indicators": indicators,
    }
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("window.INDICATORS = ")
        json.dump(payload, f, ensure_ascii=False)
        f.write(";\n")
    os.replace(tmp, OUT)


def main():
    with open(os.path.join(HERE, "indicators.toml"), "rb") as f:
        wanted = tomllib.load(f)["indicator"]

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(fetch_one, wanted))

    ok, failed = [], []
    for ind, err in results:
        if err:
            failed.append(err[0])
            log(f"FAIL  {err[0]}: {err[1]}")
        else:
            log(f"ok    {ind['label']:20} {ind['geoLabel']:16} "
                f"{ind['value']}{ind['unit']}  ({ind['period']}, {len(ind['series'])} pts)")
            ok.append(ind)

    write(ok, failed)
    log(f"\n{len(ok)} indicators · {len(failed)} failed")


if __name__ == "__main__":
    main()
