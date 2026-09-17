'use client';

/**
 * Re-applies the behaviours the original page's JavaScript provided.
 *
 * Unlike a typical replica, most of what follows is *mandatory for correct rendering*
 * rather than decorative, because this page ships its content hidden and relies on JS to
 * reveal it. From the captured stylesheet (scrape/raw/css/intelligence.e5b1965a.css):
 *
 *   .hero__word-inner      { opacity: 0; transform: translate(48px) }  -> inline styles by Hero
 *   .intro__point          { opacity: 0 }  -> `is-revealed`   (stagger)
 *   .features__card        { opacity: 0 }  -> `is-revealed`   (stagger)
 *   .video-player          { opacity: 0 }  -> `is-visible`    (VideoPlayer)
 *   .tabbed-banner         { opacity: 0 }  -> `is-inview`     (intro banner reveal)
 *   .tabbed-banner__panel  { opacity: 0; visibility: hidden } -> `is-active` (TabbedBanner)
 *   .reveal-headline:not(.is-filled) .reveal-headline__gradient { ... flat #0d0031 }
 *                                                            -> `is-filled` (LetterTrail)
 *
 * So with JavaScript disabled the live page and this replica are equally bare; with it on,
 * every module below is a port of the page's own bundle. Sources of truth:
 *   scrape/raw/js/intelligence.a7cda79c.js  (hero, letter trail, carousels, stagger, ready)
 *   scrape/raw/js/prefooter.a922aff5.js     (video players, tabbed banner, icons, cursor)
 *   scrape/raw/js/disclaimer.8d3a92b2.js    (Flickity, playback manager, click fade)
 *
 * Deliberate omissions, all verified to have no effect on rendered output:
 *   - `ee` app-cursor: a 16px dot that follows a real pointer (`.has-app-cursor{cursor:none}`)
 *     and is `opacity:0` until pointermove, so it cannot appear in a screenshot;
 *   - `se` pointer-fill: sets --fill-x/--fill-y on hover only;
 *   - `ne` disclaimer accordion: `.disclaimer__content` is already `max-height:0` in CSS, so
 *     the collapsed at-rest state is correct without it;
 *   - `Yt` nav scroll-lock: bound to the mobile nav overlay (`icom-nav-locked`), not the hero.
 */

import { useEffect } from 'react';
import {
  initEffects,
  initForms,
  initLazyImages,
  initNavDropdown,
  initNavScroll,
  initNavToggle,
  initSmoothAnchors,
  type RegisteredEffect,
  // --- ported from the live page's own bundles -------------------------------
  initBrandsNav,
  initCardCarousels,
  initCardCursors,
  initClickFade,
  initDiscoverCarousels,
  initHero,
  initIntroBannerReveal,
  initLetterTrails,
  initPageReady,
  initPrefooterIcons,
  initStagger,
  initTabbedBanners,
  initVideoPlayers,
  initVisibleVideos,
} from './lib';

/**
 * The hero owns `#intro .reveal-headline` (it freezes the propeller clip when that trail
 * starts), so it must be constructed first and the remaining headlines told to skip it.
 */
const initHeroAndHeadlines = () => {
  const hero = initHero();
  const trails = initLetterTrails(document, hero.owned);
  return () => {
    trails();
    hero.destroy();
  };
};

const effects: RegisteredEffect[] = [
  // Order mirrors the tail of intelligence.a7cda79c.js. It matters in one place:
  // video players must exist before the tabbed banner, because its `select(0)` reaches
  // into the shared player registry to activate the first panel's video.
  // First on purpose: this decides whether the 30px brand strip is displayed and where the
  // fixed nav sits, so it must settle before any effect below measures page geometry.
  { name: 'brandsNav', init: initBrandsNav },
  { name: 'pageReady', init: initPageReady },
  { name: 'heroAndHeadlines', init: initHeroAndHeadlines },
  { name: 'videoPlayers', init: initVideoPlayers },
  { name: 'discoverCarousel', init: initDiscoverCarousels },
  { name: 'cardCarousels', init: initCardCarousels },
  { name: 'prefooterIcons', init: initPrefooterIcons },
  { name: 'tabbedBanner', init: initTabbedBanners },
  { name: 'stagger', init: initStagger },
  { name: 'clickFade', init: initClickFade },
  { name: 'visibleVideos', init: initVisibleVideos },
  { name: 'cardCursors', init: initCardCursors },
  { name: 'introBannerReveal', init: initIntroBannerReveal },

  // --- generic template effects, kept only where they cannot collide ---------
  // Dropped on purpose: fadeIn / tabs / accordion / marquee / counters. This page has its
  // own controller for every element those would target, and double-driving them risks
  // fighting over the same classes.
  { name: 'navToggle', init: initNavToggle },
  { name: 'navScroll', init: initNavScroll },
  { name: 'navDropdown', init: initNavDropdown },
  { name: 'smoothAnchors', init: initSmoothAnchors },
  { name: 'lazyImages', init: initLazyImages },
  { name: 'forms', init: initForms },
];

export default function ClientRuntime() {
  useEffect(() => {
    // Deferred one frame so the generated markup is committed and laid out
    // before any effect measures it (the letter trail reads per-letter geometry).
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
