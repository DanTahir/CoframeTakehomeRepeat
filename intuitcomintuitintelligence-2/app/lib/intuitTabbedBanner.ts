/**
 * The tabbed banner, ported from the original page's `prefooter.js`.
 *
 * Each tab owns a panel containing a `.video-player`. The banner auto-advances,
 * but its progress clock is driven by the ACTIVE VIDEO's `currentTime` rather
 * than wall time whenever a video is present, so the progress bar tracks real
 * playback (and stalls when the video stalls). Only when a panel has no video
 * does it fall back to a fixed 6s per tab.
 *
 * Panel video playback is delegated to the `VideoPlayer` instances registered
 * by `intuitVideo.ts`: selecting a tab restarts its video and deselects the
 * others, which is why that module must initialise first.
 */

import { videoPlayerFor } from './intuitVideo';
import type { Teardown } from './runtime';

/** Per-tab duration when the panel has no video to pace against. */
const AUTO_ADVANCE_MS = 6000;
/**
 * The live build ships this disabled: hovering the banner does NOT pause the
 * rotation (only hovering the active tab does). Kept as a named constant
 * because it also gates the `is-hovered` class, which therefore never applies.
 */
const PAUSE_ON_BANNER_HOVER = false;
/** Minimum horizontal travel for a swipe to change tabs. */
const SWIPE_MIN_PX = 45;
/** Horizontal travel must exceed vertical by this factor to count as a swipe. */
const SWIPE_RATIO = 1.4;
/** Left inset when scrolling an overflowing tab strip to the active tab. */
const TAB_SCROLL_INSET = 30;
/** The banner rotates only while this much of it is on screen. */
const VISIBILITY_THRESHOLD = 0.35;

class TabbedBanner {
  private readonly root: HTMLElement;
  private readonly tabs: HTMLElement[];
  private readonly panels: HTMLElement[];
  private readonly tabList: HTMLElement | null = null;
  private readonly banner: HTMLElement | null = null;
  private readonly cleanups: Array<() => void> = [];
  private observer?: IntersectionObserver;
  private readyFrame = 0;

  private index = 0;
  private elapsed = 0;
  private lastFrame = 0;
  private rafId: number | null = null;
  /** The visitor took control, so auto-advance stays off until out of view. */
  private manual = false;
  private inView = false;
  private hoverTab = false;
  private hoverBanner = false;
  private activeVideo: HTMLVideoElement | null = null;
  private lastVideoTime = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.tabs = Array.from(root.querySelectorAll<HTMLElement>('.tabbed-banner__tab'));
    this.panels = Array.from(root.querySelectorAll<HTMLElement>('.tabbed-banner__panel'));
    if (!this.tabs.length) return;

    this.tabList = root.querySelector('.tabbed-banner__tabs ul');
    this.banner = root.querySelector('.tabbed-banner__banner');

    this.bind();
    this.select(0, { resetProgress: true });
    // One frame later so the initial selection isn't animated in.
    this.readyFrame = requestAnimationFrame(() => this.root.classList.add('is-ready'));

    this.observer = new IntersectionObserver(([entry]) => this.onVisibility(entry.isIntersecting), {
      threshold: VISIBILITY_THRESHOLD,
    });
    this.observer.observe(root);
  }

  private on(target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions): void {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  private bind(): void {
    this.tabs.forEach((tab, i) => {
      this.on(tab, 'click', () => {
        if (i !== this.index) this.manual = true;
        this.select(i, { resetProgress: true });
        if (this.manual) this.stop();
      });
      // Only the ACTIVE tab's hover pauses progress — hovering a different tab
      // shouldn't freeze the bar the visitor is watching.
      this.on(tab, 'pointerenter', () => {
        if (i === this.index) this.hoverTab = true;
      });
      this.on(tab, 'pointerleave', () => {
        if (i === this.index) this.hoverTab = false;
      });
      this.on(tab, 'keydown', (event) => this.onKeydown(event as KeyboardEvent, i));
    });

    if (this.banner) {
      this.on(this.banner, 'pointerenter', () => {
        this.hoverBanner = true;
      });
      this.on(this.banner, 'pointerleave', () => {
        this.hoverBanner = false;
      });
    }
    this.bindSwipe();
  }

  /** Touch/pen swipe across the banner changes tabs. */
  private bindSwipe(): void {
    if (!this.banner) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;

    this.on(
      this.banner,
      'pointerdown',
      (event) => {
        const pointer = event as PointerEvent;
        if (pointer.pointerType === 'mouse') return;
        tracking = true;
        startX = pointer.clientX;
        startY = pointer.clientY;
      },
      { passive: true },
    );

    const onUp = (event: Event) => {
      if (!tracking) return;
      tracking = false;
      const pointer = event as PointerEvent;
      const dx = pointer.clientX - startX;
      const dy = pointer.clientY - startY;
      // Too short, or too vertical to be a deliberate horizontal swipe.
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;

      const next =
        dx < 0
          ? (this.index + 1) % this.tabs.length
          : (this.index - 1 + this.tabs.length) % this.tabs.length;
      this.manual = true;
      this.select(next, { resetProgress: true });
      this.stop();
    };

    this.on(this.banner, 'pointerup', onUp, { passive: true });
    this.on(
      this.banner,
      'pointercancel',
      () => {
        tracking = false;
      },
      { passive: true },
    );
  }

  private get paused(): boolean {
    return this.hoverTab || (PAUSE_ON_BANNER_HOVER && this.hoverBanner);
  }

  private onKeydown(event: KeyboardEvent, from: number): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (from + step + this.tabs.length) % this.tabs.length;
    this.manual = true;
    this.select(next, { resetProgress: true });
    this.stop();
    this.tabs[next].focus();
  }

  private onVisibility(visible: boolean): void {
    this.inView = visible;
    if (!visible) {
      // Leaving the viewport also clears manual control, so the banner is
      // freshly auto-rotating next time it is scrolled back into view.
      this.stop();
      this.manual = false;
      return;
    }
    if (!this.manual) this.start();
  }

  private select(index: number, { resetProgress = false }: { resetProgress?: boolean } = {}): void {
    this.index = index;

    this.tabs.forEach((tab, i) => {
      const active = i === index;
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      // Roving tabindex: only the selected tab is in the tab order.
      tab.setAttribute('tabindex', active ? '0' : '-1');
      if (!active) tab.style.setProperty('--tab-progress', '0');
      tab.classList.toggle('is-hovered', active && PAUSE_ON_BANNER_HOVER);
    });

    this.activeVideo = null;
    this.panels.forEach((panel, i) => {
      const active = i === index;
      panel.classList.toggle('is-active', active);
      const video = panel.querySelector('video');
      if (!video) return;
      if (active) this.activeVideo = video;
      // Restart the newly-selected panel's video from the top.
      videoPlayerFor(video)?.setSelected(active, { restart: active });
    });

    if (resetProgress) {
      this.elapsed = 0;
      this.lastVideoTime = 0;
      this.setProgress(0);
    }
    this.scrollTabIntoView(index);
  }

  /** Keeps the active tab visible when the strip overflows (mobile). */
  private scrollTabIntoView(index: number): void {
    if (!this.tabList || this.tabList.scrollWidth <= this.tabList.clientWidth) return;
    const tab = this.tabs[index];
    const item = tab.closest('li') ?? tab;
    this.tabList.scrollTo({
      left: (item as HTMLElement).offsetLeft - this.tabList.offsetLeft - TAB_SCROLL_INSET,
      behavior: 'smooth',
    });
  }

  private setProgress(value: number): void {
    this.tabs[this.index]?.style.setProperty('--tab-progress', String(value));
  }

  private start(): void {
    if (this.rafId !== null) return;
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
    this.syncFilling();
  }

  private stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.syncFilling();
  }

  /**
   * `is-filling` drives the CSS progress animation, and must only be on while
   * the clock is genuinely advancing — including "video present and actually
   * decoding", otherwise the bar animates through a buffering stall.
   */
  private syncFilling(): void {
    const filling =
      this.rafId !== null &&
      !this.paused &&
      (!this.activeVideo || (!this.activeVideo.paused && this.activeVideo.readyState >= 2));
    this.root.classList.toggle('is-filling', filling);
  }

  private currentTabDuration(): number {
    const duration = this.activeVideo?.duration;
    if (duration && Number.isFinite(duration) && duration > 0) return duration * 1000;
    return AUTO_ADVANCE_MS;
  }

  private tick = (now: number): void => {
    const delta = now - this.lastFrame;
    this.lastFrame = now;

    // Video looped or was restarted under us: restart the progress bar too.
    if (this.activeVideo && this.activeVideo.currentTime < this.lastVideoTime) this.elapsed = 0;

    if (!this.paused) {
      // Media time when there's a video, wall time otherwise.
      this.elapsed += this.activeVideo
        ? Math.max(0, (this.activeVideo.currentTime - (this.lastVideoTime ?? this.activeVideo.currentTime)) * 1000)
        : delta;

      const duration = this.currentTabDuration();
      const finished =
        this.elapsed >= duration ||
        this.activeVideo?.ended ||
        videoPlayerFor(this.activeVideo)?.completed;

      if (finished) this.select((this.index + 1) % this.tabs.length, { resetProgress: true });
      else this.setProgress(this.elapsed / duration);
    }

    this.lastVideoTime = this.activeVideo?.currentTime ?? 0;
    this.syncFilling();
    this.rafId = requestAnimationFrame(this.tick);
  };

  destroy(): void {
    this.stop();
    cancelAnimationFrame(this.readyFrame);
    this.observer?.disconnect();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.root.classList.remove('is-ready', 'is-filling');
  }
}

/** Builds every `.tabbed-banner` on the page. */
export function initIntuitTabbedBanners(root: ParentNode = document): Teardown | void {
  const banners = Array.from(root.querySelectorAll<HTMLElement>('.tabbed-banner'));
  if (!banners.length) return;
  const instances = banners.map((banner) => new TabbedBanner(banner));
  return () => {
    for (const instance of instances) instance.destroy();
  };
}

/**
 * One-shot reveal for the banner inside `.intro`.
 *
 * `is-inview` gates that block's opacity/transform in the captured CSS, and the
 * original observer unobserves after the first hit — so this is a reveal, not a
 * scroll-linked effect. Without it the intro banner ships invisible.
 */
export function initIntroBannerReveal(root: ParentNode = document): Teardown | void {
  const banners = Array.from(root.querySelectorAll<HTMLElement>('.intro .tabbed-banner'));
  if (!banners.length) return;

  if (!('IntersectionObserver' in window)) {
    for (const banner of banners) banner.classList.add('is-inview');
    return;
  }

  const observer = new IntersectionObserver(
    (entries, self) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-inview');
        self.unobserve(entry.target);
      }
    },
    { threshold: 0, rootMargin: '0px 0px -20% 0px' },
  );
  for (const banner of banners) observer.observe(banner);
  return () => observer.disconnect();
}
