/**
 * Flickity-backed carousels, ported from scrape/raw/js/intelligence.a7cda79c.js
 * (minified class `ge` = the discover carousel, class `_e` = the feature/trust card
 * carousels) plus the horizontal wheel-drag helper `te` from disclaimer.js.
 *
 * Note the asymmetry, straight from the source:
 *   - `.discover__track` is a Flickity carousel at *every* width — only its options change
 *     across the breakpoint (desktop centres and un-contains its cells), so this is
 *     layout-affecting on desktop too, not just a mobile nicety;
 *   - `.features__cards` / `.trust__cards` are only Flickity below 768px and fall back to
 *     the CSS grid above it.
 *
 * Flickity is loaded dynamically so it never runs during SSR.
 */

import type Flickity from 'flickity';
import type { FlickityOptions } from 'flickity';

/** `Ee` / `Te` — both controllers use the same breakpoint. */
const MOBILE_QUERY = '(max-width: 767.98px)';
/** `Gt` / `jt` — horizontal wheel accumulation before advancing, and the reset debounce. */
const WHEEL_STEP_PX = 40;
const WHEEL_RESET_MS = 140;
/** The card carousels re-sync on a debounced resize. */
const RESIZE_DEBOUNCE_MS = 150;
/** Trailing spacer so the last cell can scroll clear of the viewport edge on mobile. */
const SPACER_WIDTH = '40px';

type FlickityCtor = typeof Flickity;
type FlickityInstance = Flickity;

let loader: Promise<FlickityCtor> | null = null;

function loadFlickity(): Promise<FlickityCtor> {
  if (!loader) {
    loader = import('flickity').then(
      (module) => (module.default ?? module) as FlickityCtor,
    );
  }
  return loader;
}

function makeSpacer(): HTMLElement {
  const spacer = document.createElement('div');
  spacer.className = 'carousel-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  spacer.style.width = SPACER_WIDTH;
  return spacer;
}

/**
 * `te` — lets a horizontal wheel/trackpad gesture drive the carousel, swallowing the event
 * so the page does not scroll sideways instead.
 */
function bindWheelDrag(instance: FlickityInstance, track: HTMLElement): () => void {
  let accumulated = 0;
  let advanced = false;
  let resetTimer: number | null = null;

  const reset = () => {
    accumulated = 0;
    advanced = false;
  };

  const onWheel = (event: WheelEvent) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    if (instance.isAnimating) return;
    event.preventDefault();
    if (resetTimer !== null) window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(reset, WHEEL_RESET_MS);
    if (advanced) return;
    accumulated += event.deltaX;
    if (Math.abs(accumulated) < WHEEL_STEP_PX) return;
    if (accumulated > 0) instance.next();
    else instance.previous();
    advanced = true;
    accumulated = 0;
  };

  track.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    if (resetTimer !== null) window.clearTimeout(resetTimer);
    track.removeEventListener('wheel', onWheel);
  };
}

/** `ge` — the discover carousel: always on, rebuilt when the breakpoint flips. */
class DiscoverCarousel {
  private readonly track: HTMLElement | null;
  private readonly mobile: MediaQueryList | null = null;
  private readonly onBreakpoint: () => void;

  private instance: FlickityInstance | null = null;
  private spacer: HTMLElement | null = null;
  private unbindWheel: (() => void) | null = null;
  private destroyed = false;

  constructor(block: HTMLElement) {
    this.track = block.querySelector<HTMLElement>('.discover__track');
    this.onBreakpoint = () => {
      this.syncSpacer();
      void this.build();
    };
    if (!this.track) return;
    this.mobile = window.matchMedia(MOBILE_QUERY);
    this.mobile.addEventListener('change', this.onBreakpoint);
    this.syncSpacer();
    void this.build();
  }

  /** Desktop centres the cells and lets them overflow; mobile left-aligns and contains them. */
  private options(): FlickityOptions {
    const desktop = !this.mobile!.matches;
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

  private async build(): Promise<void> {
    if (!this.track) return;
    const Ctor = await loadFlickity();
    if (this.destroyed || !this.track) return;

    const initialIndex = this.instance ? this.instance.selectedIndex : 0;
    this.teardownInstance();

    this.instance = new Ctor(this.track, { ...this.options(), initialIndex });
    this.unbindWheel = bindWheelDrag(this.instance, this.track);
  }

  private teardownInstance(): void {
    this.unbindWheel?.();
    this.unbindWheel = null;
    this.instance?.destroy();
    this.instance = null;
  }

  /** The spacer is a real cell once Flickity owns the track, so it must be added via the API. */
  private syncSpacer(): void {
    if (!this.track || !this.mobile) return;
    if (this.mobile.matches) {
      if (this.spacer) return;
      this.spacer = makeSpacer();
      if (this.instance) this.instance.append(this.spacer);
      else this.track.appendChild(this.spacer);
      this.track.classList.add('has-carousel-spacer');
    } else {
      if (!this.spacer) return;
      if (this.instance) this.instance.remove(this.spacer);
      else this.spacer.remove();
      this.spacer = null;
      this.track.classList.remove('has-carousel-spacer');
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.mobile?.removeEventListener('change', this.onBreakpoint);
    this.teardownInstance();
    this.spacer?.remove();
    this.spacer = null;
    this.track?.classList.remove('has-carousel-spacer');
  }
}

/** `_e` — feature/trust card tracks: Flickity below 768px only, CSS grid above it. */
class CardCarousel {
  private readonly track: HTMLElement;
  private readonly mobile: MediaQueryList;
  private readonly onChange: () => void;
  private readonly onResize: () => void;

  private instance: FlickityInstance | null = null;
  private spacer: HTMLElement | null = null;
  private unbindWheel: (() => void) | null = null;
  private resizeTimer: number | null = null;
  private destroyed = false;
  private building = false;

  constructor(track: HTMLElement) {
    this.track = track;
    this.mobile = window.matchMedia(MOBILE_QUERY);
    this.onChange = () => void this.sync();
    this.onResize = () => {
      if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => void this.sync(), RESIZE_DEBOUNCE_MS);
    };
    this.mobile.addEventListener('change', this.onChange);
    window.addEventListener('resize', this.onResize, { passive: true });
    void this.sync();
  }

  private async sync(): Promise<void> {
    if (this.destroyed) return;
    if (this.mobile.matches) await this.enable();
    else this.disable();
  }

  private async enable(): Promise<void> {
    if (this.instance || this.building) return;
    this.building = true;
    try {
      const Ctor = await loadFlickity();
      // The breakpoint may have flipped back while the chunk was loading.
      if (this.destroyed || this.instance || !this.mobile.matches) return;

      this.spacer = makeSpacer();
      this.track.appendChild(this.spacer);
      this.track.classList.add('has-carousel-spacer');

      this.instance = new Ctor(this.track, {
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
      this.unbindWheel = bindWheelDrag(this.instance, this.track);
    } finally {
      this.building = false;
    }
  }

  private disable(): void {
    if (!this.instance) return;
    this.unbindWheel?.();
    this.unbindWheel = null;
    this.instance.destroy();
    this.instance = null;
    this.spacer?.remove();
    this.spacer = null;
    this.track.classList.remove('has-carousel-spacer');
  }

  destroy(): void {
    this.destroyed = true;
    this.mobile.removeEventListener('change', this.onChange);
    window.removeEventListener('resize', this.onResize);
    if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
    this.disable();
  }
}

export function initDiscoverCarousels(scope: ParentNode = document): () => void {
  const instances = [...scope.querySelectorAll<HTMLElement>('.discover')].map(
    (block) => new DiscoverCarousel(block),
  );
  return () => {
    for (const instance of instances) instance.destroy();
  };
}

export function initCardCarousels(scope: ParentNode = document): () => void {
  const instances = [
    ...scope.querySelectorAll<HTMLElement>('.features__cards, .trust__cards'),
  ].map((track) => new CardCarousel(track));
  return () => {
    for (const instance of instances) instance.destroy();
  };
}
