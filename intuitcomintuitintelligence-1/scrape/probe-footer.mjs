#!/usr/bin/env node
/**
 * Throwaway probe (gitignored scrape/ dir).
 *
 * probe-sections.mjs found zero drift, but it only walked to depth 2 — the
 * footer's brand links sit at `footer > div > ul > li > a` (depth 3+), so a
 * drift *inside* the footer was invisible to it. The iphone-se y=9348 composite
 * shows live stacking creditkarma/quickbooks/mailchimp at ~38px pitch with our
 * copy ~51px higher, while total document heights match exactly (10015/10015).
 *
 * So walk deep (depth 7) over the bottom of the page only, and print LIVE and
 * LOCAL as two separate blocks rather than index-aligned pairs: aligning by
 * index can silently pair up different nodes and fake a match.
 */
import { chromium } from 'playwright-core';
import { launch } from '../scripts/lib/chromium.mjs';

const TARGETS = [
  ['live', 'https://www.intuit.com/intuit-intelligence/'],
  ['local', 'http://localhost:3308/'],
];

const VIEWPORT = { width: 375, height: 667 };
/** Only the tail of the page — the footer/prefooter/disclaimer region. */
const FROM_Y = 8600;

/** Runs in the page. Must not close over anything from this module. */
function measure(fromY) {
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
      const rect = child.getBoundingClientRect();
      const top = Math.round(rect.top + window.scrollY);
      const height = child.offsetHeight;
      if (height > 2 && top + height >= fromY) {
        nodes.push({
          depth,
          sel: label(child).slice(0, 44),
          top,
          h: height,
          mt: style.marginTop,
          mb: style.marginBottom,
          pt: style.paddingTop,
          gap: style.rowGap,
          dir: style.flexDirection,
          disp: style.display,
          text: (child.childElementCount === 0 ? child.textContent || '' : '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 22),
        });
      }
      if (depth < 7) walk(child, depth + 1);
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
    await page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1200);
    results[key] = await page.evaluate(measure, FROM_Y);
  } catch (err) {
    console.log(`${key} FAILED: ${err.message}`);
    results[key] = { scrollHeight: 0, nodes: [] };
  } finally {
    await ctx.close();
  }
}

await browser.close();

for (const [key, data] of Object.entries(results)) {
  console.log(
    `\n=================== ${key.toUpperCase()}  scrollHeight=${data.scrollHeight}  ` +
      `nodes=${data.nodes.length} (from y=${FROM_Y}) ===================`,
  );
  for (const n of data.nodes) {
    console.log(
      `${'  '.repeat(n.depth)}${n.sel.padEnd(46 - n.depth * 2)} ` +
        `top=${String(n.top).padStart(5)} h=${String(n.h).padStart(4)} ` +
        `disp=${n.disp} dir=${n.dir} gap=${n.gap} mt=${n.mt} mb=${n.mb} pt=${n.pt}` +
        (n.text ? `  "${n.text}"` : ''),
    );
  }
}
