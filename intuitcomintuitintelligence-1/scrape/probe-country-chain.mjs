#!/usr/bin/env node
/**
 * Throwaway follow-up probe (gitignored scrape/ dir).
 *
 * probe-live-hidden.mjs established that `ul.MCountrySelector-options-*` is
 * hidden on LIVE by a structurally-hidden ANCESTOR (0x0, onScreen=false,
 * structurallyHidden=true) but is on-screen and 182x165 locally with only
 * opacity:0 -- so this is a real local divergence, not a live-site quirk to
 * baseline.
 *
 * This dumps the full ancestor chain of that <ul> on both targets at one mobile
 * viewport so the exact differing node and property can be diffed directly.
 */
import { chromium } from 'playwright-core';
import { launch } from '../scripts/lib/chromium.mjs';

const TARGETS = [
  ['live ', 'https://www.intuit.com/intuit-intelligence/'],
  ['local', 'http://localhost:3308/'],
];

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** Runs in the page. Must not close over anything from this module. */
function chain() {
  const el = document.querySelector('ul[class*="MCountrySelector-options"]');
  if (!el) return { found: false, rows: [] };

  const rows = [];
  for (let n = el; n && n !== document.documentElement.parentElement; n = n.parentElement) {
    const s = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    rows.push({
      tag: n.tagName.toLowerCase(),
      cls: String(n.className || '').slice(0, 64),
      id: n.id || '',
      inline: (n.getAttribute('style') || '').slice(0, 90),
      display: s.display,
      visibility: s.visibility,
      opacity: s.opacity,
      overflow: `${s.overflowX}/${s.overflowY}`,
      height: s.height,
      maxHeight: s.maxHeight,
      transform: s.transform === 'none' ? 'none' : s.transform.slice(0, 40),
      pointerEvents: s.pointerEvents,
      ariaHidden: n.getAttribute('aria-hidden'),
      hiddenAttr: n.hasAttribute('hidden'),
      box: `${Math.round(r.width)}x${Math.round(r.height)}`,
      hides: s.display === 'none' || s.visibility === 'hidden' || n.getAttribute('aria-hidden') === 'true',
    });
  }
  return { found: true, rows };
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
    const res = await page.evaluate(chain);
    console.log(`\n=================== ${label} (375x667) ===================`);
    if (!res.found) {
      console.log('  <ul> not present');
    }
    for (const [i, r] of res.rows.entries()) {
      console.log(
        `${String(i).padStart(2)} ${r.hides ? '>>HIDES<<' : '         '} ${r.tag}` +
          `${r.id ? '#' + r.id : ''} .${r.cls}`,
      );
      console.log(
        `    display=${r.display} vis=${r.visibility} opacity=${r.opacity} ` +
          `box=${r.box} h=${r.height} maxH=${r.maxHeight}`,
      );
      console.log(
        `    overflow=${r.overflow} transform=${r.transform} pe=${r.pointerEvents} ` +
          `aria-hidden=${r.ariaHidden} hidden=${r.hiddenAttr}`,
      );
      if (r.inline) console.log(`    inline-style="${r.inline}"`);
    }
  } catch (err) {
    console.log(`\n=== ${label} FAILED: ${err.message}`);
  } finally {
    await ctx.close();
  }
}

await browser.close();
