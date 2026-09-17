#!/usr/bin/env node
/**
 * Throwaway probe (gitignored scrape/ dir).
 *
 * Three open questions from the compare sweep, all answerable by measuring the
 * same nodes on LIVE and LOCAL at one desktop and one mobile width:
 *
 * 1. Is the global nav position:fixed on both sides? Captured CSS has
 *    `.S01MegaNav-global-navigation-*.S01MegaNav-top-fixed-*{position:fixed}`
 *    and that class IS in our markup, but live also carried an inline
 *    `position:fixed; top:0px`. A fixed nav contributes 0 to document height;
 *    an in-flow one contributes its own height -- which would explain local
 *    being consistently TALLER than live (+146px phones / +59px tablets /
 *    +29px desktop) and would shift every slice below it.
 *
 * 2. Is the #brands-navigation strip (turbotax/creditkarma/quickbooks/mailchimp)
 *    rendered? Live shows it above the nav at 1440; the laptop composite shows
 *    local without it. The markup HAS the element and the CSS HAS a
 *    `MGlobalNavigationBrands-hide-*` class, so it may simply be suppressed.
 *
 * 3. Confirm the bottom-band diff seen on essentially every slice of every
 *    viewport is live's cookie-consent overlay by listing every position:fixed
 *    element pinned to the bottom of the viewport on each side.
 *
 * Measurements are taken at scroll 0 AND after scrolling, because the nav may
 * only become fixed once scrolled (a navScroll-style effect).
 */
import { chromium } from 'playwright-core';
import { launch } from '../scripts/lib/chromium.mjs';

const TARGETS = [
  ['live ', 'https://www.intuit.com/intuit-intelligence/'],
  ['local', 'http://localhost:3308/'],
];

const VIEWPORTS = [
  ['desktop 1440x900', { width: 1440, height: 900 }],
  ['mobile  375x667', { width: 375, height: 667 }],
];

/** Runs in the page. Must not close over anything from this module. */
function measure() {
  const desc = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      sel: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`,
      cls: String(el.className || '').slice(0, 110),
      position: s.position,
      top: s.top,
      zIndex: s.zIndex,
      display: s.display,
      visibility: s.visibility,
      opacity: s.opacity,
      offsetHeight: el.offsetHeight,
      box: `${Math.round(r.width)}x${Math.round(r.height)}`,
      rectTop: Math.round(r.top),
      inline: (el.getAttribute('style') || '').slice(0, 80),
      hasTopFixed: /S01MegaNav-top-fixed/.test(String(el.className || '')),
      hasHide: /-hide-/.test(String(el.className || '')),
    };
  };

  // Every fixed element pinned near the bottom of the viewport (consent banners).
  const bottomFixed = [];
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 200 || r.height < 30) continue;
    if (r.bottom < window.innerHeight - 8 || r.top > window.innerHeight) continue;
    bottomFixed.push({
      sel: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`,
      cls: String(el.className || '').slice(0, 60),
      box: `${Math.round(r.width)}x${Math.round(r.height)}`,
      rectTop: Math.round(r.top),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70),
    });
    if (bottomFixed.length >= 6) break;
  }

  return {
    scrollHeight: document.documentElement.scrollHeight,
    nav: desc(document.querySelector('nav#main-navigation, [class*="S01MegaNav-global-navigation-wrapper"]')),
    navInner: desc(document.querySelector('[class*="S01MegaNav-global-navigation-"]:not([class*="wrapper"])')),
    brands: desc(document.querySelector('#brands-navigation, [class*="MGlobalNavigationBrands-top-navigation"]')),
    blockContainer: desc(document.querySelector('.core-block-container')),
    bottomFixed,
  };
}

const line = (label, d) => {
  if (!d) return console.log(`    ${label}: (absent)`);
  console.log(
    `    ${label}: ${d.sel} position=${d.position} top=${d.top} z=${d.zIndex} ` +
      `display=${d.display} vis=${d.visibility} opacity=${d.opacity}`,
  );
  console.log(
    `        offsetHeight=${d.offsetHeight} box=${d.box} rectTop=${d.rectTop} ` +
      `topFixedClass=${d.hasTopFixed} hideClass=${d.hasHide}`,
  );
  console.log(`        class="${d.cls}"`);
  if (d.inline) console.log(`        inline="${d.inline}"`);
};

const report = (stage, m) => {
  console.log(`  [${stage}] documentElement.scrollHeight=${m.scrollHeight}`);
  line('nav wrapper  ', m.nav);
  line('nav inner    ', m.navInner);
  line('brands strip ', m.brands);
  line('block ctr    ', m.blockContainer);
  if (m.bottomFixed.length) {
    console.log(`    bottom-pinned fixed overlays (${m.bottomFixed.length}):`);
    for (const b of m.bottomFixed) {
      console.log(`        ${b.sel} .${b.cls} ${b.box} rectTop=${b.rectTop}`);
      console.log(`            "${b.text}"`);
    }
  } else {
    console.log('    bottom-pinned fixed overlays: (none)');
  }
};

const browser = await launch(chromium, { headless: true });

for (const [vpLabel, viewport] of VIEWPORTS) {
  for (const [label, url] of TARGETS) {
    const isMobile = viewport.width < 500;
    const ctx = await browser.newContext({
      viewport,
      deviceScaleFactor: isMobile ? 2 : 1,
      isMobile,
      hasTouch: isMobile,
    });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 90000 });
      await page.waitForTimeout(3500);
      console.log(`\n=========== ${label} @ ${vpLabel} ===========`);
      report('scroll 0', await page.evaluate(measure));

      await page.evaluate(() => window.scrollTo(0, 2000));
      await page.waitForTimeout(700);
      report('scroll 2000', await page.evaluate(measure));
    } catch (err) {
      console.log(`\n=========== ${label} @ ${vpLabel} FAILED: ${err.message}`);
    } finally {
      await ctx.close();
    }
  }
}

await browser.close();
