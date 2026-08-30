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

TAGS = re.compile(r"<[^>]+>")
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
    return re.compile(r"\b(?:%s)\b" % "|".join(re.escape(t) for t in terms), re.IGNORECASE)


COUNTRY_RE = {code: word_regex(terms) for code, (_, terms) in COUNTRIES.items()}


def log(msg):
    print(msg, file=sys.stderr)


def load_toml(name):
    # tomllib needs binary mode so it can handle the encoding itself
    with open(os.path.join(HERE, name), "rb") as f:
        return tomllib.load(f)


def load_categories():
    """Returns [(slug, label, compiled regex)] in file order. Order is priority."""
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


def clean(html):
    """Feed summaries carry markup and promo text. This is a preview, not an article."""
    text = TAGS.sub("", html or "")
    text = SPACES.sub(" ", text).strip()
    cut = BOILERPLATE.search(text)
    if cut:
        text = text[: cut.start()].strip()
    return text[:400]


def categorise(text, rules, region, feed_category):
    """Three steps, in order:

    1. A keyword match wins outright. Keywords always beat the source.
    2. Otherwise the source decides, if it declared a topic. A story from
       Expansión with no keyword hit is still finance.
    3. Otherwise route by region: a Spanish story is local news, anything
       else is the international arena.
    """
    for slug, _label, pattern in rules:
        if pattern.search(text):
            return slug
    if feed_category:
        return feed_category
    return LOCAL_CATEGORY if region == "spain" else INTL_CATEGORY


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
            summary = clean(e.get("summary", "") or e.get("description", ""))

            # Bluesky and Mastodon posts carry no title — they are just text.
            # Use the opening of the post so they aren't dropped.
            title = (e.get("title") or "").strip()
            if not title and summary:
                title = summary[:90].rstrip()
                if len(summary) > 90:
                    title += "…"

            if not (link and title and when):
                continue  # drop the item, not the feed
            text = f"{title} {summary}"
            codes = find_countries(text)
            region = region_for(codes, feed.get("region", "world"))

            stories.append(
                {
                    "id": story_id(link),
                    "title": title,
                    "summary": summary,
                    "url": link,
                    "published": when,
                    "source": name,
                    "tier": feed.get("tier", 4),
                    "kind": feed.get("kind", "news"),
                    "category": categorise(text, rules, region, feed.get("category")),
                    "countries": codes,
                    "region": region,
                }
            )
        return name, stories, None

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
    kept.sort(key=lambda s: s["published"], reverse=True)

    write(kept, failed, rules)
    log(f"\n{len(kept)} stories stored · {len(failed)} of {len(feeds)} feeds failed")


if __name__ == "__main__":
    main()
