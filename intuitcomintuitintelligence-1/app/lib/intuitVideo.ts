/**
 * Video players + the tabbed banner that drives them.
 *
 * Ported from the live page's own bundle: scrape/raw/js/prefooter.a922aff5.js
 * (minified class `F` = video player, class `I` = tabbed banner). The two are coupled
 * through a WeakMap registry: selecting a tab calls `setSelected()` on the player inside
 * that panel, and the tab's progress bar is driven by that video's `currentTime`.
 *
 * Both are mandatory for correct rendering, not just motion:
 *   - `.video-player` is `opacity:0;transform:translateY(24px)` until `is-visible`,
 *   - `.tabbed-banner__panel` is `opacity:0;visibility:hidden` until `is-active`, and the
 *     captured SSR markup marks *all four* panels `is-active`, so `select(0)` on mount is
 *     what collapses them down to the single visible panel.
 */

const DEFAULT_TAB_MS = 6000; // `E` — fallback when a tab has no video
const PAUSE_ON_HOVER = false; // `b` — present in the original but hard-disabled
const SWIPE_MIN_PX = 45; // `S`
const SWIPE_RATIO = 1.4; // `T`

/** Shared registry so the tabbed banner can reach the player inside each panel. */
const players = new WeakMap<HTMLVideoElement, VideoPlayer>();

/**
 * `Kt` from disclaimer.js: re-points a <video> at whichever <source media> matches now.
 *
 * This page DOES ship `source[media]` elements -- 8 of them, verified in the generated
 * markup: the four tab videos (TT/CK/MC/QB) each carry a `(max-width: 767px)` portrait
 * source and a `(min-width: 768px)` landscape one. So this function is live, and it is
 * what picks the right variant per breakpoint (an earlier note here claiming zero such
 * elements was simply wrong).
 *
 * Consequence worth knowing before reading a viewport-gate report: Chromium does not
 * honour `media` on a `<source>` inside `<video>`, so the browser begins fetching the
 * FIRST source, then this assigns `video.src`, which cancels that in-flight fetch. The
 * gate therefore lists those videos under "failed requests" with the files present on
 * disk and returning 200/206. The live site's own `Kt` does exactly the same thing, and
 * `npm run viewports:live` shows the identical aborts against its digitalasset.intuit.com
 * `/intro/desktop/` and `/intro/mobile/` URLs -- so this is fidelity, not a defect, and
 * the gate does not count failed requests as a failure condition.
 */
function syncSource(video: HTMLVideoElement): boolean {
  const sources = [...video.querySelectorAll<HTMLSourceElement>('source[media]')];
  if (!sources.length) return false;
  const match = sources.find((source) => window.matchMedia(source.media).matches);
  const next = match?.src;
  if (!next) return false;
  const current = video.getAttribute('src') || video.currentSrc;
  if (current && new URL(current, document.baseURI).href === new URL(next, document.baseURI).href) {
    return false;
  }
  video.src = next;
  return true;
}

type PlaybackOptions = { onPlaying?: () => void; onFailure?: () => void };

/**
 * `Zt` from disclaimer.js: keeps a muted video playing while it is "active", and copes with
 * browsers that refuse autoplay by retrying after the first user gesture.
 */
class PlaybackManager {
  private readonly video: HTMLVideoElement;
  private readonly options: PlaybackOptions;
  private active = false;
  private destroyed = false;
  private gestureArmed = false;

  constructor(video: HTMLVideoElement, options: PlaybackOptions = {}) {
    this.video = video;
    this.options = options;
  }

  setActive(active: boolean): void {
    if (this.destroyed || this.active === active) return;
    this.active = active;
    if (active) this.attempt();
    else this.video.pause();
  }

  attempt(force = false): void {
    if (this.destroyed) return;
    if (force) this.active = true;
    if (!this.active) return;
    this.video.muted = true;
    const played = this.video.play();
    if (!played) {
      this.options.onPlaying?.();
      return;
    }
    played.then(
      () => this.options.onPlaying?.(),
      () => {
        this.options.onFailure?.();
        this.armGestureRetry();
      },
    );
  }

  private armGestureRetry(): void {
    if (this.gestureArmed) return;
    this.gestureArmed = true;
    const events = ['pointerdown', 'touchstart', 'keydown'];
    const retry = () => {
      for (const event of events) window.removeEventListener(event, retry);
      this.gestureArmed = false;
      if (!this.destroyed && this.active) this.attempt();
    };
    for (const event of events) {
      window.addEventListener(event, retry, { passive: true, once: true });
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.active = false;
  }
}

export class VideoPlayer {
  private readonly root: HTMLElement;
  private readonly video: HTMLVideoElement | null;
  private readonly replay: HTMLElement | null = null;
  private readonly queries: MediaQueryList[] = [];
  private readonly observer: IntersectionObserver | null = null;

  private playback: PlaybackManager | null = null;
  private selected = false;
  private visible = false;
  private restart = false;
  private destroyed = false;
  private sourceFrame = 0;
  private pendingFinalSource: string | null = null;
  private onCompletedMetadata: (() => void) | null = null;

  /** Read by the tabbed banner to know when to advance. */
  completed = false;

  private readonly onEnded: () => void;
  private readonly onReplay: () => void;
  private readonly onSourceChange: () => void;

  constructor(root: HTMLElement) {
    this.root = root;
    this.video = root.querySelector<HTMLVideoElement>('video');

    if (!this.video) {
      this.onEnded = () => {};
      this.onReplay = () => {};
      this.onSourceChange = () => {};
      return;
    }

    players.set(this.video, this);
    this.video.dataset.playbackOwned = 'true';
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.loop = false;
    this.video.pause();

    // Players outside a tab panel own themselves; ones inside wait to be selected.
    this.selected = !root.closest('.tabbed-banner__panel');

    this.replay = root.querySelector<HTMLElement>('.video-player__replay');

    this.onEnded = () => {
      this.completed = true;
      this.playback?.setActive(false);
      root.classList.add('is-ended');
    };
    this.video.addEventListener('ended', this.onEnded);

    this.onReplay = () => {
      this.cancelCompletedSeek();
      this.pendingFinalSource = null;
      this.completed = false;
      this.restart = true;
      this.sync();
      this.playback?.attempt(true);
    };
    this.replay?.addEventListener('click', this.onReplay);

    this.queries = [
      ...new Set(
        [...this.video.querySelectorAll<HTMLSourceElement>('source[media]')].map(
          (source) => source.media,
        ),
      ),
    ].map((media) => window.matchMedia(media));

    this.onSourceChange = () => {
      window.cancelAnimationFrame(this.sourceFrame);
      this.sourceFrame = window.requestAnimationFrame(() => this.sync());
    };
    for (const query of this.queries) query.addEventListener('change', this.onSourceChange);

    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(
        ([entry]) => {
          this.visible = entry.isIntersecting;
          this.sync();
        },
        { threshold: 0, rootMargin: '0px 0px -20% 0px' },
      );
      this.observer.observe(root);
    } else {
      this.visible = true;
      this.sync();
    }
  }

  setSelected(selected: boolean, { restart = false }: { restart?: boolean } = {}): void {
    this.selected = selected;
    if (restart) {
      this.cancelCompletedSeek();
      this.pendingFinalSource = null;
      this.restart = true;
      this.completed = false;
    }
    this.sync();
  }

  sync(): void {
    if (this.destroyed || !this.video) return;

    if (!this.selected || !this.visible) {
      this.cancelCompletedSeek();
      this.playback?.setActive(false);
      return;
    }

    // This is the class that reveals the player at all.
    this.root.classList.add('is-visible');
    if (this.completed) this.playback?.setActive(false);

    const sourceChanged = syncSource(this.video);
    if (sourceChanged || !this.playback) {
      this.cancelCompletedSeek();
      this.playback?.destroy();
      this.playback = new PlaybackManager(this.video, {
        onPlaying: () => this.root.classList.remove('is-ended'),
        onFailure: () => this.root.classList.add('is-ended'),
      });
    }

    if (this.completed) {
      if (sourceChanged) {
        this.pendingFinalSource = this.video.src;
        this.video.preload = 'auto';
        this.video.load();
      }
      if (this.pendingFinalSource) this.restoreCompletedFrame();
      return;
    }

    if (this.restart) {
      this.playback!.setActive(false);
      this.video.currentTime = 0;
      this.restart = false;
    }
    this.playback!.setActive(true);
  }

  private cancelCompletedSeek(): void {
    if (!this.onCompletedMetadata) return;
    for (const event of ['loadedmetadata', 'loadeddata', 'seeked']) {
      this.video?.removeEventListener(event, this.onCompletedMetadata);
    }
    this.onCompletedMetadata = null;
  }

  /** After a source swap on an already-finished video, park it on its final frame. */
  private restoreCompletedFrame(): void {
    this.cancelCompletedSeek();
    if (!this.video) return;
    const expected = this.pendingFinalSource;
    let seeked = false;

    const settle = () => {
      if (
        this.destroyed ||
        !this.completed ||
        !this.selected ||
        !this.visible ||
        !this.video ||
        this.pendingFinalSource !== expected ||
        this.video.currentSrc !== expected ||
        this.video.readyState < 1 ||
        !Number.isFinite(this.video.duration)
      ) {
        return;
      }
      this.video.pause();
      if (!seeked) {
        seeked = true;
        this.video.currentTime = this.video.duration;
      }
      if (
        this.video.readyState >= 2 &&
        !this.video.seeking &&
        Math.abs(this.video.currentTime - this.video.duration) < 1e-6
      ) {
        this.pendingFinalSource = null;
        this.cancelCompletedSeek();
      }
    };

    this.onCompletedMetadata = settle;
    for (const event of ['loadedmetadata', 'loadeddata', 'seeked']) {
      this.video.addEventListener(event, settle);
    }
    settle();
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelCompletedSeek();
    this.observer?.disconnect();
    window.cancelAnimationFrame(this.sourceFrame);
    for (const query of this.queries) {
      query.removeEventListener('change', this.onSourceChange);
    }
    this.video?.removeEventListener('ended', this.onEnded);
    this.replay?.removeEventListener('click', this.onReplay);
    this.playback?.destroy();
    if (this.video) players.delete(this.video);
  }
}

export class TabbedBanner {
  private readonly root: HTMLElement;
  private readonly tabs: HTMLElement[];
  private readonly panels: HTMLElement[];
  private readonly tabList: HTMLElement | null = null;
  private readonly banner: HTMLElement | null = null;
  private readonly observer: IntersectionObserver | null = null;

  private index = 0;
  private elapsed = 0;
  private lastFrame = 0;
  private lastVideoTime = 0;
  private rafId: number | null = null;
  private manual = false;
  private inView = false;
  private hoverTab = false;
  private hoverBanner = false;
  private activeVideo: HTMLVideoElement | null = null;
  private readonly cleanups: (() => void)[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    this.tabs = Array.from(root.querySelectorAll<HTMLElement>('.tabbed-banner__tab'));
    this.panels = Array.from(root.querySelectorAll<HTMLElement>('.tabbed-banner__panel'));
    if (!this.tabs.length) return;

    this.tabList = root.querySelector<HTMLElement>('.tabbed-banner__tabs ul');
    this.banner = root.querySelector<HTMLElement>('.tabbed-banner__banner');

    this.bind();
    // Collapses the all-`is-active` SSR markup down to a single visible panel.
    this.select(0, { resetProgress: true });
    requestAnimationFrame(() => this.root.classList.add('is-ready'));

    this.observer = new IntersectionObserver(
      ([entry]) => this.onVisibility(entry.isIntersecting),
      { threshold: 0.35 },
    );
    this.observer.observe(root);
  }

  private bind(): void {
    this.tabs.forEach((tab, index) => {
      const onClick = () => {
        if (index !== this.index) this.manual = true;
        this.select(index, { resetProgress: true });
        if (this.manual) this.stop();
      };
      const onEnter = () => {
        if (index === this.index) this.hoverTab = true;
      };
      const onLeave = () => {
        if (index === this.index) this.hoverTab = false;
      };
      const onKeydown = (event: KeyboardEvent) => this.onKeydown(event, index);

      tab.addEventListener('click', onClick);
      tab.addEventListener('pointerenter', onEnter);
      tab.addEventListener('pointerleave', onLeave);
      tab.addEventListener('keydown', onKeydown);
      this.cleanups.push(() => {
        tab.removeEventListener('click', onClick);
        tab.removeEventListener('pointerenter', onEnter);
        tab.removeEventListener('pointerleave', onLeave);
        tab.removeEventListener('keydown', onKeydown);
      });
    });

    if (this.banner) {
      const banner = this.banner;
      const onEnter = () => {
        this.hoverBanner = true;
      };
      const onLeave = () => {
        this.hoverBanner = false;
      };
      banner.addEventListener('pointerenter', onEnter);
      banner.addEventListener('pointerleave', onLeave);
      this.cleanups.push(() => {
        banner.removeEventListener('pointerenter', onEnter);
        banner.removeEventListener('pointerleave', onLeave);
      });
    }

    this.bindSwipe();
  }

  /** Touch/pen swipe across the banner moves between tabs. */
  private bindSwipe(): void {
    const banner = this.banner;
    if (!banner) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      tracking = true;
      startX = event.clientX;
      startY = event.clientY;
    };
    const onUp = (event: PointerEvent) => {
      if (!tracking) return;
      tracking = false;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
      const next =
        dx < 0
          ? (this.index + 1) % this.tabs.length
          : (this.index - 1 + this.tabs.length) % this.tabs.length;
      this.manual = true;
      this.select(next, { resetProgress: true });
      this.stop();
    };
    const onCancel = () => {
      tracking = false;
    };

    banner.addEventListener('pointerdown', onDown, { passive: true });
    banner.addEventListener('pointerup', onUp, { passive: true });
    banner.addEventListener('pointercancel', onCancel, { passive: true });
    this.cleanups.push(() => {
      banner.removeEventListener('pointerdown', onDown);
      banner.removeEventListener('pointerup', onUp);
      banner.removeEventListener('pointercancel', onCancel);
    });
  }

  private get paused(): boolean {
    return this.hoverTab || PAUSE_ON_HOVER;
  }

  private onKeydown(event: KeyboardEvent, index: number): void {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const next = (index + direction + this.tabs.length) % this.tabs.length;
    this.manual = true;
    this.select(next, { resetProgress: true });
    this.stop();
    this.tabs[next].focus();
  }

  private onVisibility(inView: boolean): void {
    this.inView = inView;
    if (!inView) {
      this.stop();
      this.manual = false;
      return;
    }
    if (!this.manual) this.start();
  }

  select(index: number, { resetProgress = false }: { resetProgress?: boolean } = {}): void {
    this.index = index;
    this.tabs.forEach((tab, i) => {
      const active = i === index;
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.setAttribute('tabindex', active ? '0' : '-1');
      if (!active) tab.style.setProperty('--tab-progress', '0');
      tab.classList.toggle('is-hovered', active && PAUSE_ON_HOVER);
    });

    this.activeVideo = null;
    this.panels.forEach((panel, i) => {
      const active = i === index;
      panel.classList.toggle('is-active', active);
      const video = panel.querySelector<HTMLVideoElement>('video');
      if (!video) return;
      if (active) this.activeVideo = video;
      players.get(video)?.setSelected(active, { restart: active });
    });

    if (resetProgress) {
      this.elapsed = 0;
      this.lastVideoTime = 0;
      this.setProgress(0);
    }
    this.scrollTabIntoView(index);
  }

  private scrollTabIntoView(index: number): void {
    if (!this.tabList || this.tabList.scrollWidth <= this.tabList.clientWidth) return;
    const tab = this.tabs[index];
    const item = tab.closest('li') || tab;
    this.tabList.scrollTo({
      left: (item as HTMLElement).offsetLeft - this.tabList.offsetLeft - 30,
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

  private syncFilling(): void {
    const filling =
      this.rafId !== null &&
      !this.paused &&
      (!this.activeVideo ||
        (!this.activeVideo.paused && this.activeVideo.readyState >= 2));
    this.root.classList.toggle('is-filling', filling);
  }

  /** A tab lasts as long as its video, or 6s when there is no video. */
  private currentTabDuration(): number {
    const duration = this.activeVideo?.duration;
    return duration && Number.isFinite(duration) && duration > 0
      ? duration * 1000
      : DEFAULT_TAB_MS;
  }

  private tick = (now: number): void => {
    const frameDelta = now - this.lastFrame;
    this.lastFrame = now;

    // A video that looped/seeked backwards restarts the progress bar.
    if (this.activeVideo && this.activeVideo.currentTime < this.lastVideoTime) {
      this.elapsed = 0;
    }

    if (!this.paused) {
      this.elapsed += this.activeVideo
        ? Math.max(
            0,
            (this.activeVideo.currentTime -
              (this.lastVideoTime ?? this.activeVideo.currentTime)) *
              1000,
          )
        : frameDelta;
      const duration = this.currentTabDuration();
      const finished =
        this.elapsed >= duration ||
        this.activeVideo?.ended ||
        (this.activeVideo ? players.get(this.activeVideo)?.completed : false);
      if (finished) {
        this.select((this.index + 1) % this.tabs.length, { resetProgress: true });
      } else {
        this.setProgress(this.elapsed / duration);
      }
    }

    this.lastVideoTime = this.activeVideo?.currentTime ?? 0;
    this.syncFilling();
    this.rafId = requestAnimationFrame(this.tick);
  };

  destroy(): void {
    this.stop();
    this.observer?.disconnect();
    for (const cleanup of this.cleanups) cleanup();
  }
}

export function initVideoPlayers(scope: ParentNode = document): () => void {
  const instances = [...scope.querySelectorAll<HTMLElement>('.video-player')].map(
    (root) => new VideoPlayer(root),
  );
  return () => {
    for (const instance of instances) instance.destroy();
  };
}

export function initTabbedBanners(scope: ParentNode = document): () => void {
  const instances = [...scope.querySelectorAll<HTMLElement>('.tabbed-banner')].map(
    (root) => new TabbedBanner(root),
  );
  return () => {
    for (const instance of instances) instance.destroy();
  };
}
