/**
 * Video behaviour ported from the original page's `prefooter.js` / `disclaimer.js`.
 *
 * The live site does NOT rely on plain `<video autoplay>`. Every decorative
 * video is driven by two cooperating pieces:
 *
 *  1. `VideoPlayback` — a retry/arbitration layer around `video.play()`. A muted
 *     autoplay promise can reject (NotAllowedError until a user gesture),
 *     silently stall (`waiting`/`stalled`), or be revoked when the tab is
 *     hidden. It re-attempts on a 250/1000/3000ms ladder, gives up after three
 *     attempts, and re-arms on the next real user gesture or `pageshow`.
 *  2. `VideoPlayer` — per-`.video-player` state machine: reveals the block with
 *     `is-visible`, plays only while selected AND intersecting, marks `is-ended`
 *     on completion, supports the `.video-player__replay` button, and re-picks
 *     the `<source>` when the media query breakpoint changes (each video ships a
 *     `(min-width: 768px)` and a `(max-width: 767px)` source).
 *
 * Why `is-visible` matters: the captured CSS ships `.video-player` transparent
 * until that class lands, so if this module no-ops the videos never appear.
 */

import type { Teardown } from './runtime';

/* ------------------------------------------------------------------ */
/* source selection                                                    */
/* ------------------------------------------------------------------ */

/**
 * The `<source>` the browser would pick right now: first one whose `media`
 * matches and whose `type` is playable. Mirrors the browser's own algorithm,
 * which we have to re-run by hand because changing `src` after load requires an
 * explicit decision about whether anything actually changed.
 */
export function pickSource(
  video: HTMLVideoElement,
  win: Window = window,
  base: string = document.baseURI,
): string | null {
  const match = Array.from(video.querySelectorAll('source')).find(
    (source) =>
      (!source.media || win.matchMedia(source.media).matches) &&
      (!source.type || Boolean(video.canPlayType(source.type))),
  );
  if (!match) return null;
  const src = match.getAttribute('src');
  if (!src) return null;
  return new URL(src, base).href;
}

/**
 * Points `video.src` at the currently-matching source. Returns true only when
 * the source actually changed, since the caller uses that to decide whether to
 * rebuild the playback layer (a new src resets the media element's state).
 */
export function syncSource(
  video: HTMLVideoElement,
  win: Window = window,
  base: string = document.baseURI,
): boolean {
  const wanted = pickSource(video, win, base);
  if (!wanted) return false;
  const current = video.getAttribute('src') || video.currentSrc;
  if (current && new URL(current, base).href === wanted) return false;
  video.src = wanted;
  return true;
}

/* ------------------------------------------------------------------ */
/* playback arbitration                                                */
/* ------------------------------------------------------------------ */

export interface VideoPlaybackOptions {
  window?: Window;
  document?: Document;
  onPlaying?: () => void;
  onFailure?: (error?: unknown) => void;
}

/** Backoff ladder for re-attempting a stalled/blocked play(), in ms. */
const RETRY_DELAYS = [250, 1000, 3000];
const MAX_ATTEMPTS = 3;
/** A timeupdate advance smaller than this is treated as noise, not progress. */
const PROGRESS_EPSILON = 0.05;

export class VideoPlayback {
  private readonly video: HTMLVideoElement;
  private readonly host: Window;
  private readonly page: Document;
  private readonly onPlaying: () => void;
  private readonly onFailure: (error?: unknown) => void;
  private readonly listeners: Array<() => void> = [];

  private active = false;
  private disposed = false;
  /** Identity token for the in-flight play() promise, so stale ones are ignored. */
  private request: object | null = null;
  private timer: number | null = null;
  /** Autoplay refused pending a user gesture (NotAllowedError). */
  private blocked = false;
  /** Unrecoverable: decode error or unsupported source. */
  private failed = false;
  private attempts = 0;
  private lastTime: number;

  constructor(video: HTMLVideoElement, options: VideoPlaybackOptions = {}) {
    this.video = video;
    this.host = options.window ?? window;
    this.page = options.document ?? document;
    this.onPlaying = options.onPlaying ?? (() => {});
    this.onFailure = options.onFailure ?? (() => {});
    this.lastTime = video.currentTime;

    // Any of these can mean "playback quietly isn't happening".
    for (const type of ['loadedmetadata', 'loadeddata', 'canplay', 'pause', 'waiting', 'stalled']) {
      this.listen(video, type, () => this.schedule());
    }

    // Real forward progress clears the attempt counter, so a long video that
    // hiccups once doesn't burn through its retry budget.
    this.listen(video, 'timeupdate', () => {
      if (video.currentTime > this.lastTime + PROGRESS_EPSILON && !video.seeking) {
        this.attempts = 0;
      }
      this.lastTime = video.currentTime;
    });

    this.listen(video, 'error', () => {
      this.failed = true;
      this.clearTimer();
      if (this.active) this.onFailure(video.error);
    });

    this.listen(this.page, 'visibilitychange', () => {
      if (this.page.hidden) {
        this.clearTimer();
        this.request = null;
        if (this.active) video.pause();
      } else {
        this.attempt(true);
      }
    });

    this.listen(this.host, 'pageshow', () => this.attempt(true));

    // A user gesture lifts an autoplay block, so treat one as a hard reset.
    for (const type of ['pointerdown', 'touchend', 'keydown']) {
      this.listen(this.host, type, () => this.attempt(true));
    }
  }

  private listen(target: EventTarget, type: string, handler: EventListener): void {
    target.addEventListener(type, handler, { passive: true });
    this.listeners.push(() => target.removeEventListener(type, handler));
  }

  /** Whether this video is allowed to be playing at all right now. */
  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    this.request = null;
    this.clearTimer();
    if (active) this.attempt(true);
    else this.video.pause();
  }

  private clearTimer(): void {
    if (this.timer !== null) this.host.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Queues the next retry, unless something makes retrying pointless. */
  private schedule(): void {
    if (
      !this.active ||
      this.disposed ||
      this.page.hidden ||
      this.blocked ||
      this.failed ||
      this.request ||
      this.timer !== null ||
      this.attempts >= MAX_ATTEMPTS
    ) {
      return;
    }
    this.timer = this.host.setTimeout(() => {
      this.timer = null;
      this.attempt();
    }, RETRY_DELAYS[this.attempts] ?? 3000) as unknown as number;
  }

  /**
   * Tries to start playback. `force` marks a fresh opportunity (user gesture,
   * tab re-shown, replay pressed) and clears the block/attempt state.
   */
  attempt(force = false): void {
    if (
      !this.active ||
      this.disposed ||
      this.page.hidden ||
      this.failed ||
      this.video.error ||
      this.video.ended
    ) {
      return;
    }
    if (force) {
      this.blocked = false;
      this.attempts = 0;
    }
    if (this.request || this.blocked || this.attempts >= MAX_ATTEMPTS) return;

    this.clearTimer();
    if (!this.video.paused) return; // already playing — nothing to do

    // Autoplay is only ever permitted muted + inline.
    this.video.muted = true;
    this.video.playsInline = true;

    const token = (this.request = {});
    this.attempts++;

    const onRejected = (error: unknown) => {
      if (this.disposed || !this.active || this.request !== token) return;
      this.request = null;
      const name = (error as DOMException | undefined)?.name;
      this.blocked = name === 'NotAllowedError';
      this.failed = name === 'NotSupportedError' || Boolean(this.video.error);
      this.onFailure(error);
      // An AbortError just means we raced a pause/load — worth another go.
      if (name === 'AbortError') this.schedule();
    };

    try {
      Promise.resolve(this.video.play()).then(() => {
        if (this.disposed || !this.active || this.request !== token) return;
        this.request = null;
        // play() can resolve while still paused (source swap mid-flight).
        if (this.video.paused) this.schedule();
        else this.onPlaying();
      }, onRejected);
    } catch (error) {
      onRejected(error);
    }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.request = null;
    this.clearTimer();
    for (const off of this.listeners.splice(0)) off();
    this.video.pause();
  }
}

/* ------------------------------------------------------------------ */
/* .video-player                                                       */
/* ------------------------------------------------------------------ */

/**
 * Lets the tabbed-banner drive the player that owns a given <video>, exactly as
 * the original module-scoped WeakMap did.
 */
const registry = new WeakMap<HTMLVideoElement, VideoPlayer>();

export function videoPlayerFor(
  video: HTMLVideoElement | null | undefined,
): VideoPlayer | undefined {
  return video ? registry.get(video) : undefined;
}

export class VideoPlayer {
  readonly root: HTMLElement;
  readonly video: HTMLVideoElement | null;

  private playback?: VideoPlayback;
  private readonly replay: HTMLElement | null = null;
  private readonly queries: MediaQueryList[] = [];
  private observer?: IntersectionObserver;

  /** Selected by its tab panel (always true outside a tabbed banner). */
  private selected = false;
  private visible = false;
  /** Played through to the end; holds the final frame instead of looping. */
  completed = false;
  private restart = false;
  private destroyed = false;
  private sourceFrame = 0;
  /** Set while we re-load a finished video purely to re-show its last frame. */
  private pendingFinalSource: string | null = null;
  private onCompletedMetadata: (() => void) | null = null;

  private readonly onEnded: () => void;
  private readonly onReplay: () => void;
  private readonly onSourceChange: () => void;

  constructor(root: HTMLElement) {
    this.root = root;
    this.video = root.querySelector('video');

    if (!this.video) {
      // Keep the field initialisers happy for a markup-only block.
      this.onEnded = () => {};
      this.onReplay = () => {};
      this.onSourceChange = () => {};
      return;
    }

    const video = this.video;
    registry.set(video, this);
    // Marks this video as driven by us, so the generic play-when-visible
    // effect leaves it alone.
    video.dataset.playbackOwned = 'true';
    video.muted = true;
    video.playsInline = true;
    video.loop = false;
    video.pause();

    // Players inside a tab panel start unselected; the banner selects one.
    this.selected = !root.closest('.tabbed-banner__panel');
    this.replay = root.querySelector('.video-player__replay');

    this.onEnded = () => {
      this.completed = true;
      this.playback?.setActive(false);
      root.classList.add('is-ended');
    };
    video.addEventListener('ended', this.onEnded);

    this.onReplay = () => {
      this.cancelCompletedSeek();
      this.pendingFinalSource = null;
      this.completed = false;
      this.restart = true;
      this.sync();
      this.playback?.attempt(true);
    };
    this.replay?.addEventListener('click', this.onReplay);

    // One MediaQueryList per distinct `media` on the sources: crossing the
    // breakpoint has to swap the file, not just re-lay-out.
    this.queries = [
      ...new Set(
        Array.from(video.querySelectorAll<HTMLSourceElement>('source[media]')).map(
          (source) => source.media,
        ),
      ),
    ].map((media) => window.matchMedia(media));

    this.onSourceChange = () => {
      window.cancelAnimationFrame(this.sourceFrame);
      this.sourceFrame = window.requestAnimationFrame(() => this.sync());
    };
    for (const query of this.queries) {
      if (query.addEventListener) query.addEventListener('change', this.onSourceChange);
      else query.addListener(this.onSourceChange);
    }

    if ('IntersectionObserver' in window) {
      // -20% bottom margin: the video starts once it is meaningfully on
      // screen, not the instant its first pixel appears.
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

  /** Called by the tabbed banner when this player's panel gains/loses focus. */
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

  /** Single reconciliation point: derives playback state from selected/visible. */
  sync(): void {
    if (this.destroyed || !this.video) return;

    if (!this.selected || !this.visible) {
      this.cancelCompletedSeek();
      this.playback?.setActive(false);
      return;
    }

    // This is what actually makes the block visible (CSS gates on it).
    this.root.classList.add('is-visible');
    if (this.completed) this.playback?.setActive(false);

    const sourceChanged = syncSource(this.video);
    if (sourceChanged || !this.playback) {
      this.cancelCompletedSeek();
      this.playback?.destroy();
      this.playback = new VideoPlayback(this.video, {
        onPlaying: () => this.root.classList.remove('is-ended'),
        onFailure: () => this.root.classList.add('is-ended'),
      });
    }

    if (this.completed) {
      // Breakpoint change on an already-finished video: load the new file just
      // to park it on its final frame, never to replay it.
      if (sourceChanged) {
        this.pendingFinalSource = this.video.src;
        this.video.preload = 'auto';
        this.video.load();
      }
      if (this.pendingFinalSource) this.restoreCompletedFrame();
      return;
    }

    if (this.restart) {
      this.playback.setActive(false);
      this.video.currentTime = 0;
      this.restart = false;
    }
    this.playback.setActive(true);
  }

  private cancelCompletedSeek(): void {
    if (this.onCompletedMetadata) {
      for (const type of ['loadedmetadata', 'loadeddata', 'seeked']) {
        this.video?.removeEventListener(type, this.onCompletedMetadata);
      }
    }
    this.onCompletedMetadata = null;
  }

  /**
   * Seeks a freshly-loaded source to its very last frame. Needs retrying across
   * several media events because `duration` is NaN until metadata lands and the
   * seek itself can be coalesced away mid-load.
   */
  private restoreCompletedFrame(): void {
    this.cancelCompletedSeek();
    const target = this.pendingFinalSource;
    let seeked = false;

    const settle = () => {
      const video = this.video;
      if (
        this.destroyed ||
        !video ||
        !this.completed ||
        !this.selected ||
        !this.visible ||
        this.pendingFinalSource !== target ||
        video.currentSrc !== target ||
        video.readyState < 1 ||
        !Number.isFinite(video.duration)
      ) {
        return;
      }
      video.pause();
      if (!seeked) {
        seeked = true;
        video.currentTime = video.duration;
      }
      if (
        video.readyState >= 2 &&
        !video.seeking &&
        Math.abs(video.currentTime - video.duration) < 1e-6
      ) {
        this.pendingFinalSource = null;
        this.cancelCompletedSeek();
      }
    };

    this.onCompletedMetadata = settle;
    for (const type of ['loadedmetadata', 'loadeddata', 'seeked']) {
      this.video?.addEventListener(type, settle);
    }
    settle();
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelCompletedSeek();
    this.observer?.disconnect();
    window.cancelAnimationFrame(this.sourceFrame);
    for (const query of this.queries) {
      if (query.removeEventListener) query.removeEventListener('change', this.onSourceChange);
      else query.removeListener(this.onSourceChange);
    }
    this.video?.removeEventListener('ended', this.onEnded);
    this.replay?.removeEventListener('click', this.onReplay);
    this.playback?.destroy();
    if (this.video) registry.delete(this.video);
  }
}

/** Instantiates a `VideoPlayer` for every `.video-player` block. */
export function initIntuitVideoPlayers(root: ParentNode = document): Teardown | void {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.video-player'));
  if (!blocks.length) return;

  const players = blocks
    // Idempotency guard for React strict mode's double mount.
    .filter((block) => !block.dataset.intuitVideoPlayer)
    .map((block) => {
      block.dataset.intuitVideoPlayer = 'true';
      return new VideoPlayer(block);
    });

  return () => {
    for (const player of players) {
      player.destroy();
      delete player.root.dataset.intuitVideoPlayer;
    }
  };
}

/* ------------------------------------------------------------------ */
/* generic play-while-visible                                          */
/* ------------------------------------------------------------------ */

/** Videos owned by another controller, which must not be touched here. */
const OWNED_VIDEOS =
  '.hero__propeller-video, [data-play-when-visible], [data-playback-owned]';

/**
 * Pauses off-screen videos and resumes them on return — but only the ones we
 * actually paused, so a video the visitor deliberately paused stays paused.
 *
 * MUST run after `initIntuitVideoPlayers`, which is what stamps
 * `data-playback-owned` on the videos this effect has to skip.
 */
export function initIntuitPlayWhenVisible(root: ParentNode = document): Teardown | void {
  const videos = Array.from(root.querySelectorAll<HTMLVideoElement>('video')).filter(
    (video) => !video.matches(OWNED_VIDEOS),
  );
  if (!videos.length || !('IntersectionObserver' in window)) return;

  const wasPlaying = new WeakMap<HTMLVideoElement, boolean>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) {
          if (wasPlaying.get(video)) {
            wasPlaying.delete(video);
            video.play().catch(() => {});
          }
        } else {
          const playing = !video.paused && !video.ended;
          wasPlaying.set(video, playing);
          if (playing) video.pause();
        }
      }
    },
    { threshold: 0, rootMargin: '0px 0px -10% 0px' },
  );

  for (const video of videos) observer.observe(video);
  return () => observer.disconnect();
}
