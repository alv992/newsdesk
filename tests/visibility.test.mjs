// Regression: controls hidden per tab must actually be off screen.
//
// element.hidden being true is not enough. `.cats` and `.field` set
// display:flex, and an author rule with a class selector beats the
// browser's own [hidden] { display: none }. An earlier version of these
// tests passed while the controls were plainly visible.
import { load, harness, ROOT } from "./helpers.mjs";
import fs from "fs";

const { d, w, tab, display } = load({ withStyles: true });
const t = harness("Control visibility (computed style)");

const sources = d.getElementById("sources").closest(".field");
const batch   = d.getElementById("batch").closest(".field");
const cats    = d.getElementById("cats");
const region  = d.getElementById("region").closest(".field");
const time    = d.getElementById("time").closest(".field");

tab("feed");
t.ok("News shows categories", display(cats) !== "none", `(${display(cats)})`);
t.ok("News shows Sources", display(sources) !== "none", `(${display(sources)})`);
t.ok("News shows Per load", display(batch) !== "none");

tab("reports");
t.ok("Reports hides categories", display(cats) === "none", `(${display(cats)})`);
t.ok("Reports hides Sources", display(sources) === "none", `(${display(sources)})`);
t.ok("Reports hides Per load", display(batch) === "none");
t.ok("Reports keeps Region", display(region) !== "none");
t.ok("Reports keeps Period", display(time) !== "none");

tab("data");
t.ok("Data hides every control",
     display(d.getElementById("feed-controls")) === "none");

tab("feed");
t.ok("controls come back", display(sources) !== "none" && display(cats) !== "none");

// The sticky header must span the viewport, not the reading column — wider
// panels used to scroll past its edges.
const header = d.querySelector("header");
t.ok("header is sticky", w.getComputedStyle(header).position === "sticky",
     w.getComputedStyle(header).position);
t.ok("header is not width-limited itself",
     w.getComputedStyle(header).maxWidth === "none" || w.getComputedStyle(header).maxWidth === "",
     `(${w.getComputedStyle(header).maxWidth})`);
// jsdom does not resolve var() in getComputedStyle, so check the rule.
// A transparent sticky header lets content show through as it scrolls.
const css = fs.readFileSync(`${ROOT}/style.css`, "utf8");
const headerRule = css.slice(css.indexOf("\nheader {"), css.indexOf("header > *"));
t.ok("header declares an opaque background", /background:\s*var\(--bg\)/.test(headerRule));
t.ok("inner blocks are constrained instead",
     w.getComputedStyle(d.getElementById("tabs")).maxWidth === "1000px",
     w.getComputedStyle(d.getElementById("tabs")).maxWidth);

t.done();
