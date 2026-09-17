#!/usr/bin/env node
/**
 * Throwaway probe (gitignored scrape/ dir).
 *
 * The iphone-se compare slice at y=7271 (66.9% diff) shows the discover carousel
 * rendering differently on each side at 375px:
 *   - LOCAL: cell flush to the left edge, next cell visibly peeking in at the right;
 *   - LIVE : cell inset/centred with no peek, three page dots below.
 *
 * Both carousels are ported with autoPlay:false, so this CANNOT be a "two
 * unsynchronised autoplay clocks" difference the way the hero video was -- both
 * sides should be sitting still at initialIndex 0. So either
 *   (a) our cellAlign/contain ternary is inverted vs live (real bug), or
 *   (b) live isn't Flickity-driven at this width at all, or
 *   (c) the cells themselves are sized differently by CSS.
 *
 * Measure, don't guess: report the track, its flickity viewport, the slider
 * transform, which cell is selected, and every cell's rect on both sides.
 * Also check for horizontal document overflow, the classic mobile symptom of a
 * carousel whose cells are not contained.
 */
import { chromium } from 'playwright-core';
import { launch } from '../scripts/lib/chromium.mjs';

const TARGETS = [
  ['live ', 'https://www.intuit.com/intuit-intelligence/'],
  ['local', 'http://localhost:3308/'],
];

const VIEWPORTS = [
  ['mobile  375x667', { width: 375, height: 667 }],
  ['desktop 1440x900', { width: 1440, height: 900 }],
];

/** Runs in the page. Must not close over anything from this module. */
function measure() {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      right: Math.round(r.right),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };

  const describeTrack = (track) => {
    const s = getComputedStyle(track);
    const viewport = track.querySelector('.flickity-viewport');
    const slider = track.querySelector('.flickity-slider');
    const dots = track.querySelector('.flickity-page-dots');

    // Flickity moves the original children under .flickity-slider once enabled.
    const cellParent = slider || track;
    const cells = Array.from(cellParent.children)
      .filter((c) => !c.classList.contains('flickity-page-dots'))
      .slice(0, 6)
      .map((c) => ({
        cls: String(c.className || '').slice(0, 70),
        selected: c.classList.contains('is-selected'),
        rect: rect(c),
        marginLeft: getComputedStyle(c).marginLeft,
        widthStyle: getComputedStyle(c).width,
      }));

    return {
      cls: String(track.className || '').slice(0, 90),
      flickityEnabled: track.classList.contains('flickity-enabled'),
      overflow: `${s.overflowX}/${s.overflowY}`,
      padding: s.padding,
      rect: rect(track),
      viewportRect: viewport ? rect(viewport) : null,
      sliderTransform: slider ? getComputedStyle(slider).transform : null,
      sliderRect: slider ? rect(slider) : null,
      dotCount: dots ? dots.querySelectorAll('.dot').length : null,
      selectedDot: dots
        ? Array.from(dots.querySelectorAll('.dot')).findIndex((d) =>
            d.classList.contains('is-selected'),
          )
        : null,
      cellCount: cellParent.children.length,
      cells,
    };
  };

  const out = { tracks: {}, overflow: {} };
  for (const sel of ['.discover__track', '.features__cards', '.trust__cards']) {
    const el = document.querySelector(sel);
    out.tracks[sel] = el ? describeTrack(el) : null;
  }

  out.overflow = {
    innerWidth: window.innerWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    horizontallyScrollable: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
  return out;
}

const report = (m) => {
  const o = m.overflow;
  console.log(
    `  innerWidth=${o.innerWidth} docScrollWidth=${o.docScrollWidth} ` +
      `bodyScrollWidth=${o.bodyScrollWidth} hOverflow=${o.horizontallyScrollable}`,
  );
  for (const [sel, t] of Object.entries(m.tracks)) {
    if (!t) {
      console.log(`  ${sel}: (absent)`);
      continue;
    }
    console.log(`  ${sel}:`);
    console.log(
      `      flickityEnabled=${t.flickityEnabled} overflow=${t.overflow} padding=${t.padding}`,
    );
    console.log(`      class="${t.cls}"`);
    console.log(
      `      track   ${JSON.stringify(t.rect)}  viewport ${JSON.stringify(t.viewportRect)}`,
    );
    console.log(`      slider  transform=${t.sliderTransform} rect=${JSON.stringify(t.sliderRect)}`);
    console.log(`      dots    count=${t.dotCount} selected=${t.selectedDot} cells=${t.cellCount}`);
    t.cells.forEach((c, i) => {
      console.log(
        `      cell[${i}] sel=${c.selected} w=${c.widthStyle} ml=${c.marginLeft} ` +
          `${JSON.stringify(c.rect)} class="${c.cls}"`,
      );
    });
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
      // Bring the carousel into view: lazy/Flickity layout can depend on it.
      await page.evaluate(() => {
        const el = document.querySelector('.discover__track');
        if (el) el.scrollIntoView({ block: 'center' });
      });
      await page.waitForTimeout(1200);
      console.log(`\n=========== ${label} @ ${vpLabel} ===========`);
      report(await page.evaluate(measure));
    } catch (err) {
      console.log(`\n=========== ${label} @ ${vpLabel} FAILED: ${err.message}`);
    } finally {
      await ctx.close();
    }
  }
}

await browser.close();
