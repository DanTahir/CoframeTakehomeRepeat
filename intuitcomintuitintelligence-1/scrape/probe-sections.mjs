#!/usr/bin/env node
/**
 * Throwaway probe (gitignored scrape/ dir).
 *
 * After the Flickity v3 fix every viewport's total document height matches live
 * EXACTLY (iphone-se 10015/10015, laptop 10109/10109, ...). Yet the iphone-se
 * slice at y=9348 shows the footer's brand links sitting ~51px higher locally
 * than on live. Equal totals + a local offset near the bottom means something
 * above the footer is ~51px TALLER locally and the footer itself ~51px shorter
 * (or vice versa) -- the two cancelling out in the total.
 *
 * So: map the whole page vertically on both sides and diff it. Print every
 * visible block down to depth 2 with its absolute offsetTop and height, so the
 * first row whose top diverges pinpoints exactly which section drifts.
 */
import { chromium } from 'playwright-core';
import { launch } from '../scripts/lib/chromium.mjs';

const TARGETS = [
  ['live', 'https://www.intuit.com/intuit-intelligence/'],
  ['local', 'http://localhost:3308/'],
];

const VIEWPORT = { width: 375, height: 667 };

/** Runs in the page. Must not close over anything from this module. */
function measure() {
  const label = (el) => {
    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls}`;
  };

  const nodes = [];
  const walk = (el, depth) => {
    for (const child of el.children) {
      if (!(child instanceof HTMLElement)) continue;
      const style = getComputedStyle(child);
      if (style.display === 'none' || style.position === 'fixed') continue;
      const height = child.offsetHeight;
      if (height > 4) {
        const rect = child.getBoundingClientRect();
        nodes.push({
          depth,
          sel: label(child).slice(0, 52),
          top: Math.round(rect.top + window.scrollY),
          h: height,
        });
      }
      if (depth < 2) walk(child, depth + 1);
    }
  };
  walk(document.body, 0);

  return { scrollHeight: document.documentElement.scrollHeight, nodes };
}

const results = {};
const browser = await launch(chromium, { headless: true });

for (const [key, url] of TARGETS) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(3500);
    // Scroll the whole page so lazy/reveal content has laid out, then return to 0.
    await page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1200);
    results[key] = await page.evaluate(measure);
  } catch (err) {
    console.log(`${key} FAILED: ${err.message}`);
    results[key] = { scrollHeight: 0, nodes: [] };
  } finally {
    await ctx.close();
  }
}

await browser.close();

const live = results.live ?? { nodes: [] };
const local = results.local ?? { nodes: [] };
console.log(`live scrollHeight=${live.scrollHeight}   local scrollHeight=${local.scrollHeight}\n`);

// Align on selector text where possible; the first drifting row is the culprit.
const width = 54;
const pad = (s) => String(s).padEnd(width).slice(0, width);
console.log(`${pad('LIVE  selector')} top/h        ${pad('LOCAL selector')} top/h      Δtop`);
console.log('-'.repeat(150));

const max = Math.max(live.nodes.length, local.nodes.length);
for (let i = 0; i < max; i += 1) {
  const a = live.nodes[i];
  const b = local.nodes[i];
  const aText = a ? `${pad('  '.repeat(a.depth) + a.sel)} ${String(a.top).padStart(5)}/${String(a.h).padStart(5)}` : pad('(none)') + '           ';
  const bText = b ? `${pad('  '.repeat(b.depth) + b.sel)} ${String(b.top).padStart(5)}/${String(b.h).padStart(5)}` : pad('(none)') + '           ';
  const drift = a && b ? b.top - a.top : '';
  const mark = a && b && (b.top !== a.top || b.h !== a.h) ? ' <<<' : '';
  console.log(`${aText}   ${bText}  ${String(drift).padStart(5)}${mark}`);
}
