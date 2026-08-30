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
// The header must be exactly as wide as the panel under it, on every tab —
// otherwise wider content scrolls past its edges as you go down.
const panelVar = () => d.documentElement.style.getPropertyValue("--panel");
for (const [name, expected] of [["summary", "820px"], ["feed", "860px"],
                                ["reports", "860px"], ["markets", "1040px"],
                                ["data", "860px"]]) {
  tab(name);
  t.ok(`${name}: header and panel share a width`, panelVar() === expected,
       `(--panel ${panelVar()})`);
}
tab("feed");
// jsdom does not resolve var() in getComputedStyle, so check the rule.
// A transparent sticky header lets content show through as it scrolls.
const css = fs.readFileSync(`${ROOT}/style.css`, "utf8");
const headerRule = css.slice(css.indexOf("\nheader {"), css.indexOf("/* Anchored headings"));
t.ok("header declares an opaque background", /background:\s*var\(--bg\)/.test(headerRule));
t.ok("header width follows the panel variable", /max-width:\s*var\(--panel\)/.test(headerRule));
t.ok("header stays sticky across tabs", ["summary", "markets", "data"].every((n) => {
  tab(n);
  return w.getComputedStyle(d.querySelector("header")).position === "sticky";
}));
tab("feed");

// Only the date line sticks inside the Summary panel — the paragraphs scroll.
tab("summary");
const briefCss = css.slice(css.indexOf(".brief-head {"), css.indexOf(".brief-sub"));
t.ok("brief date is sticky", /position:\s*sticky/.test(briefCss));
t.ok("it stacks under the header, not at zero", /top:\s*var\(--header-h\)/.test(briefCss));
t.ok("it has its own background", /background:\s*var\(--bg\)/.test(briefCss));
t.ok("it sits below the header in stacking order",
     /z-index:\s*9\b/.test(briefCss) && /z-index:\s*10\b/.test(headerRule));
t.ok("the paragraphs themselves do not stick",
     !/position:\s*sticky/.test(css.slice(css.indexOf(".brief-news"), css.indexOf(".brief-markets"))));
tab("feed");

t.done();
