/**
 * Reproduces the global nav's width-driven desktop/hamburger swap, and keeps
 * the fixed mega-nav sitting directly beneath the Intuit brands bar.
 *
 * WHY THIS EXISTS
 * Intuit's nav is a client-side component that renders *different markup and
 * classes per viewport width*. Our capture ran at desktop width, so the
 * generated markup is frozen in the desktop variant: the brands bar is
 * visible, `S01MegaNav-is-desktop-abf7ba5` is applied, the horizontal links
 * list is present, and the mega-nav carries a baked `top: 30px`. Rendered at a
 * phone width that is wrong in three visible ways — the desktop links overflow
 * (clipped at ~608px inside a 390px viewport), the 30px brands strip still
 * occupies space that live does not, and everything below is pushed down 30px.
 *
 * WHAT LIVE ACTUALLY DOES (measured against the real page, per width)
 *   width >= 1120  brands bar visible (30px), `is-desktop` class, links list
 *                  present, mega-nav inline `top: 30px`
 *   width <  1120  brands bar carries `MGlobalNavigationBrands-hide-b0fb1fe`
 *                  (`display: none`), `is-hamburger-menu-c6ab1a2` replaces
 *                  `is-desktop`, the links list is absent from the DOM, and the
 *                  mega-nav inline `top` is `0px`
 * Confirmed at 390px and 1024px (hamburger) and at 1120px (desktop); the nav's
 * own CSS rules are scoped to `@media only screen and (min-width: 1120px)`,
 * which is why 1120 is the switch point rather than a guessed round number.
 *
 * The hamburger variant's CSS *was* captured, so applying live's own class
 * names is enough to get its layout — no restyling required. The one thing we
 * cannot reproduce is the burger BUTTON itself
 * (`S01MegaNav-overlay-navigation-button-*`) and its overlay menu: that markup
 * is only emitted by the component below 1120px, so a desktop capture never
 * received it. Its CSS is present but no element exists to style, and
 * fabricating one would invent UI the capture never saw. Documented in README.
 *
 * The offset is deliberately *measured* rather than hardcoded to 30px: reading
 * the bar's real height yields 0 exactly when it is hidden, so the nav offset
 * and the variant swap can never disagree.
 */

import type { Teardown } from './runtime';

/** Width at or above which live serves the desktop nav (see header comment). */
const DESKTOP_MIN_WIDTH = 1120;

const BRANDS_BAR = '#brands-navigation, .MGlobalNavigationBrands-top-navigation-ce29b8d';
const STICKY_NAV = '[data-mega-nav-sticky="true"]';

/** Live's own variant classes — applied verbatim, not invented. */
const NAV_DESKTOP_CLASS = 'S01MegaNav-is-desktop-abf7ba5';
const NAV_HAMBURGER_CLASS = 'S01MegaNav-is-hamburger-menu-c6ab1a2';
const BRANDS_HIDE_CLASS = 'MGlobalNavigationBrands-hide-b0fb1fe';

/**
 * Nav chrome live omits from the DOM entirely below 1120px. The hamburger CSS
 * contains no rule hiding these (live never needs one), so they must be hidden
 * here or the desktop links would still overflow the viewport.
 */
const DESKTOP_ONLY_NAV_PARTS = [
  '.S01MegaNav-links-list-8744423',
  '.S01MegaNav-contact-wrapper-ca935bd',
].join(', ');

/** Height to fall back on if the bar is rendered but reports no box yet. */
const FALLBACK_BAR_HEIGHT = 30;

export function initIntuitBrandsNav(root: ParentNode = document): Teardown | void {
  const bar = root.querySelector<HTMLElement>(BRANDS_BAR);
  const nav = root.querySelector<HTMLElement>(STICKY_NAV);
  if (!bar && !nav) return;

  // Snapshot once: these are the elements whose variant class flips.
  const variantEls = Array.from(
    root.querySelectorAll<HTMLElement>(`.${NAV_DESKTOP_CLASS}, .${NAV_HAMBURGER_CLASS}`),
  );
  const desktopOnly = Array.from(root.querySelectorAll<HTMLElement>(DESKTOP_ONLY_NAV_PARTS));

  // Captured state, so teardown can put the DOM back exactly as codegen left it.
  const initial = {
    navTop: nav?.style.top ?? '',
    barHidden: bar?.classList.contains(BRANDS_HIDE_CLASS) ?? false,
    variants: variantEls.map((el) => ({
      el,
      desktop: el.classList.contains(NAV_DESKTOP_CLASS),
      hamburger: el.classList.contains(NAV_HAMBURGER_CLASS),
    })),
    parts: desktopOnly.map((el) => ({ el, display: el.style.display, hidden: el.getAttribute('aria-hidden') })),
  };

  const desktopQuery = window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`);

  const applyVariant = (desktop: boolean) => {
    for (const el of variantEls) {
      el.classList.toggle(NAV_DESKTOP_CLASS, desktop);
      el.classList.toggle(NAV_HAMBURGER_CLASS, !desktop);
    }
    bar?.classList.toggle(BRANDS_HIDE_CLASS, !desktop);
    for (const el of desktopOnly) {
      el.style.display = desktop ? '' : 'none';
      if (desktop) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', 'true');
    }
  };

  /** Bar height, or 0 when it is not rendered. */
  const measure = (): number => {
    if (!bar) return 0;
    // display:none → no box and no offsetParent, which is exactly 0 offset.
    if (bar.offsetParent === null && bar.offsetHeight === 0) return 0;
    const height = Math.round(bar.getBoundingClientRect().height);
    return height > 0 ? height : FALLBACK_BAR_HEIGHT;
  };

  let appliedTop = -1;

  const applyOffset = () => {
    const top = measure();
    if (top === appliedTop) return;
    appliedTop = top;
    document.documentElement.style.setProperty('--nav-top', `${top}px`);
    if (nav) nav.style.top = `${top}px`;
  };

  const apply = () => {
    // Variant first: the offset depends on whether the bar ends up hidden.
    applyVariant(desktopQuery.matches);
    applyOffset();
  };

  apply();

  const onChange = () => apply();
  desktopQuery.addEventListener('change', onChange);
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);

  // Catches the bar changing height without a resize event (font swap etc).
  let observer: ResizeObserver | undefined;
  if (bar && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => applyOffset());
    observer.observe(bar);
  }

  return () => {
    desktopQuery.removeEventListener('change', onChange);
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
    observer?.disconnect();

    document.documentElement.style.removeProperty('--nav-top');
    if (nav) nav.style.top = initial.navTop;
    bar?.classList.toggle(BRANDS_HIDE_CLASS, initial.barHidden);
    for (const { el, desktop, hamburger } of initial.variants) {
      el.classList.toggle(NAV_DESKTOP_CLASS, desktop);
      el.classList.toggle(NAV_HAMBURGER_CLASS, hamburger);
    }
    for (const { el, display, hidden } of initial.parts) {
      el.style.display = display;
      if (hidden === null) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', hidden);
    }
  };
}
