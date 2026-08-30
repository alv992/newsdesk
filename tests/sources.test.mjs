// Source trust: tier 4 feeds are marked and can be filtered out.
import { load, harness } from "./helpers.mjs";

const { d, w, tab, press, end } = load();
const t = harness("Sources · social apps and channels");

const shown = () => +(end().match(/of (\d+)/)?.[1] ?? end().match(/(\d+) shown/)?.[1]);

tab("feed");
t.ok("Sources control exists", d.querySelectorAll("#sources .seg-btn").length === 2);

press("#time .seg-btn", 720);
const all = shown();
const marks = d.querySelectorAll(".social-mark").length;
t.ok("social cards carry a mark and an edge",
     marks > 0 && marks === d.querySelectorAll(".card.social").length,
     `(${marks} of ${d.querySelectorAll("#panel-feed .card").length} rendered)`);

press("#sources .seg-btn", "news");
const newsOnly = shown();
t.ok("News only drops them", newsOnly < all, `(dropped ${all - newsOnly})`);
t.ok("no marks remain", d.querySelectorAll(".social-mark").length === 0);

press("#sources .seg-btn", "all");
t.ok("All restores them", shown() === all, `(${shown()})`);
t.ok("choice persists", JSON.parse(w.localStorage.getItem("newsdesk:sources")) === "all");

// Bluesky and Mastodon posts have no title; the fetcher builds one from the
// opening of the post. Without that these feeds contribute nothing at all.
const untitled = w.DATA.stories.filter((s) => /Bsky|Mastodon/.test(s.source));
t.ok("untitled sources still produce stories", untitled.length > 0, `(${untitled.length})`);
t.ok("their titles are usable", untitled.every((s) => s.title.length > 5));

t.done();
