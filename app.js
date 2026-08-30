// Newsdesk — the page.
//
// window.DATA arrives from data.js, loaded by a <script> tag in index.html.
// Everything below runs over that array in memory: no requests, no server.
// fetch.py ingests and tags. This file filters, sorts and renders.

const DATA = window.DATA;
const IND = window.INDICATORS;
const SVGNS = "http://www.w3.org/2000/svg";

const $ = (id) => document.getElementById(id);
const list = $("list"), meta = $("meta"), endNote = $("end");
const tiles = $("tiles"), feedControls = $("feed-controls"), reportList = $("reports");
const panels = { feed: $("panel-feed"), reports: $("panel-reports"), data: $("panel-data") };

const HOURS = [["24h", 24], ["48h", 48], ["7d", 168], ["30d", 720]];
const VIEWS = [["All", "all"], ["Unread", "unread"], ["Read", "read"]];
const BATCH = [25, 50, 100];
const REGIONS = [["All", "all"], ["World", "world"], ["Europe", "europe"], ["Spain", "spain"]];
const TABS = [["News feed", "feed"], ["Reports", "reports"], ["Data", "data"]];
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
  tab:      store.get("tab", "feed"),
  sources:  store.get("sources", "all") === "vetted" ? "news" : store.get("sources", "all"),
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

function renderReports() {
  const items = DATA.stories
    .filter((s) => s.kind === "report")
    .sort((a, b) => new Date(b.published) - new Date(a.published));

  reportList.replaceChildren();

  if (!items.length) {
    reportList.append(el("p", "empty", "No reports in the last 30 days."));
    return;
  }
  reportList.append(...items.map(card));
}

function updateReportsMeta() {
  const n = DATA.stories.filter((s) => s.kind === "report").length;
  const sources = new Set(DATA.stories.filter((s) => s.kind === "report").map((s) => s.source));
  meta.textContent = `${n} reports from ${sources.size} sources  ·  last 30 days`;
  meta.classList.remove("warn");
  meta.title = "";
}

// ─────────────────────────────── tabs ──────────────────────────────────

function showTab(name) {
  state.tab = name;
  store.set("tab", name);

  for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== name;
  feedControls.hidden = name !== "feed";

  for (const b of $("tabs").children) {
    b.setAttribute("aria-selected", String(b.dataset.value === name));
  }

  if (name === "data") { renderData(); updateDataMeta(); }
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

function syncAll() {
  for (const b of $("cats").children) {
    b.setAttribute("aria-pressed", String(b.dataset.value === state.category));
  }
  syncSegment($("time"), () => state.hours);
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
    buildCountries(); render();
  });

  $("country").addEventListener("change", (e) => {
    state.country = e.target.value; store.set("country", state.country);
    render();
  });

  segment($("time"), HOURS, () => state.hours, (v) => {
    state.hours = v; store.set("hours", v); syncAll(); render();
  });

  segment($("sources"), SOURCES, () => state.sources, (v) => {
    state.sources = v; store.set("sources", v); syncAll(); render();
  });

  segment($("view"), VIEWS, () => state.view, (v) => {
    state.view = v; store.set("view", v); syncAll(); render();
  });

  segment($("batch"), BATCH.map((n) => [String(n), n]), () => state.batch, (v) => {
    state.batch = v; store.set("batch", v); syncAll(); render({ animate: false });
  });

  $("reset").addEventListener("click", () => {
    Object.assign(state, { category: "all", region: "all", country: "all", hours: 24, view: "all", batch: 25, sources: "all" });
    for (const k of ["category", "region", "country", "hours", "view", "batch", "sources"]) store.set(k, state[k]);
    buildCategories(); syncAll(); render();
  });

  buildCountries();
}

// ─────────────────────────────── start ─────────────────────────────────

if (!DATA) {
  meta.textContent = "No data.js — run:  uv run fetch.py";
} else {
  build();
  buildTabs();
  showTab(state.tab);
}
