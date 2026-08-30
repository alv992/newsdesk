// Markets tab: securities, timeframe windows, market and kind filters.
import { load, harness } from "./helpers.mjs";

const { d, w, tab, press, pick, meta } = load();
const t = harness("Markets");

tab("markets");
const rows = () => d.querySelectorAll(".mrow").length;
const total = w.MARKETS.rows.length;

t.ok("four tabs", d.querySelectorAll("#tabs .tab").length === 4,
     [...d.querySelectorAll("#tabs .tab")].map((x) => x.textContent).join(" | "));
t.ok("rows render", rows() === total, `(${rows()} of ${total})`);
t.ok("nine windows offered", d.querySelectorAll("#window .seg-btn").length === 9,
     [...d.querySelectorAll("#window .seg-btn")].map((b) => b.textContent).join(" "));
t.ok("defaults to DoD", d.querySelector('#window .seg-btn[aria-pressed="true"]').textContent === "DoD");
t.ok("one sparkline per row", d.querySelectorAll(".mrow svg.spark").length === total);
t.ok("indices marked apart", d.querySelectorAll(".mrow.is-index").length > 0,
     `(${d.querySelectorAll(".mrow.is-index").length} indices)`);
t.ok("grouped by market", d.querySelectorAll("#rows .group-title").length > 1,
     `(${d.querySelectorAll("#rows .group-title").length} groups)`);

// Switching window must change the numbers, not refetch anything.
const before = [...d.querySelectorAll(".pct")].map((e) => e.textContent).join("|");
press("#window .seg-btn", "1Y");
const after = [...d.querySelectorAll(".pct")].map((e) => e.textContent).join("|");
t.ok("window switch changes the figures", before !== after);
t.ok("meta names the window", /1Y change/.test(meta()), meta());
press("#window .seg-btn", "DoD");

pick("market", "es");
const spain = rows();
t.ok("market filter narrows", spain < total, `(${spain} of ${total})`);
t.ok("only one group left", d.querySelectorAll("#rows .group-title").length === 1);
pick("market", "all");

press("#kind .seg-btn", "index");
const idx = rows();
t.ok("Indices only", idx < total && idx > 0, `(${idx})`);
t.ok("every row is an index", d.querySelectorAll(".mrow:not(.is-index)").length === 0);
press("#kind .seg-btn", "stock");
t.ok("Stocks only", rows() === total - idx, `(${rows()})`);
press("#kind .seg-btn", "all");

t.ok("percentages carry a sign", [...d.querySelectorAll(".pct")].some((e) => /^[+-]/.test(e.textContent)));
t.ok("choices persist", JSON.parse(w.localStorage.getItem("newsdesk:window")) === "DoD");

tab("feed");
t.ok("News still works", d.querySelectorAll("#panel-feed .card").length > 0);

t.done();
