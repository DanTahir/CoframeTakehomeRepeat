#!/usr/bin/env node
/**
 * Throwaway probe (gitignored scrape/ dir).
 *
 * Mystery to settle: ul.MCountrySelector-options-* computes to opacity 0 in the
 * replica, but enumerating document.styleSheets found NO rule that sets opacity
 * on it -- and none inside any @media block either (the enumerator walked into
 * media blocks regardless of whether they currently matched). So the
 * transparency comes from somewhere a naive declaration scan cannot see: an
 * `animation` whose keyframes end at 0, a shorthand, or an inline/UA path.
 *
 * It also has to explain an asymmetry: the viewport gate reports this block as
 * hidden-content ONLY below 768px (iphone-se / iphone-14-pro / pixel-7) and
 * never on ipad-mini(768) / ipad-pro / laptop / desktop-wide.
 *
 * CDP's CSS.getMatchedStylesForNode answers both precisely: it returns every
 * matched rule in cascade order with its media conditions, plus inline styles
 * and the keyframes backing any animation.
 */
import { chromium } from 'playwright-core';
import { launch } from '../scripts/lib/chromium.mjs';

const URL = 'http://localhost:3308/';
const SEL = 'ul[class*="MCountrySelector-options"]';

/** [width, height, dpr, isMobile] -- straddling the 768 boundary. */
const VIEWPORTS = [
  [375, 667, 2, true],
  [768, 1024, 2, true],
  [1440, 900, 1, false],
];

const RELEVANT = /(opacity|visibility|display|animation|transition|transform|max-height|height|pointer-events|position|top)/;

const browser = await launch(chromium, { headless: true });

for (const [w, h, dpr, isMobile] of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: dpr,
    isMobile,
    hasTouch: isMobile,
  });
  const page = await ctx.newPage();
  console.log(`\n================== local ${w}x${h} ==================`);
  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(3000);

    const computed = await page.evaluate((sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      // Does an ancestor hide it structurally (what the gate excludes on)?
      let hiddenBy = null;
      for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || n.getAttribute('aria-hidden') === 'true') {
          hiddenBy = `${n.tagName.toLowerCase()}.${String(n.className).split(' ')[0]}`;
          break;
        }
      }
      return {
        opacity: s.opacity,
        visibility: s.visibility,
        display: s.display,
        animationName: s.animationName,
        animationFillMode: s.animationFillMode,
        animationPlayState: s.animationPlayState,
        transition: s.transitionProperty,
        box: `${Math.round(r.width)}x${Math.round(r.height)}`,
        top: Math.round(r.top),
        onScreen: r.top < window.innerHeight && r.bottom > 0 && r.width > 0 && r.height > 0,
        hiddenBy,
        inline: e.getAttribute('style'),
      };
    }, SEL);

    console.log(`  computed: ${JSON.stringify(computed, null, 0)}`);
    if (!computed) {
      await ctx.close();
      continue;
    }

    const cdp = await ctx.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: SEL });
    if (!nodeId) {
      console.log('  CDP could not resolve the node');
      await ctx.close();
      continue;
    }

    const ms = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });

    if (ms.inlineStyle?.cssText) {
      console.log(`\n  INLINE: ${ms.inlineStyle.cssText.replace(/\s+/g, ' ').trim()}`);
    }
    if (ms.attributesStyle?.cssText) {
      console.log(`  PRESENTATION-ATTR: ${ms.attributesStyle.cssText.replace(/\s+/g, ' ').trim()}`);
    }

    console.log('\n  --- matched rules (cascade order, visibility-relevant only) ---');
    for (const m of ms.matchedCSSRules ?? []) {
      const r = m.rule;
      const decls = (r.style?.cssText ?? '').replace(/\s+/g, ' ').trim();
      if (!RELEVANT.test(decls)) continue;
      const media = (r.media ?? []).map((x) => x.text).join(' && ');
      const origin = r.origin !== 'regular' ? ` <${r.origin}>` : '';
      console.log(`  [${media || 'no media'}]${origin} ${(r.selectorList?.text ?? '').slice(0, 100)}`);
      console.log(`      ${decls.slice(0, 220)}`);
    }

    const kf = ms.cssKeyframesRules ?? [];
    if (kf.length) {
      console.log('\n  --- keyframes referenced by this node ---');
      for (const k of kf) {
        console.log(`  @keyframes ${k.animationName?.text}`);
        for (const f of k.keyframes ?? []) {
          console.log(`      ${f.keyText?.text}  { ${(f.style?.cssText ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)} }`);
        }
      }
    }
  } catch (err) {
    console.log(`  FAILED: ${err.message}`);
  } finally {
    await ctx.close();
  }
}

await browser.close();
