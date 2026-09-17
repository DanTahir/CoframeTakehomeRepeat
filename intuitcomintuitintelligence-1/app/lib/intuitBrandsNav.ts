/**
 * The brand strip / fixed-nav offset, ported from the live page's mega-nav bundle.
 *
 * The captured DOM ships `#brands-navigation` (the turbotax / creditkarma / quickbooks /
 * mailchimp row) with no breakpoint state on it, and ships the fixed nav with no inline
 * `top`. Live's own JS maintains both per breakpoint. Measured directly on live at
 * 375 / 768 / 1023 / 1024 / 1119 / 1120 / 1280 / 1440 (scrape/probe-nav-breakpoint.mjs):
 *
 *   width  < 1120  `#brands-navigation` carries `MGlobalNavigationBrands-hide-b0fb1fe`
 *                  (-> `display:none`, 0x0) and the fixed nav sits at inline `top: 0px`
 *   width >= 1120  the strip is `display:flex` at inline `height: 30px`, and the fixed nav
 *                  is pushed below it with inline `top: 30px`
 *
 * 1120 is not a guess. It is the page's own breakpoint: `app/generated/inline-15-body1.css`
 * has `@media only screen and (min-width: 1120px)` repadding exactly these two components
 * (`MGlobalNavigationBrands-top-navigation` and `S01MegaNav-main-navigation`), and live is
 * still in the narrow state at 1119 and in the wide state at 1120.
 *
 * Two things go wrong without this:
 *   - below 1120 the strip stays in flow, so the document is 30px taller than live at every
 *     phone/tablet width (measured 10161 local vs 10015 live at 375), shifting every slice
 *     below it;
 *   - at and above 1120 the strip is painted *underneath* the fixed nav instead of above it.
 *     The strip is `position:static`, so its `z-index:99` is ignored and the fixed nav's
 *     `z-index:7` wins -- which is why the live/local composites differ by a whole 30px row
 *     at the top of the page on desktop.
 *
 * Live also swaps a `brands` marker class onto the nav wrapper at >=1120. No CSS selector
 * anywhere in the captured stylesheets matches a bare `.brands`, so it is not reproduced
 * here; only the two things that actually change rendered geometry are.
 */
import { rafThrottle, type Teardown } from './runtime';

/** The page's own `@media (min-width: 1120px)` boundary. */
const BRANDS_BREAKPOINT = 1120;

/** Live's inline height on the strip, present at every width whether shown or hidden. */
const BRANDS_HEIGHT = 30;

/** `.MGlobalNavigationBrands-hide-b0fb1fe{display:none}` — verified present in vendor-12. */
const BRANDS_HIDE_CLASS = 'MGlobalNavigationBrands-hide-b0fb1fe';

const BRANDS_SELECTOR = '#brands-navigation, [class*="MGlobalNavigationBrands-top-navigation"]';
const FIXED_NAV_SELECTOR = '[class*="S01MegaNav-top-fixed"]';

export function initBrandsNav(root: ParentNode = document): Teardown | void {
  const strip = root.querySelector<HTMLElement>(BRANDS_SELECTOR);
  if (!strip) return;

  const nav = root.querySelector<HTMLElement>(FIXED_NAV_SELECTOR);

  const apply = () => {
    const wide = window.innerWidth >= BRANDS_BREAKPOINT;

    strip.style.height = `${BRANDS_HEIGHT}px`;
    strip.classList.toggle(BRANDS_HIDE_CLASS, !wide);

    // `position:fixed` and `z-index:7` already come from `S01MegaNav-top-fixed-*`; live
    // restates them inline, but `top` is the only one whose value actually changes.
    if (nav) nav.style.top = wide ? `${BRANDS_HEIGHT}px` : '0px';
  };

  const onResize = rafThrottle(apply);
  apply();
  window.addEventListener('resize', onResize, { passive: true });

  return () => {
    window.removeEventListener('resize', onResize);
    strip.style.removeProperty('height');
    strip.classList.remove(BRANDS_HIDE_CLASS);
    nav?.style.removeProperty('top');
  };
}
