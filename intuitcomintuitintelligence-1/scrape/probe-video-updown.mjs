#!/usr/bin/env node
/**
 * Throwaway probe (gitignored scrape/ dir).
 *
 * Finding to explain: compare-live's desktop-wide slice at y=1080 is 8.72% on
 * the way DOWN but 35.08% on the way UP, and the composite shows the replica
 * painting an empty light-grey rounded rectangle where live paints the black
 * laptop/video mockup in the "AI that understands your finances" section.
 * Surrounding copy and the TurboTax/Credit Karma/Mailchimp/QuickBooks tabs match
 * exactly, so a media element simply is not painted on the upward visit.
 *
 * v1 of this probe had a bug: its descending loop started at
 * (pageHeight - HEIGHT) = 9358 and stepped by 1080, so it never landed on
 * y=1080 and the UP block printed nothing. compare-live slices on the grid
 * k*HEIGHT in BOTH directions (hence its file up-08-y1080.jpg), so the upward
 * pass here must walk that same grid in reverse.
 *
 * Also dumps each video's nearest faded/transformed ancestor, because an
 * opacity:0 wrapper would explain an empty container even with readyState=4,
 * and saves real screenshots of the disputed viewport for direct inspection.
 */
import { chromium } from 'playwright-core';
import { launch } from '../scripts/lib/chromium.mjs';

const URL = 'http://localhost:3308/';
const WIDTH = 1920;
const HEIGHT = 1080;
const TARGET_Y = 1080; // the disputed slice

/** Runs in the page. Must not close over anything from this module. */
function sampleVideos() {
  const rows = [];
  for (const v of Array.from(document.querySelectorAll('video'))) {
    const r = v.getBoundingClientRect();
    const onScreen = r.top < window.innerHeight && r.bottom > 0 && r.width > 0 && r.height > 0;
    if (!onScreen) continue;
    const s = getComputedStyle(v);

    // Nearest ancestor that would visually suppress this video.
    let faded = null;
    for (let n = v.parentElement; n && n !== document.body; n = n.parentElement) {
      const ns = getComputedStyle(n);
      if (Number(ns.opacity) < 0.99 || ns.visibility !== 'visible' || ns.display === 'none') {
        faded = `${n.tagName.toLowerCase()}.${String(n.className || '').slice(0, 40)} ` +
          `opacity=${ns.opacity} vis=${ns.visibility} display=${ns.display}`;
        break;
      }
    }

    rows.push({
      src: (v.currentSrc || v.getAttribute('src') || '(none)').split('/').pop().slice(0, 52),
      readyState: v.readyState,
      networkState: v.networkState,
      paused: v.paused,
      currentTime: Number(v.currentTime.toFixed(2)),
      frame: `${v.videoWidth}x${v.videoHeight}`,
      poster: v.getAttribute('poster') ? 'yes' : 'no',
      box: `${Math.round(r.width)}x${Math.round(r.height)}`,
      top: Math.round(r.top),
      opacity: s.opacity,
      visibility: s.visibility,
      transform: s.transform === 'none' ? 'none' : s.transform.slice(0, 32),
      faded,
    });
  }
  return rows;
}

const show = (label, rows) => {
  console.log(`\n--- ${label} (${rows.length} video(s) on screen) ---`);
  if (!rows.length) console.log('  (none on screen)');
  for (const v of rows) {
    console.log(
      `  readyState=${v.readyState} paused=${v.paused} t=${v.currentTime} ` +
        `frame=${v.frame} box=${v.box} top=${v.top} opacity=${v.opacity} ` +
        `vis=${v.visibility} poster=${v.poster} transform=${v.transform}`,
    );
    console.log(`      ${v.src}`);
    if (v.faded) console.log(`      SUPPRESSED BY ANCESTOR: ${v.faded}`);
  }
};

const browser = await launch(chromium, { headless: true });
const ctx = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
await page.waitForTimeout(3500);

const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
// The exact offset grid compare-live uses, in both directions.
const grid = [];
for (let y = 0; y + HEIGHT <= pageHeight; y += HEIGHT) grid.push(y);
console.log(
  `page height ${pageHeight}, viewport ${WIDTH}x${HEIGHT}, ` +
    `grid ${grid[0]}..${grid[grid.length - 1]} step ${HEIGHT}, target y=${TARGET_Y}`,
);

const visit = async (y) => {
  await page.evaluate((to) => window.scrollTo(0, to), y);
  await page.waitForTimeout(500);
};

// ---- downward pass -------------------------------------------------------
for (const y of grid) {
  await visit(y);
  if (y === TARGET_Y) {
    show(`DOWN y=${y}`, await page.evaluate(sampleVideos));
    await page.screenshot({ path: 'scrape/probe-video-down-y1080.png' });
  }
}

// ---- bottom, then the same grid in reverse -------------------------------
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await page.waitForTimeout(800);

for (const y of [...grid].reverse()) {
  await visit(y);
  if (y === TARGET_Y) {
    show(`UP y=${y}`, await page.evaluate(sampleVideos));
    await page.screenshot({ path: 'scrape/probe-video-up-y1080.png' });
  }
}

await ctx.close();
await browser.close();
