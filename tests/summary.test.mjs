// Summary tab: the market half is arithmetic and must always be present;
// the news half is written by a model and is allowed to be missing.
import { load, harness } from "./helpers.mjs";

const { d, w, tab, meta } = load();
const t = harness("Summary");

tab("summary");
t.ok("five tabs", d.querySelectorAll("#tabs .tab").length === 5,
     [...d.querySelectorAll("#tabs .tab")].map((x) => x.textContent).join(" | "));
t.ok("summary is the default tab", JSON.parse(w.localStorage.getItem("newsdesk:tab")) === "summary");
t.ok("brief renders", d.querySelectorAll("#brief .brief-head").length === 1);
t.ok("meta names the day", /brief for \d{4}-\d{2}-\d{2}/.test(meta()), meta());

const markets = d.querySelectorAll(".brief-market").length;
t.ok("market half present", markets > 0, `(${markets} blocks)`);
t.ok("every market block has figures",
     [...d.querySelectorAll(".brief-market")].every((b) => b.querySelectorAll(".brief-line").length > 0));

// The whole point of D20: numbers come from the same arithmetic as the
// Markets tab, so the two can never disagree.
const win = w.SUMMARY.markets[0].window;
t.ok("brief uses month on month", win === "1M", `(${win})`);

const brief = w.SUMMARY.markets.flatMap((m) => [...m.risers, ...m.fallers].map((v) => [v.symbol, v.change]));
const rows = new Map(w.MARKETS.rows.map((r) => [r.symbol, r.changes[win]]));
t.ok("brief figures match the Markets tab exactly",
     brief.every(([sym, chg]) => rows.get(sym) === chg), `(${brief.length} movers checked)`);

t.ok("risers descend", w.SUMMARY.markets.every((m) =>
     m.risers.every((v, i) => i === 0 || m.risers[i - 1].change >= v.change)));
t.ok("fallers ascend from the worst", w.SUMMARY.markets.every((m) =>
     m.fallers.every((v, i) => i === 0 || m.fallers[i - 1].change <= v.change)));
t.ok("no stock is both a riser and a faller", w.SUMMARY.markets.every((m) => {
     const up = new Set(m.risers.map((v) => v.symbol));
     return m.fallers.every((v) => !up.has(v.symbol)); }));
t.ok("bonds carry a yield and a change",
     w.SUMMARY.markets.flatMap((m) => m.bonds).every((b) => b.yield > 0 && b.change !== null));

const written = w.SUMMARY.news.filter((n) => n.points && n.points.length);
t.note(`${written.length} of ${w.SUMMARY.news.length} sections written by ${w.SUMMARY.model}`);
t.ok("sections render as bullet lists", d.querySelectorAll("ul.brief-points").length === written.length);
t.ok("one to five bullets per section", written.every((n) => n.points.length >= 1 && n.points.length <= 5),
     written.map((n) => n.points.length).join(","));
t.ok("bullets render as list items",
     d.querySelectorAll(".brief-points li").length === written.reduce((a, n) => a + n.points.length, 0));

// Small models drift: a stray heading, a numbered list, a trailing note.
const all = written.flatMap((n) => n.items ? n.items.filter((i) => i.status === "summarized").map((i) => i.text) : n.points);
t.ok("no leftover bullet markers", all.every((p) => !/^\s*(?:[-*\u2022]|\d+[.)])/.test(p)),
     all.find((p) => /^\s*(?:[-*\u2022]|\d+[.)])/.test(p)) || "");
t.ok("every bullet is one line", all.every((p) => !p.includes("\n")));
t.ok("every bullet ends in punctuation", all.every((p) => /[.!?]$/.test(p)),
     all.find((p) => !/[.!?]$/.test(p)) || "");
// Event identity is established before generation, independently of wording.
t.ok("each selected event appears once per category", written.every((n) => {
  const ids = n.items ? n.items.map((i) => i.event_id) : n.points;
  return new Set(ids).size === ids.length;
}));
t.ok("missing sections are flagged, not hidden silently",
     written.length === w.SUMMARY.news.length || d.querySelectorAll(".brief-warn").length > 0);

tab("feed");
t.ok("News still works", d.querySelectorAll("#panel-feed .card").length > 0);
t.done();
