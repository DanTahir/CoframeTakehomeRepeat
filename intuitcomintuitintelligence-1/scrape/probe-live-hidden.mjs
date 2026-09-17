#!/usr/bin/env node
/**
 * Throwaway arbiter probe (lives in the gitignored scrape/ dir).
 *
 * Two viewport-gate findings need the LIVE page as arbiter before anything is
 * written into replica.baseline.json:
 *
 *   1. `ul.MCountrySelector-options-*` renders at opacity ~0 while on screen
 *      (the footer country-selector's option list). If live does the same, this
 *      is a legitimately-closed dropdown that happens to hide with opacity
 *      instead of display/visibility, so the gate's structural-hide exclusion
 *      cannot see it -- fidelity, not a missing reveal class.
 *   2. `div.S01MegaNav-left-wrapper-*` / `ul.S01MegaNav-links-list-*` lay out
 *      wider than a phone viewport (w=585/503 at right=609).
 *
 * The gate only promotes either to a failure for the LOCAL target
 * (`if (isLocal && ...) problems.push(...)`), so live cannot be judged from its
 * pass/fail verdict. Measure both sides identically and compare.
 *
 * playwright-core is what this project vendors, so the executable comes from
 * scripts/lib/chromium.mjs rather than a bare `import 'playwright'`.
 */
import { chromium } from 'playwright-core';
import { launch } from '../scripts/lib/chromium.mjs';

const TARGETS = [
  ['live ', 'https://www.intuit.com/intuit-intelligence/'],
  ['local', 'http://localhost:3308/'],
];

/** The three viewports where the gate reported hidden-content. */
const VIEWPORTS = [
  ['iphone-se', 375, 667, 2],
  ['iphone-14-pro', 393, 852, 3],
  ['pixel-7', 412, 915, 2.625],
];

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** Runs in the page. Must not close over anything from this module. */
function collect() {
  const out = {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    country: [],
    megaNav: [],
  };

  for (const el of document.querySelectorAll('ul[class*="MCountrySelector-options"]')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    // Walk ancestors the way the gate does: a parent hiding structurally is
    // what separates "closed dropdown" from "reveal class never re-applied".
    let structurallyHidden = false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || n.getAttribute('aria-hidden') === 'true') {
        structurallyHidden = true;
        break;
      }
    }
    out.country.push({
      cls: String(el.className).slice(0, 70),
      opacity: cs.opacity,
      display: cs.display,
      visibility: cs.visibility,
      ariaHidden: el.getAttribute('aria-hidden'),
      w: Math.round(r.width),
      h: Math.round(r.height),
      onScreen: r.top < window.innerHeight && r.bottom > 0 && r.width > 0 && r.height > 0,
      structurallyHidden,
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
    });
  }

  for (const el of document.querySelectorAll(
    '[class*="S01MegaNav-left-wrapper"], [class*="S01MegaNav-links-list"]',
  )) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out.megaNav.push({
      cls: String(el.className).slice(0, 70),
      w: Math.round(r.width),
      right: Math.round(r.right),
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
    });
  }

  return out;
}

const browser = await launch(chromium, { headless: true });

for (const [label, url] of TARGETS) {
  for (const [name, width, height, dpr] of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: dpr,
      isMobile: true,
      hasTouch: true,
      userAgent: MOBILE_UA,
    });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 90000 });
      await page.waitForTimeout(3500);
      // Walk the whole document so scroll-driven work has run, then settle.
      await page.evaluate(async () => {
        const step = Math.max(200, window.innerHeight);
        for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 90));
        }
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
      await page.waitForTimeout(1000);

      const res = await page.evaluate(collect);
      console.log(`\n### ${label} / ${name} (${width}x${height} @${dpr}x)`);
      console.log(`  scrollWidth ${res.scrollWidth} vs innerWidth ${res.innerWidth}`);
      if (!res.country.length) console.log('  country-ul  (none present)');
      for (const c of res.country) {
        console.log(
          `  country-ul  opacity=${c.opacity} display=${c.display} vis=${c.visibility} ` +
            `aria-hidden=${c.ariaHidden} ${c.w}x${c.h} onScreen=${c.onScreen} ` +
            `structurallyHidden=${c.structurallyHidden}`,
        );
        console.log(`              cls=${c.cls}`);
        console.log(`              text="${c.text}"`);
      }
      if (!res.megaNav.length) console.log('  meganav     (none present)');
      for (const m of res.megaNav) {
        console.log(
          `  meganav     w=${m.w} right=${m.right} display=${m.display} ` +
            `vis=${m.visibility} opacity=${m.opacity}`,
        );
        console.log(`              cls=${m.cls}`);
      }
    } catch (err) {
      console.log(`\n### ${label} / ${name} FAILED: ${err.message}`);
    } finally {
      await ctx.close();
    }
  }
}

await browser.close();
