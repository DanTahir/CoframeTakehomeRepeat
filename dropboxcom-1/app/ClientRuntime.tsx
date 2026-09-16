'use client';

/**
 * Re-applies the behaviours the original page's JavaScript provided.
 *
 * Codegen captures the DOM *before* scroll and strips runtime-added classes,
 * so the markup starts in its pristine pre-animation state. Everything that
 * made the page feel alive is re-implemented here.
 *
 * EFFECT CENSUS FOR THIS SITE (counted against `app/generated/*.tsx`)
 * ------------------------------------------------------------------
 * dropbox.com renders `dwg-*` design-system components with hashed CSS-module
 * class names, so almost none of the template's generic (Webflow-flavoured)
 * selectors match. Each generic effect was counted in the generated markup
 * before being kept or dropped:
 *
 *   fadeIn        .fade-in/[data-fade]/[data-animate]      0 -> dropped
 *   navScroll     header/.navbar/[class*=nav-bar]/[data-nav] 0 -> dropped
 *   navDropdown   .w-dropdown/[data-dropdown]              0 -> dropped
 *   tabs          .w-tab-link/.w-tab-pane                  0 -> dropped
 *   accordion     .faq-item/.accordion-*                   0 -> dropped
 *   counters      [data-count-to]/[data-counter]           0 -> dropped
 *   lazyImages    [data-src]/[data-bg]                     0 -> dropped
 *   forms         <form>                                   0 -> dropped
 *
 * Two generics matched real elements but would have been actively harmful:
 *
 *   navToggle  matches `.dwg-nav__hamburger-button` via [class*="burger"] and
 *              `.dwg-nav-menu` via [class*="nav-menu"], then toggles its own
 *              `is-open`/`nav-open` classes — which appear nowhere in
 *              Dropbox's CSS. Replaced by `dropboxNav`, which drives the real
 *              `--open` classes and the measured dropdown-height variable.
 *   marquee    matches `._ticker_90hav_23` via [class*="ticker"] and would
 *              clone its children. The logo ticker is already CSS-animated
 *              (`._animationStandard_90hav_27` runs `_keyframes-standard_90hav_1`,
 *              translateX -30% -> -50%, over `--dwg-animation__ticker__duration-ms`
 *              = 90000ms) over content the capture already duplicated (5 copies
 *              of the logo list). Cloning again would desynchronise the loop.
 *
 * Kept generic:
 *   smoothAnchors  2 real in-page anchors (`#main-content` skip link,
 *                  `#manage-cookies`), neither a widget control.
 *
 * Site-specific modules (see each file's header for the evidence):
 *   dropboxReveals  3 gating scroll-reveal class pairs from
 *                   `scrape/analysis/scroll-reveals.json`.
 *   dropboxNav      6 `aria-controls` dropdown triggers + mobile hamburger,
 *                   including the `--dwg-nav-current-dropdown-height` variable
 *                   that exists in no captured stylesheet.
 *   dropboxVideos   4 autoplay videos needing `muted` as a DOM property.
 */

import { useEffect } from 'react';
import {
  initDropboxNav,
  initDropboxReveals,
  initDropboxVideos,
  initSmoothAnchors,
  initEffects,
  type RegisteredEffect,
} from './lib';

const effects: RegisteredEffect[] = [
  // --- site-specific: reproduce dropbox.com's own classes/variables --------
  { name: 'dropboxReveals', init: initDropboxReveals },
  { name: 'dropboxNav', init: initDropboxNav },
  { name: 'dropboxVideos', init: initDropboxVideos },

  // --- generic, kept because it matches real markup here -------------------
  { name: 'smoothAnchors', init: initSmoothAnchors },
];

export default function ClientRuntime() {
  useEffect(() => {
    // Deferred one frame so the generated markup is committed and laid out
    // before any effect measures it (the nav reads panel scrollHeight).
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
