# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx"]
# ///
"""Newsdesk daily brief.

Two halves, produced differently on purpose (see D20):

  Markets   computed here, in Python. Year-on-year moves, top five per
            market, plus bonds. Deterministic and checkable.
  News      written by a local model, one paragraph per category, from
            headlines only.

The model never sees a number it is asked to repeat. Every figure in the
brief comes from the same arithmetic that fills the Markets tab, so the
two cannot disagree.

The brief is for one day and is overwritten on every run. Nothing is kept.

Run with:  uv run summarise.py
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

import httpx

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "summary.js")
OLLAMA = "http://localhost:11434/api/generate"
MODEL = os.environ.get("NEWSDESK_MODEL", "llama3.2:3b")
HOURS = 24
MAX_TITLES = 45          # per category — a small model needs a short list
PER_SOURCE = 4           # so no single feed writes the paragraph
TOP_MOVERS = 5
WINDOW = "1M"            # month on month. A year barely moves between runs
MAX_TIER = 3             # skip social sources in the brief

# NEWSDESK_NEWS=skip reuses yesterday's paragraphs and only recomputes the
# market half. The market half takes a second; the model takes minutes.
SKIP_NEWS = os.environ.get("NEWSDESK_NEWS") == "skip"

THINK = re.compile(r"<think>.*?</think>", re.S | re.I)


def log(m):
    print(m, file=sys.stderr)


def load(name, var):
    path = os.path.join(HERE, name)
    if not os.path.exists(path):
        log(f"{name} missing — run its fetcher first")
        sys.exit(2)
    raw = open(path, encoding="utf-8").read()
    return json.loads(raw[raw.index("{"): raw.rindex("}") + 1])


# ─────────────────────────── markets, computed ───────────────────────────

def market_section(mkt):
    """Month on month. The five biggest risers and the five biggest fallers
    per market, plus every index and bond with a figure.

    A year-on-year figure barely changes between daily runs, so the brief
    would read the same every morning. A month moves enough to be news."""
    by_market = {}
    for r in mkt["rows"]:
        by_market.setdefault(r["market"], []).append(r)

    out = []
    for mid, rows in by_market.items():
        has = lambda r: r["changes"].get(WINDOW) is not None

        indices = [{"name": r["name"], "change": r["changes"][WINDOW]}
                   for r in rows if r["kind"] == "index" and has(r)]
        bonds = [{"name": r["name"], "yield": r["price"], "change": r["changes"][WINDOW]}
                 for r in rows if r["kind"] == "bond" and has(r)]

        stocks = sorted((r for r in rows if r["kind"] == "stock" and has(r)),
                        key=lambda r: r["changes"][WINDOW], reverse=True)
        entry = lambda r: {"name": r["name"], "symbol": r["symbol"],
                           "change": r["changes"][WINDOW]}
        risers = [entry(r) for r in stocks[:TOP_MOVERS]]
        fallers = [entry(r) for r in reversed(stocks[-TOP_MOVERS:])]

        # A market with fewer than ten stocks would list the same name twice.
        seen = {r["symbol"] for r in risers}
        fallers = [f for f in fallers if f["symbol"] not in seen]

        if not (indices or bonds or risers or fallers):
            continue
        out.append({"market": mid, "label": mkt["markets"][mid], "window": WINDOW,
                    "indices": indices, "bonds": bonds,
                    "risers": risers, "fallers": fallers})
    return out


# ──────────────────────────── news, written ──────────────────────────────

PROMPT = """Below are {n} headlines from the last 24 hours, category "{label}".
They are in English and Spanish.

Write 4 to 5 sentences in English summarising the day in this category.

Cover the range, not just the biggest story. Group related headlines and
mention several distinct stories. A reader should finish knowing roughly
what happened today, not one thing in detail.

Rules:
- Use ONLY what is written in the headlines. Add no background, context,
  numbers, names or outcomes that are not below.
- Begin with the first thing that actually happened, naming whoever it
  happened to. NEVER begin by referring to the category, the headlines, the
  day, or this summary — no "News in this category", no "Headlines covered".
- Never write vague filler like "there were reports on", "covered a range of
  topics", or "in other news". Name the thing that happened.
- No preamble, no bullet points, no headings. One paragraph.
- If the headlines are too scattered to summarise, say so in one sentence.

Headlines:
{titles}"""


def write_paragraph(label, titles):
    body = "\n".join(f"- {t}" for t in titles)
    r = httpx.post(OLLAMA, timeout=600, json={
        "model": MODEL,
        "prompt": PROMPT.format(n=len(titles), label=label, titles=body),
        "stream": False,
        # Reasoning models spend tokens thinking before they answer, and
        # Ollama counts that against num_predict. At 320 the whole budget
        # went on reasoning and the response came back empty — every
        # paragraph blank, with the call reporting success.
        "options": {"temperature": 0.3, "num_predict": 2200},
    })
    r.raise_for_status()
    body = r.json()
    text = THINK.sub("", body.get("response") or "").strip()
    if not text:
        raise ValueError(f"empty response after {body.get('eval_count')} tokens "
                         f"({len(body.get('thinking') or '')} chars of reasoning)")
    return text


def news_section(data):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=HOURS)
    labels = {c["slug"]: c["label"] for c in data["categories"]}

    buckets = {}
    for s in data["stories"]:
        if s.get("kind") == "report" or s.get("tier", 4) > MAX_TIER:
            continue
        if datetime.fromisoformat(s["published"]) < cutoff:
            continue
        buckets.setdefault(s["category"], []).append(s)

    out = []
    for slug, stories in buckets.items():
        stories.sort(key=lambda s: (s.get("tier", 4), s["published"]))

        # Cap per source, or one prolific feed writes the paragraph. Eurostat
        # alone put 12 statistical releases into Economic/Finance and the
        # summary read like a Eurostat bulletin.
        seen, titles = {}, []
        for st in stories:
            if seen.get(st["source"], 0) >= PER_SOURCE:
                continue
            seen[st["source"]] = seen.get(st["source"], 0) + 1
            titles.append(st["title"])
            if len(titles) >= MAX_TITLES:
                break
        label = labels.get(slug, slug)
        t0 = time.time()
        try:
            text = write_paragraph(label, titles)
            took = time.time() - t0
            log(f"ok    {label:18} {len(stories):4} stories, {len(titles)} sent, "
                f"{len(text.split()):3} words, {took:5.1f}s")
        except Exception as e:
            text, took = "", time.time() - t0
            log(f"FAIL  {label:18} {type(e).__name__}: {e}")
        out.append({"category": slug, "label": label, "count": len(stories),
                    "sent": len(titles), "text": text, "seconds": round(took, 1)})
    out.sort(key=lambda x: -x["count"])
    return out


def write(payload):
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("window.SUMMARY = ")
        json.dump(payload, f, ensure_ascii=False)
        f.write(";\n")
    os.replace(tmp, OUT)


def main():
    data = load("data.js", "DATA")
    mkt = load("markets.js", "MARKETS")

    t0 = time.time()
    markets = market_section(mkt)          # never fails, never guesses
    log(f"markets: {len(markets)} blocks, {WINDOW}\n")

    if SKIP_NEWS:
        previous = os.path.exists(OUT) and load("summary.js", "SUMMARY").get("news", [])
        news = previous or []
        log(f"news: reusing {len(news)} paragraphs (NEWSDESK_NEWS=skip)")
    else:
        news = news_section(data)
    ok = [n for n in news if n["text"]]

    write({
        "generated": datetime.now(timezone.utc).isoformat(),
        "day": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "model": MODEL,
        "window_hours": HOURS,
        "seconds": round(time.time() - t0, 1),
        "news": news,
        "markets": markets,
    })
    log(f"\n{len(ok)} of {len(news)} paragraphs written · {time.time() - t0:.0f}s total")
    if not ok:
        log("no paragraphs — the market half still published")


if __name__ == "__main__":
    main()
