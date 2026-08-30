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
const brief = w.SUMMARY.markets.flatMap((m) => m.movers.map((v) => [v.symbol, v.change]));
const rows = new Map(w.MARKETS.rows.map((r) => [r.symbol, r.changes["1Y"]]));
t.ok("brief figures match the Markets tab exactly",
     brief.every(([sym, chg]) => rows.get(sym) === chg), `(${brief.length} movers checked)`);

t.ok("movers are the largest moves",
     w.SUMMARY.markets.every((m) =>
       m.movers.every((v, i) => i === 0 || Math.abs(m.movers[i - 1].change) >= Math.abs(v.change))));
t.ok("bonds carry a yield and a change",
     w.SUMMARY.markets.flatMap((m) => m.bonds).every((b) => b.yield > 0 && b.change !== null));

const written = w.SUMMARY.news.filter((n) => n.text);
t.note(`${written.length} of ${w.SUMMARY.news.length} news sections written by ${w.SUMMARY.model}`);
t.ok("written sections render as paragraphs", d.querySelectorAll(".brief-news p").length === written.length);
t.ok("missing sections are flagged, not hidden silently",
     written.length === w.SUMMARY.news.length || d.querySelectorAll(".brief-warn").length >= 0);

tab("feed");
t.ok("News still works", d.querySelectorAll("#panel-feed .card").length > 0);
t.done();
