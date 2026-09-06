// Shared bootstrap for the page tests.
//
// The page has no build step and no framework, so the tests load the real
// index.html, the real data files and the real app.js into jsdom and drive
// it through the same clicks a person would make.

import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

/**
 * @param {object} opts
 * @param {boolean} opts.withStyles  Inline style.css so getComputedStyle works.
 *   Only needed by tests that check whether something is actually rendered —
 *   the `hidden` property can be true while CSS keeps the element on screen.
 */
export function load({ withStyles = false, stories = null, storage = {} } = {}) {
  for (const f of ["data.js", "indicators.js", "markets.js", "summary.js"]) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      console.error(`\n${f} is missing. Generate it first:\n` +
                    `   uv run fetch.py && uv run indicators.py && uv run markets.py && uv run summarise.py\n`);
      process.exit(2);
    }
  }

  let html = read("index.html");
  if (withStyles) {
    html = html.replace('<link rel="stylesheet" href="style.css">',
                        `<style>${read("style.css")}</style>`);
  }

  // pretendToBeVisual gives us requestAnimationFrame, which the page uses to
  // measure the header after layout.
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true,
                                url: "https://newsdesk.test/" });
  const w = dom.window;

  // jsdom has neither of these. The page only uses matchMedia for
  // prefers-reduced-motion and the observer for load-on-scroll.
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };

  for (const f of ["data.js", "indicators.js", "markets.js", "summary.js"]) w.eval(read(f));
  // Replay saved data at its capture time, so time-window tests do not expire.
  w.Date.now = () => new w.Date(w.DATA.generated).getTime();
  if (stories) w.DATA.stories = stories.map((story) => ({ ...story, published: story.published || w.DATA.generated }));
  for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(`newsdesk:${key}`, JSON.stringify(value));
  w.eval(read("app.js"));

  const d = w.document;
  return {
    w, d,
    /** Click a tab by its value: feed | reports | data */
    tab: (v) => [...d.querySelectorAll("#tabs .tab")].find((t) => t.dataset.value === v).click(),
    /** Click a segmented button, e.g. press("#time .seg-btn", 720) */
    press: (sel, v) => {
      const b = [...d.querySelectorAll(sel)].find((x) => x.dataset.value === String(v));
      if (!b) throw new Error(`no button ${sel} with value ${v}`);
      b.click();
    },
    /** Choose a dropdown option and fire change */
    pick: (id, v) => {
      const s = d.getElementById(id);
      s.value = v;
      s.dispatchEvent(new w.Event("change"));
    },
    /** Computed display — the honest test of whether something is on screen */
    display: (el) => w.getComputedStyle(el).display,
    meta: () => d.getElementById("meta").textContent,
    end: () => d.getElementById("end").textContent,
  };
}

/** Minimal assertion harness. No dependency, no magic. */
export function harness(title) {
  let pass = 0, fail = 0;
  console.log(`\n${title}`);
  return {
    ok(name, cond, extra = "") {
      if (cond) { pass++; console.log(`  ok   ${name}${extra ? "  " + extra : ""}`); }
      else { fail++; console.log(`  FAIL ${name}${extra ? "  " + extra : ""}`); }
    },
    note: (msg) => console.log(`       ${msg}`),
    done() {
      console.log(`  ${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    },
  };
}
