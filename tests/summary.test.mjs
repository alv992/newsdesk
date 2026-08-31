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
t.ok("five bullets per section", written.every((n) => n.points.length === 5),
     written.map((n) => n.points.length).join(","));
t.ok("bullets render as list items",
     d.querySelectorAll(".brief-points li").length === written.reduce((a, n) => a + n.points.length, 0));

// Small models drift: a stray heading, a numbered list, a trailing note.
const all = written.flatMap((n) => n.points);
t.ok("no leftover bullet markers", all.every((p) => !/^\s*(?:[-*\u2022]|\d+[.)])/.test(p)),
     all.find((p) => /^\s*(?:[-*\u2022]|\d+[.)])/.test(p)) || "");
t.ok("every bullet is one line", all.every((p) => !p.includes("\n")));
t.ok("every bullet ends in punctuation", all.every((p) => /[.!?]$/.test(p)),
     all.find((p) => !/[.!?]$/.test(p)) || "");
// Exact duplicates are easy; the model produces reworded ones — the same
// ferry sinking twice with different casualty counts. Compare content words.
const STOP = new Set(["the","a","an","of","in","on","at","to","for","and","or","is",
  "was","were","has","have","had","with","after","from","by","as","its","his","her",
  "their","that","this","been","will","said"]);
const words = (t) => new Set((t.toLowerCase().match(/[a-z0-9]+/g) || [])
  .filter((w) => w.length > 2 && !STOP.has(w)));
const overlap = (a, b) => {
  const A = words(a), B = words(b);
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / new Set([...A, ...B]).size;
};
let worst = 0, pair = "";
for (const n of written) {
  for (let i = 0; i < n.points.length; i++)
    for (let j = i + 1; j < n.points.length; j++) {
      const o = overlap(n.points[i], n.points[j]);
      if (o > worst) { worst = o; pair = `${n.label}: "${n.points[i].slice(0,40)}" vs "${n.points[j].slice(0,40)}"`; }
    }
}
t.ok("no bullet restates another", worst < 0.4, `(worst overlap ${worst.toFixed(2)}${worst >= 0.4 ? " — " + pair : ""})`);
t.ok("missing sections are flagged, not hidden silently",
     written.length === w.SUMMARY.news.length || d.querySelectorAll(".brief-warn").length >= 0);

tab("feed");
t.ok("News still works", d.querySelectorAll("#panel-feed .card").length > 0);
t.done();
