'use client';

/**
 * Re-applies the behaviours the original page's JavaScript provided.
 *
 * Codegen captures the DOM *before* scroll and strips runtime-added classes,
 * so the markup starts in its pristine pre-animation state. Everything that
 * made the page feel alive is re-implemented here.
 *
 * WHY THE GENERIC TEMPLATE EFFECTS ARE GONE
 * This page is hand-built Intuit markup, not Webflow output. A fixed-string
 * census of the generated TSX returned zero matches for every selector the
 * template's generic effects target (`w-tab-link`, `w-dropdown-toggle`,
 * `w-lightbox`, `data-w-tab`, `data-fancybox`, `data-tab`, `data-typewriter`,
 * `data-reveal`, `nav-toggle`, `fade-in`), so registering them would only add
 * no-op listeners. `initAccordion` was worse than useless: it claims
 * `[aria-controls]`, whose only 5 occurrences here are the tabbed banner's own
 * tabs, so it would have double-handled those clicks. The generic modules stay
 * in `app/lib` (and are still exported) — they're just not wired up.
 *
 * The effects below are ports of the page's real scripts: `intelligence.js`,
 * `disclaimer.js`, `prefooter.js` and `navOpen.js`.
 */

import { useEffect } from 'react';
import {
  initAppCursor,
  initCardCursors,
  initChevronClickFade,
  initCtaRipple,
  initDisclaimerAccordion,
  initEffects,
  initIntroBannerReveal,
  initIntuitBrandsNav,
  initIntuitHero,
  initIntuitLetterTrails,
  initIntuitPlayWhenVisible,
  initIntuitTabbedBanners,
  initIntuitVideoPlayers,
  initNavLock,
  initPageReady,
  initPrefooterIconCycle,
  initSmoothAnchors,
  initStaggerReveals,
  createIntuitCarousels,
  type RegisteredEffect,
} from './lib';

/**
 * Order matters here, unlike in the generic template:
 *
 *  - `pageReady` first — it owns the `is-ready` gate and resets scroll to the
 *    top, which the hero cinematic depends on.
 *  - `videoPlayers` before `tabbedBanner` and `hero`, because both look up the
 *    `VideoPlayer` instances it registers in its WeakMap.
 *  - `hero` before `letterTrails`, since the hero claims the intro headline and
 *    drives its trail itself; the generic pass then takes what's left.
 *  - cursor effects last: they only decorate, and `appCursor` reads the
 *    `is-cursor-zone` / `is-cta-zone` markers the others set.
 */
const effects: RegisteredEffect[] = [
  // --- page state -----------------------------------------------------------
  { name: 'pageReady', init: initPageReady },
  { name: 'navLock', init: initNavLock },
  // Measures the brands bar and offsets the fixed mega-nav by its height.
  { name: 'brandsNav', init: initIntuitBrandsNav },

  // --- media (must precede anything that drives a video) --------------------
  { name: 'videoPlayers', init: initIntuitVideoPlayers },
  { name: 'playWhenVisible', init: initIntuitPlayWhenVisible },

  // --- hero cinematic + headline trails ------------------------------------
  { name: 'hero', init: initIntuitHero },
  { name: 'letterTrails', init: initIntuitLetterTrails },

  // --- carousels / tabs -----------------------------------------------------
  { name: 'carousels', init: createIntuitCarousels({ load: () => import('flickity') }) },
  { name: 'tabbedBanner', init: initIntuitTabbedBanners },
  { name: 'introBannerReveal', init: initIntroBannerReveal },

  // --- scroll reveals -------------------------------------------------------
  { name: 'staggerReveals', init: initStaggerReveals },

  // --- pointer decoration ---------------------------------------------------
  { name: 'ctaRipple', init: initCtaRipple },
  { name: 'cardCursors', init: initCardCursors },
  { name: 'chevronClickFade', init: initChevronClickFade },
  { name: 'appCursor', init: initAppCursor },

  // --- footer / disclaimer --------------------------------------------------
  { name: 'disclaimer', init: initDisclaimerAccordion },
  { name: 'prefooterIcons', init: initPrefooterIconCycle },

  // --- generic, kept because the markup genuinely uses in-page anchors ------
  { name: 'smoothAnchors', init: initSmoothAnchors },
];

export default function ClientRuntime() {
  useEffect(() => {
    // Deferred one frame so the generated markup is committed and laid out
    // before any effect measures it (the hero and carousels read geometry).
    let teardown: (() => void) | undefined;
    const raf = requestAnimationFrame(() => {
      teardown = initEffects(effects);
    });
    return () => {
      cancelAnimationFrame(raf);
      teardown?.();
    };
  }, []);

  return null;
}
