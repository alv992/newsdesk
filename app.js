// Newsdesk — the page.
//
// window.DATA arrives from data.js, loaded by a <script> tag in index.html.
// Everything below runs over that array in memory: no requests, no server.
// fetch.py ingests and tags. This file filters, sorts and renders.

const DATA = window.DATA;
const IND = window.INDICATORS;
const MKT = window.MARKETS;
const SUM = window.SUMMARY;
const SVGNS = "http://www.w3.org/2000/svg";

const $ = (id) => document.getElementById(id);
const list = $("list"), meta = $("meta"), endNote = $("end");
const tiles = $("tiles"), feedControls = $("feed-controls"), reportList = $("reports");
const panels = { summary: $("panel-summary"), feed: $("panel-feed"), reports: $("panel-reports"),
                 markets: $("panel-markets"), data: $("panel-data") };

const HOURS = [["24h", 24], ["48h", 48], ["7d", 168], ["30d", 720]];
const VIEWS = [["All", "all"], ["Unread", "unread"], ["Read", "read"]];
const BATCH = [25, 50, 100];
const REGIONS = [["All", "all"], ["World", "world"], ["Europe", "europe"], ["Spain", "spain"]];
const TABS = [["Summary", "summary"], ["News feed", "feed"], ["Reports", "reports"],
              ["Markets", "markets"], ["Macro-economics", "data"]];
const KINDS = [["All", "all"], ["Indices", "index"], ["Bonds", "bond"], ["Stocks", "stock"]];
// tier 1 wire · 2 quality · 3 regional/specialist · 4 social apps and channels
const SOURCES = [["All", "all"], ["News only", "news"]];
const SOCIAL_TIER = 4;
// Indicator groups follow the stated order of interest: world outwards in.
const GEO_ORDER = ["World", "European Union", "Euro area", "Spain"];

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ─────────────────────────────── storage ───────────────────────────────

const KEY = "newsdesk:";
const store = {
  get(k, dflt) {
    try { const v = localStorage.getItem(KEY + k); return v === null ? dflt : JSON.parse(v); }
    catch { return dflt; }
  },
  set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch {} },
};

const state = {
  category: store.get("category", "all"),
  region:   store.get("region", "all"),
  country:  store.get("country", "all"),
  hours:    store.get("hours", 24),
  view:     store.get("view", "all"),
  batch:    store.get("batch", 25),
  tab:      store.get("tab", "summary"),
  sources:  store.get("sources", "all") === "vetted" ? "news" : store.get("sources", "all"),
  window:   store.get("window", "DoD"),
  market:   store.get("market", "all"),
  kind:     store.get("kind", "all"),
  reportHours: store.get("reportHours", 720),
};

// Read ids, pruned to what still exists in the 30-day store.
const live = new Set(DATA.stories.map((s) => s.id));
let read = new Set(store.get("read", []).filter((id) => live.has(id)));
store.set("read", [...read]);

function markRead(id) {
  if (read.has(id)) return;
  read.add(id);
  store.set("read", [...read]);
}

// ─────────────────────────────── helpers ───────────────────────────────

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return RTF.format(-mins, "minute");
  if (mins < 1440) return RTF.format(-Math.round(mins / 60), "hour");
  return RTF.format(-Math.round(mins / 1440), "day");
}

// Feed content is untrusted: build with textContent, never innerHTML.
function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function labelFor(slug) {
  return (DATA.categories.find((c) => c.slug === slug) || {}).label || slug;
}

// ─────────────────────────────── filtering ─────────────────────────────

function filtered() {
  const cutoff = Date.now() - state.hours * 3600e3;
  return DATA.stories.filter((s) => {
    if (s.kind === "report") return false;   // Reports has its own tab
    if (state.category !== "all" && s.category !== state.category) return false;
    if (new Date(s.published).getTime() < cutoff) return false;
    if (state.region !== "all" && s.region !== state.region) return false;
    if (state.country !== "all" && !s.countries.includes(state.country)) return false;
    if (state.sources === "news" && s.tier >= SOCIAL_TIER) return false;
    if (state.view === "unread" && read.has(s.id)) return false;
    if (state.view === "read" && !read.has(s.id)) return false;
    return true;
  }).sort((a, b) => new Date(b.published) - new Date(a.published));
}

// ─────────────────────────────── cards ─────────────────────────────────

function card(story) {
  const a = el("a", "card");
  a.dataset.id = story.id;
  a.href = story.url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  if (read.has(story.id)) a.classList.add("read");
  if (story.tier >= SOCIAL_TIER) a.classList.add("social");

  const head = el("div", "head");
  head.append(el("span", "source", story.source));

  const tags = el("span", "tags");
  if (story.tier >= SOCIAL_TIER) {
    const u = el("span", "social-mark", "social");
    u.title = "From a social app or channel, not a news outlet";
    tags.append(u);
  }
  tags.append(el("span", "cat", labelFor(story.category)));
  for (const c of story.countries.slice(0, 3)) tags.append(el("span", "cc", c));
  tags.append(el("span", "when", ago(story.published)));
  head.append(tags);

  a.append(head, el("h2", null, story.title));
  if (story.summary) a.append(el("p", null, story.summary));

  a.addEventListener("click", () => {
    markRead(story.id);
    a.classList.add("read");
  });

  return a;
}

// ─────────────────────────── render + FLIP ─────────────────────────────

let current = [];   // everything matching the filters
let shown = 0;      // how many are in the DOM

const sentinel = el("div", "sentinel");
const io = new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting)) more();
}, { rootMargin: "300px" });

function positions() {
  const map = new Map();
  for (const node of list.children) {
    if (node.dataset.id) map.set(node.dataset.id, node.getBoundingClientRect());
  }
  return map;
}

// FLIP: First, Last, Invert, Play. Measure, re-layout, animate the gap shut.
function flip(before) {
  if (REDUCED) return;
  for (const node of list.children) {
    const prev = before.get(node.dataset.id);
    if (!prev) continue;
    const now = node.getBoundingClientRect();
    const dx = prev.left - now.left, dy = prev.top - now.top;
    if (!dx && !dy) continue;
    node.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: 220, easing: "cubic-bezier(.2,.7,.3,1)" }
    );
  }
}

function more() {
  if (shown >= current.length) return;
  const next = current.slice(shown, shown + state.batch);
  shown += next.length;
  sentinel.remove();
  list.append(...next.map(card), sentinel);
  updateEnd();
}

function render({ animate = true } = {}) {
  const before = animate ? positions() : new Map();

  current = filtered();
  shown = Math.min(state.batch, current.length);
  list.replaceChildren(...current.slice(0, shown).map(card), sentinel);

  flip(before);
  updateMeta();
  updateEnd();
  io.disconnect();
  io.observe(sentinel);
}

function updateMeta() {
  if (state.tab !== "feed") return;
  const bits = [
    `${current.length} of ${DATA.stories.length} stories`,
    `updated ${ago(DATA.generated)}`,
  ];
  if (DATA.failed.length) {
    bits.push(`${DATA.failed.length} feed${DATA.failed.length > 1 ? "s" : ""} failed — not displaying`);
  }
  meta.textContent = bits.join("  ·  ");
  meta.classList.toggle("warn", DATA.failed.length > 0);
  meta.title = DATA.failed.length ? "Failed: " + DATA.failed.join(", ") : "";
}

function updateEnd() {
  if (!current.length) endNote.textContent = "Nothing matches those filters.";
  else if (shown >= current.length) endNote.textContent = `— end · ${current.length} shown —`;
  else endNote.textContent = `${shown} of ${current.length} · scroll for more`;
}


// ─────────────────────────────── data tab ──────────────────────────────

function spark(series, w = 132, h = 30) {
  const vals = series.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = (max - min) || 1;
  const x = (i) => (i / (vals.length - 1 || 1)) * w;
  const y = (v) => h - ((v - min) / range) * (h - 4) - 2;

  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("class", "spark");
  svg.setAttribute("aria-hidden", "true");

  const fill = document.createElementNS(SVGNS, "polygon");
  fill.setAttribute("class", "spark-fill");
  fill.setAttribute("points",
    `0,${h} ` + vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ") + ` ${w},${h}`);

  const line = document.createElementNS(SVGNS, "polyline");
  line.setAttribute("class", "spark-line");
  line.setAttribute("points", vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" "));

  const dot = document.createElementNS(SVGNS, "circle");
  dot.setAttribute("class", "spark-dot");
  dot.setAttribute("cx", x(vals.length - 1).toFixed(1));
  dot.setAttribute("cy", y(vals.at(-1)).toFixed(1));
  dot.setAttribute("r", "2.4");

  svg.append(fill, line, dot);
  return svg;
}

function fmt(v, unit) {
  const abs = Math.abs(v);
  const digits = unit === "%" ? 1 : abs < 10 ? 4 : 1;
  return v.toFixed(digits) + (unit || "");
}

function tile(ind) {
  const box = el("div", "tile");

  const top = el("div", "tile-top");
  top.append(el("span", "tile-label", ind.label), el("span", "tile-agency", ind.agency));

  const row = el("div", "tile-row");
  row.append(el("strong", "tile-value", fmt(ind.value, ind.unit)));

  if (ind.change !== null && ind.change !== undefined) {
    // Round first: a change that displays as 0.0 is flat, whatever its sign.
    const shown = fmt(Math.abs(ind.change), ind.unit);
    const isZero = parseFloat(shown) === 0;
    const dir = isZero ? "flat" : ind.change > 0 ? "up" : "down";
    const arrow = { up: "▲", down: "▼", flat: "–" }[dir];
    row.append(el("span", `tile-change ${dir}`,
      isZero ? `${arrow} no change` : `${arrow} ${shown}`));
  }

  box.append(top, row, spark(ind.series), el("div", "tile-period", ind.period));
  box.title = `${ind.label} · ${ind.geoLabel} · ${ind.agency}\n` +
              `${ind.series.length} points, ${ind.series[0].period} to ${ind.period}`;
  return box;
}

function renderData() {
  tiles.replaceChildren();

  if (!IND || !IND.indicators.length) {
    tiles.append(el("p", "empty", "No indicators.js — run:  uv run indicators.py"));
    return;
  }

  const groups = new Map();
  for (const ind of IND.indicators) {
    if (!groups.has(ind.geoLabel)) groups.set(ind.geoLabel, []);
    groups.get(ind.geoLabel).push(ind);
  }

  const order = [...groups.keys()].sort(
    (a, b) => (GEO_ORDER.indexOf(a) + 1 || 99) - (GEO_ORDER.indexOf(b) + 1 || 99)
  );

  for (const geo of order) {
    const section = el("section", "tile-group");
    section.append(el("h2", "group-title", geo));
    const grid = el("div", "tile-grid");
    grid.append(...groups.get(geo).map(tile));
    section.append(grid);
    tiles.append(section);
  }
}


// ────────────────────────────── reports ───────────────────────────────
// Slow, considered pieces. A few items a week each, so recency ranking
// against 875 daily stories made them invisible. Their own surface, whole
// 30-day store, no filters — there is little enough to just read it.

// Region, country and read state are shared with News — they are "what am I
// interested in". Time is not: reports publish every few days, so they keep
// their own window, defaulting to 30 days.
function filteredReports() {
  const cutoff = Date.now() - state.reportHours * 3600e3;
  return DATA.stories.filter((s) => {
    if (s.kind !== "report") return false;
    if (new Date(s.published).getTime() < cutoff) return false;
    if (state.region !== "all" && s.region !== state.region) return false;
    if (state.country !== "all" && !s.countries.includes(state.country)) return false;
    if (state.view === "unread" && read.has(s.id)) return false;
    if (state.view === "read" && !read.has(s.id)) return false;
    return true;
  }).sort((a, b) => new Date(b.published) - new Date(a.published));
}

let reportCount = 0;

function renderReports() {
  const items = filteredReports();
  reportCount = items.length;
  reportList.replaceChildren();
  if (!items.length) {
    reportList.append(el("p", "empty", "No reports match those filters."));
    return;
  }
  reportList.append(...items.map(card));
}

function updateReportsMeta() {
  const total = DATA.stories.filter((s) => s.kind === "report").length;
  const sources = new Set(filteredReports().map((s) => s.source)).size;
  meta.textContent = `${reportCount} of ${total} reports  ·  ${sources} source${sources === 1 ? "" : "s"}`;
  meta.classList.remove("warn");
  meta.title = "";
}



// ─────────────────────────────── summary ───────────────────────────────
// Two halves. The market half is arithmetic and always present. The news
// half is written by a model and may be missing — the brief still shows.

function pctText(v) { return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`; }

function marketBlock(m) {
  const box = el("section", "brief-market");
  box.append(el("h3", "brief-market-name", m.label));
  const grid = el("div", "brief-lines");

  for (const i of m.indices) {
    const line = el("div", "brief-line index");
    line.append(el("span", "bl-name", i.name), pctCell(i.change, "pct"));
    grid.append(line);
  }
  for (const b of m.bonds) {
    const line = el("div", "brief-line bond");
    line.append(el("span", "bl-name", `${b.name} · ${b.yield.toFixed(2)}%`), pctCell(b.change, "bp"));
    grid.append(line);
  }
  const movers = (items, label, cls) => {
    if (!items.length) return;
    grid.append(el("div", `brief-movers-label ${cls}`, label));
    for (const v of items) {
      const line = el("div", "brief-line");
      line.append(el("span", "bl-name", v.name), pctCell(v.change, "pct"));
      grid.append(line);
    }
  };
  movers(m.risers, "Top movers", "up");
  movers(m.fallers, "Low movers", "down");

  box.append(grid);
  return box;
}

function renderSummary() {
  const host = $("brief");
  host.replaceChildren();

  if (!SUM) {
    host.append(el("p", "empty", "No summary.js — run:  uv run summarise.py"));
    return;
  }

  const written = SUM.news.filter((n) => n.text);
  const head = el("header", "brief-head");
  head.append(el("h2", null, `Brief for ${SUM.day}`));
  head.append(el("p", "brief-sub",
    `${SUM.window_hours}h of news · ${written.length} of ${SUM.news.length} sections written`));
  host.append(head);

  if (!written.length) {
    host.append(el("p", "brief-warn",
      "No written sections today — the model was unavailable. Market figures below are unaffected."));
  }

  for (const n of SUM.news) {
    if (!n.text) continue;
    const sec = el("section", "brief-news");
    const h = el("h3", "brief-cat", n.label);
    h.append(el("span", "brief-count", `${n.count} stories`));
    sec.append(h, el("p", null, n.text));
    host.append(sec);
  }

  const mk = el("section", "brief-markets");
  const win = (SUM.markets[0] || {}).window || "1M";
  mk.append(el("h3", "brief-cat", `Markets · ${win === "1M" ? "month on month" : win}`));
  const wrap = el("div", "brief-market-grid");
  wrap.append(...SUM.markets.map(marketBlock));
  mk.append(wrap);
  host.append(mk);
}

function updateSummaryMeta() {
  if (!SUM) { meta.textContent = "No brief yet"; return; }
  const missing = SUM.news.filter((n) => !n.text).length;
  const bits = [`brief for ${SUM.day}`, `written ${ago(SUM.generated)}`, SUM.model];
  if (missing) bits.push(`${missing} section${missing > 1 ? "s" : ""} missing`);
  meta.textContent = bits.join("  ·  ");
  meta.classList.toggle("warn", missing > 0);
}

// ─────────────────────────────── markets ───────────────────────────────
// One row per security. The window buttons switch which of the nine
// precomputed changes is shown — no recalculation, the numbers already
// arrived that way from markets.py.

function pctCell(v, metric) {
  const cell = el("span", "pct");
  if (v === undefined || v === null) {
    cell.textContent = "–";
    cell.classList.add("flat");
    cell.title = "no data at this resolution";
    return cell;
  }
  const sign = v > 0 ? "+" : "";
  cell.textContent = metric === "bp" ? `${sign}${v.toFixed(0)} bp` : `${sign}${v.toFixed(2)}%`;
  cell.classList.add(v > 0 ? "up" : v < 0 ? "down" : "flat");
  return cell;
}

function marketRow(r) {
  const row = el("div", "mrow");
  if (r.kind === "index") row.classList.add("is-index");
  if (r.kind === "bond") row.classList.add("is-bond");

  const left = el("div", "mrow-id");
  left.append(el("span", "mname", r.name), el("span", "mticker", r.symbol));

  const price = el("span", "mprice",
    r.metric === "bp" ? `${r.price.toFixed(2)}%`
                      : r.price.toLocaleString(undefined, { maximumFractionDigits: 2 }));
  price.title = `${r.currency} · history since ${r.since}`;

  row.append(left, price, pctCell(r.changes[state.window], r.metric), spark(
    r.spark.map((v, i) => ({ period: i, value: v })), 110, 26));
  const unit = r.metric === "bp" ? "bp" : "%";
  row.title = MKT.windows
    .map((w) => `${w}: ${r.changes[w] === undefined ? "–" : r.changes[w] + unit}`)
    .join("   ");
  return row;
}

function marketRows() {
  return MKT.rows.filter((r) => {
    if (state.market !== "all" && r.market !== state.market) return false;
    if (state.kind !== "all" && r.kind !== state.kind) return false;
    return true;
  });
}

function renderMarkets() {
  const host = $("rows");
  host.replaceChildren();
  if (!MKT) { host.append(el("p", "empty", "No markets.js — run:  uv run markets.py")); return; }

  const rows = marketRows();
  if (!rows.length) { host.append(el("p", "empty", "Nothing matches those filters.")); return; }

  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.market)) groups.set(r.market, []);
    groups.get(r.market).push(r);
  }
  for (const [id, items] of groups) {
    const section = el("section", "mgroup");
    section.append(el("h2", "group-title", MKT.markets[id]));
    const body = el("div", "mtable");
    body.append(...items.map(marketRow));
    section.append(body);
    host.append(section);
  }
}

function updateMarketsMeta() {
  if (!MKT) { meta.textContent = "No market data yet"; return; }
  const n = marketRows().length;
  const bits = [`${n} of ${MKT.rows.length} securities`, `${state.window} change`,
                `updated ${ago(MKT.generated)}`];
  if (MKT.failed.length) bits.push(`${MKT.failed.length} failed`);
  meta.textContent = bits.join("  ·  ");
  meta.classList.toggle("warn", MKT.failed.length > 0);
  meta.title = MKT.failed.length ? "Failed: " + MKT.failed.join(", ") : "";
}

function buildMarketControls() {
  if (!MKT) return;
  segment($("window"), MKT.windows.map((w) => [w, w]), () => state.window, (v) => {
    state.window = v; store.set("window", v);
    syncSegment($("window"), () => state.window);
    renderMarkets(); updateMarketsMeta();
  });
  segment($("kind"), KINDS, () => state.kind, (v) => {
    state.kind = v; store.set("kind", v);
    syncSegment($("kind"), () => state.kind);
    renderMarkets(); updateMarketsMeta();
  });
  const sel = $("market");
  sel.replaceChildren();
  const all = el("option", null, "All markets"); all.value = "all"; sel.append(all);
  for (const [id, label] of Object.entries(MKT.markets)) {
    const o = el("option", null, label); o.value = id; sel.append(o);
  }
  sel.value = state.market;
  sel.addEventListener("change", () => {
    state.market = sel.value; store.set("market", state.market);
    renderMarkets(); updateMarketsMeta();
  });
}

// ─────────────────────────────── tabs ──────────────────────────────────

function bindTime() {
  const onReports = state.tab === "reports";
  segment($("time"), HOURS,
    () => (onReports ? state.reportHours : state.hours),
    (v) => {
      if (onReports) { state.reportHours = v; store.set("reportHours", v); }
      else { state.hours = v; store.set("hours", v); }
      syncAll();
      onReports ? (renderReports(), updateReportsMeta()) : render();
    });
}

function showTab(name) {
  state.tab = name;
  store.set("tab", name);

  for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== name;
  feedControls.hidden = name !== "feed" && name !== "reports";
  for (const node of document.querySelectorAll(".only-feed")) node.hidden = name !== "feed";
  bindTime();

  for (const b of $("tabs").children) {
    b.setAttribute("aria-selected", String(b.dataset.value === name));
  }

  if (name === "summary") { renderSummary(); updateSummaryMeta(); }
  else if (name === "data") { renderData(); updateDataMeta(); }
  else if (name === "markets") { renderMarkets(); updateMarketsMeta(); }
  else if (name === "reports") { renderReports(); updateReportsMeta(); }
  else { render({ animate: false }); }
}

function updateDataMeta() {
  if (!IND) { meta.textContent = "No indicators yet"; return; }
  const bits = [`${IND.indicators.length} indicators`, `updated ${ago(IND.generated)}`];
  if (IND.failed.length) bits.push(`${IND.failed.length} failed`);
  meta.textContent = bits.join("  ·  ");
  meta.classList.toggle("warn", IND.failed.length > 0);
  meta.title = IND.failed.length ? "Failed: " + IND.failed.join(", ") : "";
}

function buildTabs() {
  const host = $("tabs");
  host.replaceChildren();
  for (const [label, value] of TABS) {
    const b = el("button", "tab", label);
    b.type = "button";
    b.dataset.value = value;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(state.tab === value));
    b.addEventListener("click", () => showTab(value));
    host.append(b);
  }
}

// ─────────────────────────────── controls ──────────────────────────────

function segment(host, options, get, set) {
  host.replaceChildren();
  for (const [label, value] of options) {
    const b = el("button", "seg-btn", label);
    b.type = "button";
    b.dataset.value = String(value);
    b.setAttribute("aria-pressed", String(get() === value));
    b.addEventListener("click", () => { set(value); });
    host.append(b);
  }
}

function syncSegment(host, get) {
  for (const b of host.children) {
    const v = b.dataset.value;
    const on = String(get()) === v;
    b.setAttribute("aria-pressed", String(on));
  }
}

function buildCategories() {
  const cats = $("cats");
  const opts = [["All", "all"], ...DATA.categories.map((c) => [c.label, c.slug]), ["Markets", "markets"]];
  cats.replaceChildren();
  for (const [label, slug] of opts) {
    const b = el("button", "cat-btn", label);
    b.type = "button";
    b.dataset.value = slug;
    if (slug === "markets") {
      b.disabled = true;
      b.title = "Portfolio panel — P1, not built yet";
    }
    b.setAttribute("aria-pressed", String(state.category === slug));
    b.addEventListener("click", () => {
      state.category = slug; store.set("category", slug);
      syncAll(); render();
    });
    cats.append(b);
  }
}

function buildCountries() {
  const sel = $("country");
  const counts = new Map();
  for (const s of DATA.stories) {
    if (state.region !== "all" && s.region !== state.region) continue;
    for (const c of s.countries) counts.set(c, (counts.get(c) || 0) + 1);
  }
  const names = DATA.countries;
  const opts = [...counts.entries()]
    .sort((a, b) => names[a[0]].localeCompare(names[b[0]]));

  sel.replaceChildren();
  const all = el("option", null, "All countries");
  all.value = "all";
  sel.append(all);
  for (const [code, n] of opts) {
    const o = el("option", null, `${names[code]} (${n})`);
    o.value = code;
    sel.append(o);
  }
  if (![...sel.options].some((o) => o.value === state.country)) {
    state.country = "all";
    store.set("country", "all");
  }
  sel.value = state.country;
}

function refresh() {
  if (state.tab === "reports") { renderReports(); updateReportsMeta(); }
  else render();
}

function syncAll() {
  for (const b of $("cats").children) {
    b.setAttribute("aria-pressed", String(b.dataset.value === state.category));
  }
  syncSegment($("time"), () => (state.tab === "reports" ? state.reportHours : state.hours));
  syncSegment($("view"), () => state.view);
  syncSegment($("sources"), () => state.sources);
  syncSegment($("batch"), () => state.batch);
  $("region").value = state.region;
  buildCountries();
}

function build() {
  buildCategories();

  const region = $("region");
  region.replaceChildren();
  for (const [label, value] of REGIONS) {
    const o = el("option", null, label);
    o.value = value;
    region.append(o);
  }
  region.value = state.region;
  region.addEventListener("change", () => {
    state.region = region.value; store.set("region", state.region);
    state.country = "all"; store.set("country", "all");
    buildCountries(); refresh();
  });

  $("country").addEventListener("change", (e) => {
    state.country = e.target.value; store.set("country", state.country);
    refresh();
  });

  segment($("sources"), SOURCES, () => state.sources, (v) => {
    state.sources = v; store.set("sources", v); syncAll(); render();
  });

  segment($("view"), VIEWS, () => state.view, (v) => {
    state.view = v; store.set("view", v); syncAll(); refresh();
  });

  segment($("batch"), BATCH.map((n) => [String(n), n]), () => state.batch, (v) => {
    state.batch = v; store.set("batch", v); syncAll(); render({ animate: false });
  });

  $("reset").addEventListener("click", () => {
    state.reportHours = 720; store.set("reportHours", 720);
    Object.assign(state, { category: "all", region: "all", country: "all", hours: 24, view: "all", batch: 25, sources: "all" });
    for (const k of ["category", "region", "country", "hours", "view", "batch", "sources"]) store.set(k, state[k]);
    buildCategories(); syncAll(); bindTime(); refresh();
  });

  buildCountries();
}

// ─────────────────────────────── start ─────────────────────────────────

if (!DATA) {
  meta.textContent = "No data.js — run:  uv run fetch.py";
} else {
  build();
  buildMarketControls();
  buildTabs();
  showTab(state.tab);
}
