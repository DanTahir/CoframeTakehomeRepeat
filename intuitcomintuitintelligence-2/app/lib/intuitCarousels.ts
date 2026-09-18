/**
 * Carousels, ported from the original page's `intelligence.js`.
 *
 * Flickity is the only carousel library the live page uses (bundled inside its
 * `disclaimer.js` chunk) and it is v3 — verified against the captured bundle by
 * its generated DOM markers (`flickity-page-dots` built from `<button>`
 * elements, not the `<ol>` markup v2 emits). We install the matching major from
 * npm and load it dynamically so it stays out of the first paint.
 *
 * Flickity's CSS is deliberately NOT imported here: the captured site
 * stylesheets already contain the `.flickity-enabled` / `.flickity-viewport` /
 * `.flickity-page-dots` rules (plus Intuit's own overrides), so importing the
 * package's CSS as well would duplicate the cascade and could win over those
 * overrides.
 *
 * Two distinct carousels exist on this page:
 *  - `.discover .discover__track` — always a carousel, but centred+uncontained
 *    on desktop vs. left-aligned+contained on mobile, so it is rebuilt when the
 *    breakpoint changes.
 *  - `.features__cards` / `.trust__cards` — a plain grid on desktop that only
 *    becomes a carousel below the mobile breakpoint.
 */

import type { Teardown } from './runtime';

/** The mobile breakpoint both carousels switch on. */
const MOBILE_QUERY = '(max-width: 767.98px)';
/** Width of the trailing spacer cell that lets the last card clear the edge. */
const SPACER_WIDTH = '40px';
/** Horizontal wheel travel needed to advance a slide. */
const WHEEL_THRESHOLD = 40;
/** Idle gap after which accumulated wheel delta is forgotten. */
const WHEEL_RESET_MS = 140;
/** Debounce for the resize-driven re-sync of the mobile-only carousel. */
const RESIZE_DEBOUNCE_MS = 150;

/** The slice of Flickity's API these carousels actually touch. */
export interface FlickityInstance {
  selectedIndex: number;
  isAnimating: boolean;
  next(): void;
  previous(): void;
  select(index: number): void;
  append(element: Element): void;
  remove(element: Element): void;
  destroy(): void;
}

type FlickityCtor = new (element: Element, options: Record<string, unknown>) => FlickityInstance;

export type FlickityLoader = () => Promise<unknown>;

const defaultLoader: FlickityLoader = () => import('flickity');

async function loadFlickity(load: FlickityLoader): Promise<FlickityCtor> {
  const mod = (await load()) as { default?: unknown };
  // Flickity's UMD build exposes the constructor as the module's default under
  // ESM interop, but as the namespace itself under CJS interop.
  return (mod.default ?? mod) as FlickityCtor;
}

/**
 * Horizontal-wheel navigation (trackpad swipe). Flickity has no built-in
 * equivalent, so the original page adds its own: accumulate horizontal delta,
 * fire once past the threshold, then latch until the gesture goes idle so one
 * long swipe advances exactly one slide.
 */
export function attachWheelNav(
  flickity: FlickityInstance | null,
  element: HTMLElement | null,
): Teardown | void {
  if (!flickity || !element) return;

  let delta = 0;
  let latched = false;
  let idleTimer: number | null = null;

  const reset = () => {
    delta = 0;
    latched = false;
  };

  const onWheel = (event: WheelEvent) => {
    // Vertical-dominant gestures belong to the page, not the carousel.
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    if (flickity.isAnimating) return;

    event.preventDefault();
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = window.setTimeout(reset, WHEEL_RESET_MS);

    if (latched) return;
    delta += event.deltaX;
    if (Math.abs(delta) < WHEEL_THRESHOLD) return;

    if (delta > 0) flickity.next();
    else flickity.previous();
    latched = true;
    delta = 0;
  };

  // Non-passive: the handler calls preventDefault to stop the page scrolling
  // sideways while the carousel consumes the gesture.
  element.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    element.removeEventListener('wheel', onWheel);
  };
}

/**
 * `.discover` — a carousel at every width, but with different alignment and
 * containment per breakpoint, which Flickity can only apply at construction.
 */
class DiscoverCarousel {
  private readonly track: HTMLElement | null;
  private readonly mobile: MediaQueryList;
  private readonly onBreakpoint: () => void;
  private flickity: FlickityInstance | null = null;
  private spacer: HTMLElement | null = null;
  // Assigned on every (re)build; `undefined` until the first one.
  private detachWheel: Teardown | void = undefined;
  private destroyed = false;

  constructor(
    block: HTMLElement,
    private readonly Flickity: FlickityCtor,
  ) {
    this.track = block.querySelector('.discover__track');
    this.mobile = window.matchMedia(MOBILE_QUERY);
    this.onBreakpoint = () => {
      this.syncSpacer();
      this.build();
    };

    if (!this.track) return;
    this.mobile.addEventListener('change', this.onBreakpoint);
    this.syncSpacer();
    this.build();
  }

  private options(): Record<string, unknown> {
    const desktop = !this.mobile.matches;
    return {
      pageDots: true,
      prevNextButtons: false,
      draggable: true,
      dragThreshold: 30,
      autoPlay: false,
      cellAlign: desktop ? 'center' : 'left',
      contain: !desktop,
      imagesLoaded: true,
    };
  }

  /** Rebuilds in place, preserving the slide the visitor was looking at. */
  private build(): void {
    if (this.destroyed || !this.track) return;
    const initialIndex = this.flickity ? this.flickity.selectedIndex : 0;

    if (this.detachWheel) this.detachWheel();
    this.detachWheel = undefined;
    if (this.flickity) {
      this.flickity.destroy();
      this.flickity = null;
    }

    this.flickity = new this.Flickity(this.track, { ...this.options(), initialIndex });
    this.detachWheel = attachWheelNav(this.flickity, this.track);
  }

  /**
   * Mobile needs a trailing spacer cell so the final card can scroll clear of
   * the screen edge. It has to be added THROUGH Flickity once initialised, or
   * Flickity never measures it as a cell.
   */
  private syncSpacer(): void {
    if (!this.track) return;

    if (this.mobile.matches) {
      if (this.spacer) return;
      this.spacer = document.createElement('div');
      this.spacer.className = 'carousel-spacer';
      this.spacer.setAttribute('aria-hidden', 'true');
      this.spacer.style.width = SPACER_WIDTH;
      if (this.flickity) this.flickity.append(this.spacer);
      else this.track.appendChild(this.spacer);
      this.track.classList.add('has-carousel-spacer');
      return;
    }

    if (!this.spacer) return;
    if (this.flickity) this.flickity.remove(this.spacer);
    else this.spacer.remove();
    this.spacer = null;
    this.track.classList.remove('has-carousel-spacer');
  }

  destroy(): void {
    this.destroyed = true;
    this.mobile.removeEventListener('change', this.onBreakpoint);
    if (this.detachWheel) this.detachWheel();
    this.flickity?.destroy();
    this.flickity = null;
    this.spacer?.remove();
    this.spacer = null;
    this.track?.classList.remove('has-carousel-spacer');
  }
}

/**
 * `.features__cards` / `.trust__cards` — desktop keeps the native CSS grid;
 * only mobile gets a carousel, so Flickity is constructed and destroyed as the
 * breakpoint is crossed.
 */
class MobileCardsCarousel {
  private readonly mobile: MediaQueryList;
  private readonly onChange: () => void;
  private readonly onResize: () => void;
  private flickity: FlickityInstance | null = null;
  private spacer: HTMLElement | null = null;
  // Assigned on every (re)build; `undefined` until the first one.
  private detachWheel: Teardown | void = undefined;
  private resizeTimer: number | null = null;
  private destroyed = false;

  constructor(
    private readonly track: HTMLElement,
    private readonly Flickity: FlickityCtor,
  ) {
    this.mobile = window.matchMedia(MOBILE_QUERY);
    this.onChange = () => this.sync();
    this.mobile.addEventListener('change', this.onChange);

    // Belt-and-braces alongside the media query: iOS reports a breakpoint
    // change late when the URL bar collapses, so a debounced resize re-checks.
    this.onResize = () => {
      if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(this.onChange, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener('resize', this.onResize, { passive: true });

    this.sync();
  }

  private sync(): void {
    if (this.destroyed) return;
    if (this.mobile.matches) this.enable();
    else this.disable();
  }

  private enable(): void {
    if (this.flickity) return;

    this.spacer = document.createElement('div');
    this.spacer.className = 'carousel-spacer';
    this.spacer.setAttribute('aria-hidden', 'true');
    this.spacer.style.width = SPACER_WIDTH;
    this.track.appendChild(this.spacer);
    this.track.classList.add('has-carousel-spacer');

    this.flickity = new this.Flickity(this.track, {
      pageDots: true,
      prevNextButtons: false,
      draggable: true,
      dragThreshold: 30,
      autoPlay: false,
      cellAlign: 'left',
      contain: true,
      imagesLoaded: true,
      initialIndex: 0,
      groupCells: false,
    });
    this.detachWheel = attachWheelNav(this.flickity, this.track);
  }

  private disable(): void {
    if (!this.flickity) return;
    if (this.detachWheel) this.detachWheel();
    this.detachWheel = undefined;
    this.flickity.destroy();
    this.flickity = null;
    this.spacer?.remove();
    this.spacer = null;
    this.track.classList.remove('has-carousel-spacer');
  }

  destroy(): void {
    this.destroyed = true;
    this.mobile.removeEventListener('change', this.onChange);
    window.removeEventListener('resize', this.onResize);
    if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
    this.disable();
  }
}

/**
 * Builds every carousel on the page. Async because Flickity is code-split;
 * the returned teardown is safe to call while the import is still in flight.
 */
export function createIntuitCarousels(
  { load = defaultLoader }: { load?: FlickityLoader } = {},
) {
  return (root: ParentNode = document): Teardown | void => {
    const discoverBlocks = Array.from(root.querySelectorAll<HTMLElement>('.discover'));
    const cardTracks = Array.from(
      root.querySelectorAll<HTMLElement>('.features__cards, .trust__cards'),
    );
    if (!discoverBlocks.length && !cardTracks.length) return;

    let cancelled = false;
    const carousels: Array<{ destroy(): void }> = [];

    void loadFlickity(load)
      .then((Flickity) => {
        if (cancelled) return;
        for (const block of discoverBlocks) carousels.push(new DiscoverCarousel(block, Flickity));
        for (const track of cardTracks) carousels.push(new MobileCardsCarousel(track, Flickity));
      })
      .catch((error) => {
        // A failed chunk must leave a readable, scrollable grid behind rather
        // than taking the rest of the runtime down with it.
        console.error('[replica] flickity failed to load:', error);
      });

    return () => {
      cancelled = true;
      for (const carousel of carousels) carousel.destroy();
      carousels.length = 0;
    };
  };
}
