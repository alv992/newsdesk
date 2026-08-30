# Newsdesk

A local news dashboard. Pulls ~55 hand-picked feeds, tags each story with a
category and the countries it mentions, and shows the result as a list you
can filter. A second tab shows statistical indicators from the World Bank
and the ECB.

No API keys. No accounts. No build step. Two small Python scripts write data
files, and a static page reads them.

Built against the spec in the Obsidian vault under
`DIY projects/OSINT projects/`.

## Run it

```bash
uv run fetch.py          # ~55 feeds, about 6 seconds
uv run indicators.py     # 11 series from the World Bank and ECB
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

59 assertions across five suites. They load the real `index.html`, the real
data files and the real `app.js` into jsdom and drive the page through the
same clicks a person would make, so they exercise the actual filters rather
than a mock of them.

Requires `data.js` and `indicators.js` to exist — run the two fetchers first.

`tests/visibility.test.mjs` is the one worth knowing about. It checks
`getComputedStyle`, not `element.hidden`, because an earlier version passed
while the controls it claimed were hidden sat plainly on screen: `.field`
sets `display: flex`, which beats the browser's own `[hidden]` rule.

## Layout

```
fetch.py         feeds → data.js
indicators.py    agencies → indicators.js
feeds.toml       sources
categories.toml  keyword rules
indicators.toml  which series to track
index.html       the page
app.js           filtering, sorting, rendering
style.css        Gruvbox Dark Soft
tests/           jsdom suites, run with npm test
```

`data.js` and `indicators.js` are generated and not committed.
