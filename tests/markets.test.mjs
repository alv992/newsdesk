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
t.ok("four kinds offered", d.querySelectorAll("#kind .seg-btn").length === 4,
     [...d.querySelectorAll("#kind .seg-btn")].map((b) => b.textContent).join(" "));
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
press("#kind .seg-btn", "bond");
const bonds = rows();
t.ok("Bonds only", bonds > 0 && bonds < total, `(${bonds})`);
t.ok("bond changes are basis points, not percent",
     [...d.querySelectorAll(".mrow .pct")].every((e) => /bp$|^–$/.test(e.textContent)),
     [...d.querySelectorAll(".mrow .pct")].map((e) => e.textContent).slice(0, 3).join(" "));
t.ok("bond prices show as a yield",
     [...d.querySelectorAll(".mrow .mprice")].every((e) => e.textContent.endsWith("%")));

press("#kind .seg-btn", "stock");
t.ok("Stocks only", rows() === total - idx - bonds,
     `(${rows()} = ${total} - ${idx} indices - ${bonds} bonds)`);
press("#kind .seg-btn", "all");

// Monthly national series genuinely have no daily resolution. Blank is the
// honest answer there; inventing a daily figure would not be.
const monthly = w.MARKETS.rows.filter((r) => r.kind === "bond" && r.symbol.startsWith("M."));
t.ok("monthly bonds leave DoD blank", monthly.length > 0 && monthly.every((r) => r.changes.DoD === undefined),
     `(${monthly.length} national series)`);
t.ok("daily bonds do fill DoD",
     w.MARKETS.rows.filter((r) => r.kind === "bond" && r.symbol.startsWith("^"))
       .every((r) => r.changes.DoD !== undefined));

// index, then bonds, then stocks
const us = w.MARKETS.rows.filter((r) => r.market === "us").map((r) => r.kind);
t.ok("indices lead each market", us[0] === "index");
const order = { index: 0, bond: 1, stock: 2 };
t.ok("kinds stay in order within a market",
     us.every((k, i) => i === 0 || order[k] >= order[us[i - 1]]));

t.ok("percentages carry a sign", [...d.querySelectorAll(".pct")].some((e) => /^[+-]/.test(e.textContent)));
t.ok("choices persist", JSON.parse(w.localStorage.getItem("newsdesk:window")) === "DoD");

tab("feed");
t.ok("News still works", d.querySelectorAll("#panel-feed .card").length > 0);

t.done();
