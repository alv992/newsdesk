// Reports tab: its own surface, its own time window, shared context.
import { load, harness } from "./helpers.mjs";

const { d, w, tab, press, pick, meta } = load();
const t = harness("Reports");

const cards = () => d.querySelectorAll("#reports .card").length;
const reportIds = new Set(w.DATA.stories.filter((s) => s.kind === "report").map((s) => s.id));

t.ok("five tabs", d.querySelectorAll("#tabs .tab").length === 5,
     [...d.querySelectorAll("#tabs .tab")].map((x) => x.textContent).join(" | "));
t.ok("report stories exist", reportIds.size > 0, `(${reportIds.size})`);

// The whole point: they must not compete on recency in the news list.
tab("feed");
press("#time .seg-btn", 720);
t.ok("reports never appear in News",
     [...d.querySelectorAll("#panel-feed .card")].every((c) => !reportIds.has(c.dataset.id)));

tab("reports");
const all = cards();
t.ok("Reports renders", all > 0, `(${all})`);
t.ok("defaults to 30d — 24h would be empty",
     d.querySelector('#time .seg-btn[aria-pressed="true"]').textContent === "30d");
t.ok("meta reports filtered of total", /\d+ of \d+ reports/.test(meta()), meta());

pick("region", "europe");
t.ok("region filters reports", cards() < all, `(${cards()} of ${all})`);
pick("region", "all");
t.ok("clearing region restores", cards() === all);

press("#time .seg-btn", 24);
t.note(`24h shows ${cards()} reports — this is why the window is separate`);
press("#time .seg-btn", 720);

const first = d.querySelector("#reports .card");
first.click();
t.ok("reports mark read", first.classList.contains("read"));
press("#view .seg-btn", "unread");
t.ok("Unread excludes it", cards() === all - 1, `(${cards()})`);
press("#view .seg-btn", "all");

// Time is per-tab; region and read state are shared. Set each window to
// something distinct and check neither disturbs the other.
const window = () => d.querySelector('#time .seg-btn[aria-pressed="true"]').textContent;

press("#time .seg-btn", 168);          // Reports -> 7d
tab("feed");
press("#time .seg-btn", 48);           // News    -> 48h
t.ok("News holds 48h", window() === "48h", `(${window()})`);
tab("reports");
t.ok("Reports still 7d, untouched by News", window() === "7d", `(${window()})`);
tab("feed");
t.ok("News still 48h, untouched by Reports", window() === "48h", `(${window()})`);

t.done();
