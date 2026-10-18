// News feed: category, region, country, time, batch size, read state.
import { load, harness } from "./helpers.mjs";

const { d, w, tab, press, pick, end, meta } = load();
const t = harness("News feed");

const cards = () => d.querySelectorAll("#panel-feed .card").length;
const shown = () => +(end().match(/of (\d+)/)?.[1] ?? end().match(/(\d+) shown/)?.[1]);

tab("feed");
t.ok("renders one batch", cards() === 25, `(${cards()})`);
t.ok("defaults to 24h", d.querySelector('#time .seg-btn[aria-pressed="true"]').textContent === "24h");
t.ok("category buttons built", d.querySelectorAll("#cats .cat-btn").length === w.DATA.categories.length + 1,
     `(${d.querySelectorAll("#cats .cat-btn").length})`);
t.ok("Markets is absent from news categories", !d.querySelector('#cats .cat-btn[data-value="markets"]'));

const total24 = shown();
t.note(`24h holds ${total24} stories`);

press("#cats .cat-btn", "technology");
t.ok("category narrows the list", shown() < total24, `(${shown()} of ${total24})`);
t.ok("every card is that category",
     [...d.querySelectorAll("#panel-feed .cat")].every((e) => e.textContent === "Technology"));
press("#cats .cat-btn", "all");

press("#time .seg-btn", 720);
t.ok("30d holds more than 24h", shown() > total24, `(${shown()} > ${total24})`);
press("#time .seg-btn", 24);

press("#batch .seg-btn", 100);
t.ok("batch 100 renders 100", cards() === 100, `(${cards()})`);
press("#batch .seg-btn", 25);
t.ok("batch 25 renders 25", cards() === 25);

const allCountries = d.getElementById("country").options.length;
pick("region", "spain");
t.ok("region narrows the country list", d.getElementById("country").options.length < allCountries,
     `(${d.getElementById("country").options.length} of ${allCountries})`);
pick("region", "all");

const first = d.querySelector("#panel-feed .card");
const id = first.dataset.id;
first.click();
t.ok("clicking marks read", first.classList.contains("read"));
t.ok("read state persists", JSON.parse(w.localStorage.getItem("newsdesk:read")).includes(id));

press("#view .seg-btn", "read");
t.ok("Read shows only that one", cards() === 1, `(${cards()})`);
press("#view .seg-btn", "unread");
t.ok("Unread excludes it",
     ![...d.querySelectorAll("#panel-feed .card")].some((c) => c.dataset.id === id));
press("#view .seg-btn", "all");

press("#cats .cat-btn", "technology");
d.getElementById("reset").click();
t.ok("reset restores All", d.querySelector('#cats .cat-btn[aria-pressed="true"]').textContent === "All");
t.ok("reset restores 24h", d.querySelector('#time .seg-btn[aria-pressed="true"]').textContent === "24h");
t.ok("meta reports totals", /\d+ of \d+ stories/.test(meta()), meta());

t.done();
