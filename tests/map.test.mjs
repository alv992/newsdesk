import fs from "fs";
import path from "path";
import { load, harness, ROOT } from "./helpers.mjs";
const t = harness("Map tab");

const story = (id, countries, extra = {}) => ({ id, countries, category: "geopolitics", region: "world",
  title: id, summary: "", source: "Fixture", tier: 2, url: `https://example.com/${id}`, ...extra });
// Times are relative to the data file's capture time, which the tests replay.
const data = fs.readFileSync(path.join(ROOT, "data.js"), "utf8");
const generated = new Date(JSON.parse(data.slice(data.indexOf("{"), data.lastIndexOf("}") + 1)).generated);
const daysAgo = (n) => new Date(generated - n * 86400e3).toISOString();

const stories = [
  ...Array.from({ length: 12 }, (_, i) => story(`iran-${i}`, ["IR"])),
  story("france", ["FR"]),
  story("lebanon", ["LB"]),
  story("malta", ["MT"]),
  story("japan-3-days", ["JP"], { published: daysAgo(3) }),
  story("report", ["DE"], { kind: "report" }),
];

const { w, d, tab, press } = load({ stories });
const map = d.getElementById("map");
const rows = () => [...d.querySelectorAll("#map-list .map-row")];
const listed = () => rows().map((r) => r.dataset.code);
const cell = (code) => map.querySelector(`[data-code="${code}"]`);

tab("map");
t.ok("tab is shown", !d.getElementById("panel-map").hidden && d.getElementById("panel-feed").hidden);
t.ok("filters stay hidden", d.getElementById("feed-controls").hidden);
t.ok("map draws Braille lines", map.querySelectorAll(".map-line").length > 5 &&
     /^[⠀-⣿]+$/.test(map.textContent));
t.ok("ocean and land both drawn", map.textContent.includes("⠀") && map.textContent.includes("⣿"));
t.ok("Iran is shaded tier 3 (10–29)", cell("IR")?.classList.contains("t3"));
t.ok("France is shaded tier 1", cell("FR")?.classList.contains("t1"));
t.ok("country without news is neutral", cell("BR")?.classList.contains("t0"));
t.ok("tiny countries in the news still get a dot", !!cell("LB") && !!cell("MT"));
t.ok("list ranks by count", listed()[0] === "IR" && rows()[0].querySelector(".map-count").textContent === "12");
t.ok("old stories and reports are not counted", !listed().includes("JP") && !listed().includes("DE"));
t.ok("meta counts countries", d.getElementById("meta").textContent.startsWith("4 countries"));

press("#map-time .seg-btn", 168);
t.ok("a longer period counts older stories", listed().includes("JP"));
t.ok("period persisted", JSON.parse(w.localStorage.getItem("newsdesk:mapHours")) === 168);
press("#map-time .seg-btn", 24);

cell("IR").click();
const pick = d.getElementById("map-pick");
t.ok("tapping the map selects a country", !pick.hidden && pick.textContent.includes("Iran") &&
     pick.textContent.includes("12 stories"));
t.ok("selection highlighted on map and list", cell("IR").classList.contains("sel") &&
     rows()[0].getAttribute("aria-pressed") === "true");
rows()[0].click();
t.ok("tapping again clears it", pick.hidden);

cell("BR").click();
t.ok("country with no news says so, no button", pick.textContent.includes("No stories") && !pick.querySelector("button"));

rows().find((r) => r.dataset.code === "IR").click();
pick.querySelector("button").click();
const cards = [...d.querySelectorAll("#list .card")];
t.ok("opens News feed filtered to the country", !d.getElementById("panel-feed").hidden &&
     d.getElementById("country").value === "IR" && cards.length === 12);
t.ok("feed filter badge shows it", d.getElementById("filters-toggle").textContent === "Filters · 1");

t.done();
