# /// script
# requires-python = ">=3.11"
# dependencies = ["feedparser", "httpx"]
# ///
"""Newsdesk fetcher.

Reads feeds.toml and categories.toml, pulls each feed in parallel,
tags each story with a category and countries, writes data.js.

Does not sort, filter or score — that is the page's job.

Run with:  uv run fetch.py
"""

import hashlib
from html.parser import HTMLParser
from html import unescape
import json
import os
import re
import sys
import tomllib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import feedparser
import httpx

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data.js")
WINDOW_DAYS = 30
TIMEOUT = 15
WORKERS = 8
LOCAL_CATEGORY = "local-politics"
INTL_CATEGORY = "geopolitics"

SPACES = re.compile(r"\s+")

# Feeds append promo text to every summary. The Guardian's "free app or daily
# news podcast" was tagging flood coverage as Technology. Cut at the marker.
BOILERPLATE = re.compile(
    r"(Get our (breaking news|morning and afternoon)"
    r"|Sign up (for|to) (our|the)"
    r"|Continue reading\.\.\."
    r"|Read more( on this story)?:"
    r"|Suscríbete (a|para)"
    r"|Sigue toda la (información|actualidad)"
    r"|Apúntate (a|para)"
    r"|Leer más)",
    re.IGNORECASE,
)


# ─────────────────────────────── countries ───────────────────────────────
# code -> (region, [terms]). Terms are matched on whole words only.
# Bare names that are also common English words (Georgia, Jordan, Turkey as
# a bird) are left out where the adjective or capital is safer.

COUNTRIES = {
    # Europe
    "ES": ("europe", ["Spain", "Spanish", "Madrid", "España", "español", "española"]),
    "FR": ("europe", ["France", "French", "Paris"]),
    "DE": ("europe", ["Germany", "German", "Berlin", "Alemania"]),
    "IT": ("europe", ["Italy", "Italian", "Rome"]),
    "PT": ("europe", ["Portugal", "Portuguese", "Lisbon"]),
    "GB": ("europe", ["Britain", "British", "UK", "England", "London", "Scotland", "Wales"]),
    "IE": ("europe", ["Ireland", "Irish", "Dublin"]),
    "NL": ("europe", ["Netherlands", "Dutch", "Amsterdam", "Hague"]),
    "BE": ("europe", ["Belgium", "Belgian", "Brussels"]),
    "AT": ("europe", ["Austria", "Austrian", "Vienna"]),
    "CH": ("europe", ["Switzerland", "Swiss", "Bern", "Geneva", "Zurich"]),
    "PL": ("europe", ["Poland", "Polish", "Warsaw"]),
    "CZ": ("europe", ["Czech", "Prague"]),
    "SK": ("europe", ["Slovakia", "Slovak", "Bratislava"]),
    "HU": ("europe", ["Hungary", "Hungarian", "Budapest", "Orban", "Orbán"]),
    "RO": ("europe", ["Romania", "Romanian", "Bucharest"]),
    "BG": ("europe", ["Bulgaria", "Bulgarian", "Sofia"]),
    "GR": ("europe", ["Greece", "Greek", "Athens"]),
    "HR": ("europe", ["Croatia", "Croatian", "Zagreb"]),
    "RS": ("europe", ["Serbia", "Serbian", "Belgrade"]),
    "UA": ("europe", ["Ukraine", "Ukrainian", "Kyiv", "Kiev", "Zelensky", "Zelenskyy"]),
    "RU": ("europe", ["Russia", "Russian", "Moscow", "Kremlin", "Putin"]),
    "BY": ("europe", ["Belarus", "Belarusian", "Minsk", "Lukashenko"]),
    "MD": ("europe", ["Moldova", "Moldovan", "Chisinau"]),
    "SE": ("europe", ["Sweden", "Swedish", "Stockholm"]),
    "NO": ("europe", ["Norway", "Norwegian", "Oslo"]),
    "DK": ("europe", ["Denmark", "Danish", "Copenhagen"]),
    "FI": ("europe", ["Finland", "Finnish", "Helsinki"]),
    "IS": ("europe", ["Iceland", "Icelandic", "Reykjavik"]),
    "EE": ("europe", ["Estonia", "Estonian", "Tallinn"]),
    "LV": ("europe", ["Latvia", "Latvian", "Riga"]),
    "LT": ("europe", ["Lithuania", "Lithuanian", "Vilnius"]),
    "CY": ("europe", ["Cyprus", "Cypriot", "Nicosia"]),
    "MT": ("europe", ["Malta", "Maltese", "Valletta"]),
    "SI": ("europe", ["Slovenia", "Slovenian", "Ljubljana"]),
    "BA": ("europe", ["Bosnia", "Bosnian", "Sarajevo"]),
    "AL": ("europe", ["Albania", "Albanian", "Tirana"]),
    "MK": ("europe", ["Macedonia", "Macedonian", "Skopje"]),
    "XK": ("europe", ["Kosovo", "Kosovar", "Pristina"]),
    # Americas
    "US": ("world", ["United States", "American", "Washington", "White House", "Trump", "EEUU", "Estados Unidos"]),
    "CA": ("world", ["Canada", "Canadian", "Ottawa", "Toronto"]),
    "MX": ("world", ["Mexico", "Mexican", "México", "Sheinbaum"]),
    "BR": ("world", ["Brazil", "Brazilian", "Brasilia", "Brasil", "Lula"]),
    "AR": ("world", ["Argentina", "Argentine", "Argentinian", "Buenos Aires", "Milei"]),
    "CL": ("world", ["Chile", "Chilean", "Santiago de Chile"]),
    "CO": ("world", ["Colombia", "Colombian", "Bogota", "Bogotá"]),
    "PE": ("world", ["Peru", "Peruvian", "Lima"]),
    "VE": ("world", ["Venezuela", "Venezuelan", "Caracas", "Maduro"]),
    "CU": ("world", ["Cuba", "Cuban", "Havana"]),
    "EC": ("world", ["Ecuador", "Ecuadorian", "Quito"]),
    "BO": ("world", ["Bolivia", "Bolivian", "La Paz"]),
    # Asia-Pacific
    "CN": ("world", ["China", "Chinese", "Beijing", "Xi Jinping", "Shanghai"]),
    "TW": ("world", ["Taiwan", "Taiwanese", "Taipei"]),
    "JP": ("world", ["Japan", "Japanese", "Tokyo"]),
    "KR": ("world", ["South Korea", "Korean", "Seoul"]),
    "KP": ("world", ["North Korea", "Pyongyang", "Kim Jong Un"]),
    "NP": ("world", ["Nepal", "Nepalese", "Nepali", "Katmandú", "Kathmandu"]),
    "IN": ("world", ["India", "Indian", "New Delhi", "Modi"]),
    "PK": ("world", ["Pakistan", "Pakistani", "Islamabad"]),
    "BD": ("world", ["Bangladesh", "Bangladeshi", "Dhaka"]),
    "AF": ("world", ["Afghanistan", "Afghan", "Kabul", "Taliban"]),
    "ID": ("world", ["Indonesia", "Indonesian", "Jakarta"]),
    "VN": ("world", ["Vietnam", "Vietnamese", "Hanoi"]),
    "TH": ("world", ["Thailand", "Thai", "Bangkok"]),
    "PH": ("world", ["Philippines", "Filipino", "Manila"]),
    "MY": ("world", ["Malaysia", "Malaysian", "Kuala Lumpur"]),
    "SG": ("world", ["Singapore", "Singaporean"]),
    "AU": ("world", ["Australia", "Australian", "Canberra", "Sydney"]),
    "NZ": ("world", ["New Zealand", "Wellington"]),
    # Middle East
    "IL": ("world", ["Israel", "Israeli", "Jerusalem", "Tel Aviv", "Netanyahu"]),
    "PS": ("world", ["Palestine", "Palestinian", "Gaza", "West Bank", "Hamas"]),
    "LB": ("world", ["Lebanon", "Lebanese", "Beirut", "Hezbollah"]),
    "SY": ("world", ["Syria", "Syrian", "Damascus"]),
    "IQ": ("world", ["Iraq", "Iraqi", "Baghdad"]),
    "IR": ("world", ["Iran", "Iranian", "Tehran"]),
    "SA": ("world", ["Saudi Arabia", "Saudi", "Riyadh"]),
    "AE": ("world", ["Emirates", "Emirati", "Dubai", "Abu Dhabi"]),
    "QA": ("world", ["Qatar", "Qatari", "Doha"]),
    "YE": ("world", ["Yemen", "Yemeni", "Sanaa", "Houthi"]),
    "JO": ("world", ["Jordanian", "Amman"]),
    "TR": ("world", ["Turkish", "Ankara", "Istanbul", "Erdogan", "Erdoğan"]),
    # Africa
    "EG": ("world", ["Egypt", "Egyptian", "Cairo"]),
    "MA": ("world", ["Morocco", "Moroccan", "Rabat", "Marruecos"]),
    "DZ": ("world", ["Algeria", "Algerian", "Algiers"]),
    "TN": ("world", ["Tunisia", "Tunisian", "Tunis"]),
    "LY": ("world", ["Libya", "Libyan", "Tripoli"]),
    "SD": ("world", ["Sudan", "Sudanese", "Khartoum"]),
    "ET": ("world", ["Ethiopia", "Ethiopian", "Addis Ababa"]),
    "KE": ("world", ["Kenya", "Kenyan", "Nairobi"]),
    "NG": ("world", ["Nigeria", "Nigerian", "Abuja", "Lagos"]),
    "ZA": ("world", ["South Africa", "South African", "Pretoria", "Johannesburg"]),
    "GH": ("world", ["Ghana", "Ghanaian", "Accra"]),
    "SN": ("world", ["Senegal", "Senegalese", "Dakar"]),
    "ML": ("world", ["Malian", "Bamako"]),
    "NE": ("world", ["Nigerien", "Niamey"]),
    "TD": ("world", ["Chadian", "N'Djamena"]),
    "CD": ("world", ["Congo", "Congolese", "Kinshasa"]),
    "ZW": ("world", ["Zimbabwe", "Zimbabwean", "Harare"]),
}


def word_regex(terms):
    """Whole-word, case-insensitive match over a list of terms."""
    return re.compile(r"\b(?:%s)\b" % "|".join(re.escape(t) for t in sorted(terms, key=len, reverse=True)), re.IGNORECASE)


COUNTRY_RE = {code: word_regex(terms) for code, (_, terms) in COUNTRIES.items()}


def log(msg):
    print(msg, file=sys.stderr)


def load_toml(name):
    # tomllib needs binary mode so it can handle the encoding itself
    with open(os.path.join(HERE, name), "rb") as f:
        return tomllib.load(f)


def load_categories():
    """Returns category labels and keyword patterns for weighted classification."""
    raw = load_toml("categories.toml")
    return [(slug, block["label"], word_regex(block["words"])) for slug, block in raw.items()]


def story_id(url):
    return hashlib.sha1(url.encode()).hexdigest()[:16]


def published_iso(entry):
    """feedparser normalises every date convention into a struct_time (UTC)."""
    t = entry.get("published_parsed") or entry.get("updated_parsed")
    if not t:
        return None
    return datetime(*t[:6], tzinfo=timezone.utc).isoformat()


class PreviewParser(HTMLParser):
    """Keep article prose, with boundaries, excluding common embedded clutter."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.stack = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        marker = (attrs.get("class") or "") + " " + (attrs.get("id") or "")
        skip = tag in {"script", "style", "nav", "aside", "figure"} or bool(
            re.search(r"related|newsletter|subscribe|promo|social-share", marker, re.I))
        if tag not in {"br", "hr", "img", "meta", "link", "input", "source", "wbr"}:
            self.stack.append((tag, skip))
        if tag in {"p", "div", "br", "li", "h2", "h3"}:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break
        if tag in {"p", "div", "li", "h2", "h3"}:
            self.parts.append(" ")

    def handle_data(self, data):
        if not any(skip for _, skip in self.stack):
            self.parts.append(data)


def clean(html, title=""):
    """At most two sentences; never invent a preview or cut through a word."""
    parser = PreviewParser()
    parser.feed(html or "")
    text = SPACES.sub(" ", unescape("".join(parser.parts))).strip()
    cut = BOILERPLATE.search(text)
    if cut:
        text = text[:cut.start()].strip()
    title = unescape(title).strip()
    if title and text.casefold().startswith(title.casefold()):
        text = text[len(title):].lstrip(" .:–—- ")
    sentences = re.split(r"(?<=[.!?])\s+", text)
    kept = []
    for sentence in sentences[:2]:
        if len(" ".join(kept + [sentence])) > 400:
            break
        kept.append(sentence)
    if kept:
        return " ".join(kept)
    return text[:397].rsplit(" ", 1)[0].rstrip(".,;:") + "…" if len(text) > 400 else text


def classify(title, preview, rules, region, feed_category):
    """One winner, explainable scores. Scores are not probabilities."""
    scores, evidence = {}, {}
    for slug, _label, pattern in rules:
        hits = []
        for field, text, multiplier in (("title", title, 2), ("preview", preview, 1)):
            # Regex alternatives are longest first: overlapping terms count once.
            terms = {m.group(0).casefold() for m in pattern.finditer(text)}
            for term in sorted(terms):
                strong = " " in term or term in STRONG_TERMS
                hits.append({"field": field, "term": term, "weight": multiplier * (3 if strong else 1)})
        bonus = 2 if feed_category == slug else 0
        scores[slug] = sum(h["weight"] for h in hits) + bonus
        evidence[slug] = hits
    ranked = sorted(scores, key=lambda slug: (-scores[slug], slug != feed_category, slug))
    winner = ranked[0]
    method = "weighted"
    if not scores[winner]:
        winner = LOCAL_CATEGORY if region == "spain" else INTL_CATEGORY
        method = "region-fallback"
    margin = scores[ranked[0]] - scores[ranked[1]] if len(ranked) > 1 else scores[ranked[0]]
    return winner, {"version": 2, "method": method, "scores": scores,
                    "evidence": evidence, "feed_bonus": feed_category,
                    "margin": margin, "uncertain": method != "weighted" or margin < 3}


# Explicit strong single words; names and broad terms remain weak.
STRONG_TERMS = {"inflation", "inflación", "earnings", "recession", "recesión",
                "hipoteca", "mortgage", "ransomware", "semiconductor", "vacuna",
                "vaccine", "telescopio", "telescope", "investidura", "desempleo"}


def retag(story, rules, feeds):
    feed = feeds.get(story.get("feed", story["source"]), {})
    story["summary"] = clean(story.get("summary", ""), story["title"])
    story["countries"] = find_countries(story["title"] + " " + story["summary"])
    story["region"] = region_for(story["countries"], feed.get("region", "world"))
    # Broad newspapers do not supply reliable subject evidence.
    topic = feed.get("category") if feed.get("topic_hint", True) else None
    story["category"], story["classification"] = classify(
        story["title"], story["summary"], rules, story["region"], topic)
    return story


def find_countries(text):
    return [code for code, pattern in COUNTRY_RE.items() if pattern.search(text)]


def region_for(codes, feed_region):
    if not codes:
        return feed_region
    if codes == ["ES"]:
        return "spain"
    if any(COUNTRIES[c][0] == "europe" for c in codes):
        return "europe"
    return "world"


def fetch_one(args):
    """Never raises. One bad feed must not take down the other 25."""
    feed, rules = args
    name = feed["name"]
    try:
        r = httpx.get(
            feed["url"],
            timeout=TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": "newsdesk/0.1"},
        )
        r.raise_for_status()

        d = feedparser.parse(r.content)
        if not d.entries:
            raise ValueError(d.bozo_exception if d.bozo else "no entries")

        stories = []
        for e in d.entries:
            link = e.get("link")
            when = published_iso(e)
            summary = clean(e.get("summary", "") or e.get("description", ""), e.get("title", ""))

            # Bluesky and Mastodon posts carry no title — they are just text.
            # Use the opening of the post so they aren't dropped.
            title = unescape((e.get("title") or "").strip())
            if not title and summary:
                title = summary[:90].rstrip()
                if len(summary) > 90:
                    title += "…"

            if not (link and title and when):
                continue  # drop the item, not the feed
            text = f"{title} {summary}"
            codes = find_countries(text)
            region = region_for(codes, feed.get("region", "world"))

            publisher = e.get("source", {}).get("title") or name
            # Search feeds aggregate publishers; their feed label is not provenance.
            aggregated = "news.google.com" in feed["url"]
            stories.append(
                {
                    "id": story_id(link),
                    "title": title,
                    "summary": summary,
                    "url": link,
                    "published": when,
                    "source": publisher if aggregated else name,
                    "tier": 3 if aggregated and publisher != name else feed.get("tier", 4),
                    "kind": feed.get("kind", "news"),
                    "category": INTL_CATEGORY,
                    "feed": name,
                    "countries": codes,
                    "region": region,
                }
            )
        return name, [retag(s, rules, {name: feed}) for s in stories], None

    except Exception as e:
        return name, [], f"{type(e).__name__}: {e}"


def load_store():
    """Read back what we wrote last time, unwrapping the window.DATA = ... ;"""
    if not os.path.exists(DATA):
        return []
    try:
        raw = open(DATA, encoding="utf-8").read()
        raw = raw[raw.index("{") : raw.rindex("}") + 1]
        return json.loads(raw).get("stories", [])
    except (ValueError, json.JSONDecodeError):
        log("data.js unreadable — starting fresh")
        return []


def write(stories, failed, rules):
    payload = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "failed": failed,
        "categories": [{"slug": s, "label": l} for s, l, _ in rules]
        + [{"slug": INTL_CATEGORY, "label": "Geopolitics"}],
        "countries": {c: COUNTRIES[c][1][0] for c in COUNTRIES},
        "stories": stories,
    }
    # Write then rename: the page never sees a half-written file.
    tmp = DATA + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("window.DATA = ")
        json.dump(payload, f, ensure_ascii=False)
        f.write(";\n")
    os.replace(tmp, DATA)


def main():
    feeds = load_toml("feeds.toml")["feed"]
    rules = load_categories()

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(fetch_one, [(f, rules) for f in feeds]))

    fresh, failed = [], []
    for name, stories, error in results:
        if error:
            failed.append(name)
            log(f"FAIL  {name}: {error}")
        else:
            log(f"ok    {name}: {len(stories)}")
            fresh += stories

    # Keep what we already had. Same URL is not stored twice.
    # This is not story merging — three outlets on one story stay three entries.
    by_id = {s["id"]: s for s in load_store()}
    for s in fresh:
        by_id[s["id"]] = s  # re-tag existing stories when rules change

    cutoff = datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)
    kept = [s for s in by_id.values() if datetime.fromisoformat(s["published"]) > cutoff]
    feed_map = {f["name"]: f for f in feeds}
    kept = [retag(s, rules, feed_map) for s in kept]
    kept.sort(key=lambda s: s["published"], reverse=True)

    write(kept, failed, rules)
    log(f"\n{len(kept)} stories stored · {len(failed)} of {len(feeds)} feeds failed")


if __name__ == "__main__":
    main()
