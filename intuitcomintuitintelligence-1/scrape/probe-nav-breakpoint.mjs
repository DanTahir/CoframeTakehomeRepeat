#!/usr/bin/env node
/**
 * Throwaway probe (gitignored scrape/ dir).
 *
 * probe-nav-geometry.mjs established the one real remaining divergence:
 *
 *   live  @375: #brands-navigation has an extra `MGlobalNavigationBrands-hide-b0fb1fe`
 *               class -> display:none, 0x0; nav inner has inline
 *               "position: fixed; z-index: 7; top: 0px"; scrollHeight 10015.
 *   local @375: no hide class -> display:flex, 375x30 in flow; nav inner has NO
 *               inline style; nav wrapper is pushed to rectTop=30;
 *               scrollHeight 10161 (+146).
 *
 * So live's nav JS both hides the brand strip below some breakpoint and writes the
 * fixed nav's inline `top` to the strip's height. Neither is ported, which also
 * explains why the desktop composites show live with a brand strip ABOVE the nav
 * and local with none (the strip is position:static, so its z-index:99 is ignored
 * and the fixed nav paints over it).
 *
 * Before porting that behaviour I need the real breakpoint and the real values,
 * not a guess. Captured CSS shares `@media (min-width:1120px)` between
 * `MGlobalNavigationBrands-top-navigation` and `S01MegaNav-main-navigation`, and
 * live rendered a burger at 1024 but the desktop nav at 1440 -- so 1120 is the
 * candidate. Sweep widths around it on both targets and print the facts.
 */
import { chromium } from 'playwright-core';
import { launch } from '../scripts/lib/chromium.mjs';

const TARGETS = [
  ['live ', 'https://www.intuit.com/intuit-intelligence/'],
  ['local', 'http://localhost:3308/'],
];

const WIDTHS = [375, 768, 1023, 1024, 1119, 1120, 1280, 1440];

/** Runs in the page. Must not close over anything from this module. */
function measure() {
  const brands = document.querySelector(
    '#brands-navigation, [class*="MGlobalNavigationBrands-top-navigation"]',
  );
  const navInner = document.querySelector('[class*="S01MegaNav-top-fixed"]');
  const navWrapper = document.querySelector('nav#main-navigation');

  const box = (el) => {
    if (!el) return 'absent';
    const r = el.getBoundingClientRect();
    return `${Math.round(r.width)}x${Math.round(r.height)}@top${Math.round(r.top)}`;
  };

  // How the nav variant is rendered: desktop link list vs a burger control.
  const burger = document.querySelector(
    'nav#main-navigation button[class*="burger"], nav#main-navigation [class*="hamburger"], ' +
      'nav#main-navigation button[aria-controls][aria-expanded]',
  );
  const linkList = document.querySelector('nav#main-navigation [class*="S01MegaNav-links-list"]');

  return {
    scrollHeight: document.documentElement.scrollHeight,
    brandsDisplay: brands ? getComputedStyle(brands).display : 'absent',
    brandsHideClass: brands ? /-hide-/.test(String(brands.className || '')) : false,
    brandsClass: brands ? String(brands.className || '').slice(0, 78) : '',
    brandsBox: box(brands),
    brandsInline: brands ? (brands.getAttribute('style') || '') : '',
    navPosition: navInner ? getComputedStyle(navInner).position : 'absent',
    navTop: navInner ? getComputedStyle(navInner).top : 'absent',
    navInline: navInner ? (navInner.getAttribute('style') || '(none)') : 'absent',
    navWrapperTop: navWrapper ? Math.round(navWrapper.getBoundingClientRect().top) : null,
    navWrapperClass: navWrapper ? String(navWrapper.className || '').slice(0, 88) : '',
    isDesktopClass: navWrapper ? /S01MegaNav-is-desktop/.test(String(navWrapper.className || '')) : false,
    burger: burger
      ? `${burger.tagName.toLowerCase()}[aria-expanded=${burger.getAttribute('aria-expanded')}] ${box(burger)}`
      : 'none',
    linkList: linkList ? box(linkList) : 'none',
  };
}

const browser = await launch(chromium, { headless: true });

for (const [label, url] of TARGETS) {
  console.log(`\n############### ${label.trim()} ###############`);
  for (const width of WIDTHS) {
    const isMobile = width < 500;
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
      isMobile,
      hasTouch: isMobile,
    });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 90000 });
      await page.waitForTimeout(3000);
      const m = await page.evaluate(measure);
      console.log(`\n  --- width ${width} --- scrollHeight=${m.scrollHeight}`);
      console.log(
        `    brands: display=${m.brandsDisplay} hideClass=${m.brandsHideClass} ` +
          `box=${m.brandsBox} inline="${m.brandsInline}"`,
      );
      console.log(`      class="${m.brandsClass}"`);
      console.log(
        `    nav:    position=${m.navPosition} computedTop=${m.navTop} ` +
          `wrapperTop=${m.navWrapperTop} isDesktop=${m.isDesktopClass}`,
      );
      console.log(`      inline="${m.navInline}"`);
      console.log(`      wrapperClass="${m.navWrapperClass}"`);
      console.log(`    variant: burger=${m.burger} linkList=${m.linkList}`);
    } catch (err) {
      console.log(`\n  --- width ${width} --- FAILED: ${err.message}`);
    } finally {
      await ctx.close();
    }
  }
}

await browser.close();
