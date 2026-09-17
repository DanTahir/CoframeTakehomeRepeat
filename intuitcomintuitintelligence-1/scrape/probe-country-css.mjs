#!/usr/bin/env node
/**
 * Throwaway probe (gitignored scrape/ dir).
 *
 * Question: does the CAPTURED css contain any rule that hides the desktop-only
 * global-nav pieces at phone widths, and if so why is it not winning?
 *
 * Context: the captured DOM is Intuit's global nav as rendered at DESKTOP width
 * (live re-renders a different nav client-side per breakpoint -- live's mobile
 * DOM has no S01MegaNav-left-wrapper at all). So at 375px the replica keeps
 * showing desktop nav markup, leaving ul.MCountrySelector-options on screen at
 * opacity 0 (the gate's hidden-content failure).
 *
 * This enumerates every CSS rule matching the nav/country-selector elements,
 * with its enclosing @media condition, so it is clear whether the media query
 * exists in the captured CSS, is missing entirely, or is being beaten.
 *
 * Note: live's stylesheets may be cross-origin and therefore unreadable
 * (cssRules throws); the LOCAL side is the one that matters here.
 */
import { chromium } from 'playwright-core';
import { launch } from '../scripts/lib/chromium.mjs';

const TARGETS = [
  ['local', 'http://localhost:3308/'],
  ['live ', 'https://www.intuit.com/intuit-intelligence/'],
];

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** Runs in the page. Must not close over anything from this module. */
function cssFor() {
  const SELECTORS = [
    'ul[class*="MCountrySelector-options"]',
    '[class*="MCountrySelector-m-country-selector"]',
    '[class*="MCountrySelector-desktop"]',
    '[class*="MCountrySelector-mobile"]',
    '[class*="S01MegaNav-left-wrapper"]',
    '[class*="S01MegaNav-links-list"]',
    '[class*="S01MegaNav-mobile"]',
  ];

  const els = [];
  for (const sel of SELECTORS) {
    const e = document.querySelector(sel);
    if (e) els.push([sel, e]);
  }

  const out = [];
  const INTERESTING = /(^|;|\s)(display|visibility|opacity|max-height|transform)\s*:/;

  const visit = (rules, cond) => {
    for (const rule of rules) {
      // @media / @supports / @layer wrappers: recurse, carrying the condition.
      if (rule.conditionText !== undefined && rule.cssRules) {
        visit(rule.cssRules, (cond ? cond + ' && ' : '') + rule.conditionText);
        continue;
      }
      if (rule.cssRules && rule.selectorText === undefined) {
        visit(rule.cssRules, cond);
        continue;
      }
      if (!rule.selectorText) continue;

      const css = rule.style ? rule.style.cssText : '';
      if (!INTERESTING.test(css)) continue;

      for (const [sel, e] of els) {
        let hit = false;
        try {
          hit = e.matches(rule.selectorText);
        } catch {
          hit = false;
        }
        if (!hit) continue;
        out.push({
          sel,
          cond: cond || '(no media)',
          rule: rule.selectorText.slice(0, 90),
          css: css.slice(0, 170),
        });
      }
    }
  };

  let unreadable = 0;
  for (const ss of document.styleSheets) {
    try {
      visit(ss.cssRules, '');
    } catch {
      unreadable += 1;
    }
  }

  return { present: els.map(([s]) => s), unreadable, out };
}

const browser = await launch(chromium, { headless: true });

for (const [label, url] of TARGETS) {
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: MOBILE_UA,
  });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(3500);
    const res = await page.evaluate(cssFor);
    console.log(`\n=================== ${label} (375x667) ===================`);
    console.log(`  elements present: ${res.present.join('  ') || '(none)'}`);
    console.log(`  unreadable stylesheets (cross-origin): ${res.unreadable}`);
    for (const r of res.out) {
      console.log(`\n  [${r.cond}]`);
      console.log(`    for ${r.sel}`);
      console.log(`    ${r.rule}`);
      console.log(`      { ${r.css} }`);
    }
  } catch (err) {
    console.log(`\n=== ${label} FAILED: ${err.message}`);
  } finally {
    await ctx.close();
  }
}

await browser.close();
