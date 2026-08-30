// Data tab: indicator tiles from the World Bank and the ECB.
import { load, harness } from "./helpers.mjs";

const { d, w, tab, meta } = load();
const t = harness("Data · indicators");

tab("data");
const tiles = d.querySelectorAll(".tile").length;
t.ok("tiles render", tiles > 0, `(${tiles})`);
t.ok("one sparkline per tile", d.querySelectorAll("svg.spark").length === tiles);
t.ok("meta counts indicators", /\d+ indicators/.test(meta()), meta());

const groups = [...d.querySelectorAll(".group-title")].map((g) => g.textContent);
t.ok("grouped by geography", groups.length > 1, groups.join(" / "));
t.ok("world first, spain last",
     groups.indexOf("World") < groups.indexOf("Spain"), groups.join(" / "));

// Direction is an arrow only. Inflation rising and GDP rising are both "up"
// and mean opposite things, so no good/bad colour is applied.
const changes = [...d.querySelectorAll(".tile-change")].map((c) => c.textContent);
t.ok("changes show direction", changes.length > 0, `(${changes.length})`);
// An arrow next to a value that rounds to zero is noise. A small but real
// move (EUR/USD shifting 0.0002) is not — it should still be shown.
const zeroArrow = changes.find((c) => {
  const m = c.match(/[▲▼]\s*([\d.]+)/);
  return m && parseFloat(m[1]) === 0;
});
t.ok("an arrow never sits next to a zero", !zeroArrow, zeroArrow || "");

t.ok("every series carries history",
     w.INDICATORS.indicators.every((i) => i.series.length > 1),
     `(${Math.min(...w.INDICATORS.indicators.map((i) => i.series.length))} points minimum)`);

tab("feed");
t.ok("News still works after switching", d.querySelectorAll("#panel-feed .card").length > 0);

t.done();
