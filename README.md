# Newsdesk

A local news dashboard. Pulls ~55 hand-picked feeds, tags each story with a
category and the countries it mentions, and shows the result as a list you
can filter. Other tabs hold slow analysis, market prices and
macro-economic indicators.

No API keys. No accounts. No build step. Two small Python scripts write data
files, and a static page reads them.

Built against the spec in the Obsidian vault under
`DIY projects/OSINT projects/`.

## Run it

```bash
uv run fetch.py          # ~61 feeds, about 6 seconds
uv run indicators.py     # 11 macro series from the World Bank and ECB
uv run markets.py        # 412 securities across 13 markets, about 60 seconds
xdg-open index.html
```

`uv` reads the dependency header inside each script, so there is no
virtualenv to create or activate.

Requires Python 3.11+ and [uv](https://docs.astral.sh/uv/).

## Add a feed

Edit `feeds.toml`:

```toml
[[feed]]
name = "Le Monde (EN)"
url = "https://www.lemonde.fr/en/rss/une.xml"
tier = 2            # 1 wire · 2 quality · 3 regional · 4 social apps
region = "europe"   # world | europe | spain
category = "technology"   # optional — only used when no keyword matches
```

Then re-run `fetch.py`. A feed that fails is logged and skipped; the page
shows how many failed.

## How a story gets its category

Three steps, first match wins:

1. **A keyword matches** — rules live in `categories.toml`, file order is
   priority order.
2. **The source has a declared topic** — the `category` field above.
3. **The region decides** — Spain becomes Local, anything else Geopolitics.

Keep keywords specific. Single common words cause wrong tagging: `app` once
put flood coverage in Technology via a feed's promo footer, `Meta` matched
the Spanish noun *meta*, and `galaxy` matched the Samsung Galaxy.

## Tests

```bash
npm install     # jsdom, once
npm test
```

82 assertions across six suites. They load the real `index.html`, the real
data files and the real `app.js` into jsdom and drive the page through the
same clicks a person would make, so they exercise the actual filters rather
than a mock of them.

Requires `data.js`, `indicators.js` and `markets.js` to exist — run the
three fetchers first.

`tests/visibility.test.mjs` is the one worth knowing about. It checks
`getComputedStyle`, not `element.hidden`, because an earlier version passed
while the controls it claimed were hidden sat plainly on screen: `.field`
sets `display: flex`, which beats the browser's own `[hidden]` rule.

## Markets

`markets.toml` lists indices and their constituents. **Stock order is the
ranking** — largest by market capitalisation first — and `markets.py` keeps
the top 35 per market.

Rows within a market run **indices, then bonds, then stocks**, and the
Markets tab filters on each.

That order is curated by hand. Yahoo no longer exposes market cap on any
keyless endpoint: it is absent from the chart metadata, and both
`quoteSummary` and `v7/quote` answer 401 without a crumb. Ranking by price
times volume was the alternative, but that is turnover rather than size — a
cheap, heavily traded stock would outrank a large one. The order drifts;
re-check it once or twice a year.

### Bond yields

Government bonds come from the **ECB**, not Yahoo — keyless, and the only
place carrying comparable sovereign yields across Europe. US treasuries come
from Yahoo.

**Change is in basis points, not percent.** A yield moving 3.0 to 3.5 is
+50bp; calling it +16.7% would be arithmetically correct and useless.

Three resolutions, and each window is counted in the right unit:

| Series | Resolution | Effect |
|---|---|---|
| Yahoo `^TNX` etc | business-daily | every window |
| ECB AAA curve | business-daily | every window |
| ECB national (Maastricht) | **monthly** | DoD and 1W are blank |

Blank is the honest answer for a monthly series — inventing a daily figure
would not be. The UK is absent because the ECB stopped collecting after
Brexit and the series ends in January 2020.

## Layout

```
fetch.py         feeds → data.js
indicators.py    agencies → indicators.js
markets.py       Yahoo chart API → markets.js
feeds.toml       sources
categories.toml  keyword rules
indicators.toml  which series to track
markets.toml     which indices and stocks to track
index.html       the page
app.js           filtering, sorting, rendering
style.css        Gruvbox Dark Soft
tests/           jsdom suites, run with npm test
```

`data.js`, `indicators.js` and `markets.js` are generated and not committed.
