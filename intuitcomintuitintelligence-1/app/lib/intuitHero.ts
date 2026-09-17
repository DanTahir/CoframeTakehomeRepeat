/**
 * Hero word entry + propeller-clip choreography.
 *
 * Ported 1:1 from the live page's own bundle: scrape/raw/js/intelligence.a7cda79c.js
 * (minified class `B` plus the module-level orchestration block at the end of that file).
 *
 * Why this module is mandatory rather than decorative: the page's base CSS ships
 * `.hero__word-inner{opacity:0;transform:translate(48px)}` unconditionally, so without this
 * controller writing inline styles the entire hero headline stays invisible.
 *
 * Sequence:
 *   1. words fade/slide in on a tightening stagger (700ms, then 300ms -> 200ms steps),
 *   2. the propeller clip plays and pauses itself at 1.8s ("hold"),
 *   3. the first wheel/touch/key gesture resumes it; scrolling past the threshold instead
 *      snaps everything to its final state,
 *   4. once the clip finishes the hero dims, #intro is scrolled into view, and the clip
 *      "flies" to the intro statement then freezes into its poster still.
 */

import { LetterTrail } from './intuitLetterTrail';

const ENTRY_FIRST_DELAY = 700; // `ie`
const ENTRY_STEP_START = 300; // `I`
const ENTRY_STEP_END = 200; // `re`
const WORD_TRANSFORM_MS = 300; // `b`
const WORD_OFFSET_PX = 48; // `F`
const WORD_OPACITY_MS = 260; // `N`
const WORD_EASE = 'cubic-bezier(0.25,0.46,0.45,0.94)'; // `oe`
const HOLD_AT_SECONDS = 1.8; // `A`
const MARGIN_DELAY_MS = 800; // `ne`
const MARGIN_MS = 500; // `O`
const MARGIN_EASE = 'ease-out'; // `D`
const MARGIN_INLINE = '-0.25em'; // `ae`
const VIDEO_LIFT = 'translateY(6%)'; // `le`
const FLY_MS = 600; // `M`
const FLY_EASE = 'cubic-bezier(0.4,0,0.2,1)'; // `ce`
const FADE_MS = 300; // `q`
const FLY_ANCHOR_X = 0.25; // `he`
const FLY_ANCHOR_Y = 0.25; // `de`

/** `Ce` — the intro headline's letter trail waits this long before starting. */
const INTRO_TRAIL_DELAY = 500;
/** Scroll threshold for "user has moved on": max(18% of viewport, 120px). */
const SCROLL_THRESHOLD_RATIO = 0.18;
const SCROLL_THRESHOLD_MIN = 120;
/** Fallback if the hero's background-color transition never reports. */
const DIM_FALLBACK_MS = 900;

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export type HeroOptions = {
  onComplete?: () => void;
  onHold?: () => void;
};

export class Hero {
  private readonly root: HTMLElement;
  private readonly onComplete?: () => void;
  private readonly onHold?: () => void;

  private readonly words: HTMLElement[];
  private readonly inners: (HTMLElement | null)[] = [];
  private video: HTMLVideoElement | null = null;
  private entryTimers: number[] = [];

  private readonly reduced: boolean;
  private entryPlayed = false;
  private completed = false;
  private playThrough = false;
  private propellerStarted = false;
  private holding = false;
  private resumed = false;
  private settled = false;
  private detached = false;
  private flown = false;
  private flightActive = false;
  private frozen = false;
  private finishedInstantly = false;
  private gestureRetryArmed = false;

  private placeholder: HTMLElement | null = null;
  private flightHome: DOMRect | null = null;
  private onEnded: (() => void) | null = null;
  private onPauseTime: (() => void) | null = null;

  constructor(root: HTMLElement, options: HeroOptions = {}) {
    this.root = root;
    this.onComplete = options.onComplete;
    this.onHold = options.onHold;
    this.words = Array.from(root.querySelectorAll<HTMLElement>('.hero__word'));
    this.reduced = prefersReducedMotion();

    if (!this.words.length) return;

    this.inners = this.words.map((word) =>
      word.querySelector<HTMLElement>('.hero__word-inner'),
    );
    this.video = root.querySelector<HTMLVideoElement>('.hero__propeller-video');

    if (this.video) {
      this.video.pause();
      this.video.currentTime = 0;
    }

    root.classList.add('is-animating');

    if (this.reduced) {
      root.classList.remove('is-animating');
      this.enterHold();
      return;
    }

    const start = () => this.playEntry();
    if (document.fonts?.status === 'loaded') start();
    else if (document.fonts) document.fonts.ready.then(start, start);
    else start();
  }

  private playEntry(): void {
    if (this.entryPlayed) return;
    this.entryPlayed = true;

    // Build the per-word delay table: the gap between words tightens from 300ms to 200ms.
    const delays: number[] = [];
    let cursor = ENTRY_FIRST_DELAY;
    const span = Math.max(this.words.length - 1, 1);
    this.words.forEach((_word, index) => {
      delays.push(cursor);
      const progress = Math.min(index, span - 1) / span;
      cursor += ENTRY_STEP_START + (ENTRY_STEP_END - ENTRY_STEP_START) * progress;
    });

    const offsetFor = (inner: HTMLElement) =>
      inner.classList.contains('hero__propeller')
        ? `translate(${WORD_OFFSET_PX}px, -0.04em)`
        : `translateX(${WORD_OFFSET_PX}px)`;

    for (const inner of this.inners) {
      if (!inner) continue;
      inner.style.opacity = '0';
      inner.style.transform = offsetFor(inner);
    }

    this.root.classList.remove('is-animating');

    this.inners.forEach((inner, index) => {
      if (!inner) return;
      this.entryTimers.push(
        window.setTimeout(() => {
          inner.style.transition = `opacity ${WORD_OPACITY_MS}ms ease`;
          inner.style.opacity = '1';
        }, delays[index]),
      );
      const slideAt =
        index < this.words.length - 1
          ? delays[index + 1]
          : delays[index] + WORD_TRANSFORM_MS * 0.3;
      this.entryTimers.push(
        window.setTimeout(() => {
          // Force a style read so the transition actually applies from the offset position.
          void getComputedStyle(inner).transform;
          inner.style.transition = `opacity ${WORD_OPACITY_MS}ms ease, transform ${WORD_TRANSFORM_MS}ms ${WORD_EASE}`;
          inner.style.transform = inner.classList.contains('hero__propeller')
            ? 'translateY(-0.04em)'
            : 'translate(0px, 0px)';
        }, slideAt),
      );
    });

    const propellerAt = delays[this.words.length - 1] + WORD_TRANSFORM_MS;
    this.entryTimers.push(window.setTimeout(() => this.startPropeller(), propellerAt));
  }

  private startPropeller(): void {
    this.propellerStarted = true;
    if (!this.video) {
      this.enterHold();
      return;
    }
    if (this.playThrough) {
      this.freeze();
      return;
    }

    this.video.muted = true;
    this.video.setAttribute('muted', '');

    if (this.resumed) {
      this.onEnded = () => this.settleClip();
      this.video.addEventListener('ended', this.onEnded);
      const duration = Number.isFinite(this.video.duration) ? this.video.duration : 3;
      this.entryTimers.push(
        window.setTimeout(() => this.settleClip(), duration * 1000 + 600),
      );
      this.video.currentTime = 0;
      const played = this.video.play();
      if (played) played.catch(() => this.settleClip());
      this.animatePropellerMargin();
      return;
    }

    // Not yet resumed: run the clip up to 1.8s, then pause and wait for the user.
    this.onPauseTime = () => {
      if (!this.video || this.video.currentTime < HOLD_AT_SECONDS) return;
      if (this.onPauseTime) this.video.removeEventListener('timeupdate', this.onPauseTime);
      this.onPauseTime = null;
      this.video.pause();
      this.video.currentTime = HOLD_AT_SECONDS;
      this.enterHold();
    };
    this.video.addEventListener('timeupdate', this.onPauseTime);
    this.video.currentTime = 0;
    this.video.muted = true;
    this.video.setAttribute('muted', '');
    this.attemptPlay();
  }

  private enterHold(): void {
    if (this.holding || this.resumed) return;
    this.holding = true;
    this.onHold?.();
  }

  resume(): void {
    if (this.resumed) return;
    this.resumed = true;
    this.holding = false;
    if (this.playThrough) return;

    if (!this.video) {
      this.settleClip();
      return;
    }
    if (!this.propellerStarted) return;

    if (this.onPauseTime) {
      this.video.removeEventListener('timeupdate', this.onPauseTime);
      this.onPauseTime = null;
    }
    this.onEnded = () => this.settleClip();
    this.video.addEventListener('ended', this.onEnded);
    const remaining = Number.isFinite(this.video.duration)
      ? Math.max(this.video.duration - this.video.currentTime, 0)
      : 1;
    this.entryTimers.push(
      window.setTimeout(() => this.settleClip(), remaining * 1000 + 600),
    );
    const played = this.video.play();
    if (played) played.catch(() => this.settleClip());
  }

  /** Autoplay may be refused; if so, arm one-shot gesture listeners and retry. */
  private attemptPlay(): void {
    if (!this.video) return;
    const onOk = () => {
      this.animatePropellerMargin();
      this.entryTimers.push(
        window.setTimeout(() => this.enterHold(), HOLD_AT_SECONDS * 1000 + 600),
      );
    };
    const onFail = () => {
      if (this.gestureRetryArmed) return;
      this.gestureRetryArmed = true;
      const events = ['pointerdown', 'touchstart', 'keydown'];
      const retry = () => {
        for (const event of events) window.removeEventListener(event, retry);
        if (!this.video || this.resumed) return;
        this.video.play().then(onOk, () => this.enterHold());
      };
      for (const event of events) {
        window.addEventListener(event, retry, { passive: true, once: true });
      }
    };
    this.video.play().then(onOk, onFail);
  }

  private settleClip(): void {
    if (this.settled) return;
    this.settled = true;
    if (this.video && this.onEnded) {
      this.video.removeEventListener('ended', this.onEnded);
      this.onEnded = null;
    }
    this.detachClip();
    this.complete();
  }

  /** Slides the propeller word tighter and lifts the clip slightly, 800ms in. */
  private animatePropellerMargin(): void {
    const propeller = this.root.querySelector<HTMLElement>('.hero__propeller');
    if (!propeller) return;
    const video = this.video;
    this.entryTimers.push(
      window.setTimeout(() => {
        propeller.style.transition = `margin-inline ${MARGIN_MS}ms ${MARGIN_EASE}`;
        propeller.style.marginInline = MARGIN_INLINE;
        if (video) {
          video.style.transition = `transform ${MARGIN_MS}ms ${MARGIN_EASE}`;
          video.style.transform = VIDEO_LIFT;
        }
      }, MARGIN_DELAY_MS),
    );
  }

  /** Lifts the clip out of the text flow into a fixed-position element it can fly from. */
  private detachClip(): void {
    if (!this.video || this.detached) return;
    this.detached = true;
    const rect = this.video.getBoundingClientRect();
    const propeller = this.video.closest<HTMLElement>('.hero__propeller');

    if (propeller) {
      const placeholder = document.createElement('span');
      placeholder.className = 'hero__propeller-placeholder';
      placeholder.style.width = `${rect.width}px`;
      placeholder.style.height = `${rect.height}px`;
      propeller.appendChild(placeholder);
      this.placeholder = placeholder;
    }

    const video = this.video;
    video.style.transition = 'none';
    video.style.position = 'fixed';
    video.style.margin = '0';
    video.style.left = `${rect.left}px`;
    video.style.top = `${rect.top}px`;
    video.style.width = `${rect.width}px`;
    video.style.height = `${rect.height}px`;
    video.style.transformOrigin = 'top left';
    video.style.transform = 'translate(0, 0) scale(1)';
    video.style.zIndex = '5';
    video.style.pointerEvents = 'none';
    document.body.appendChild(video);
    this.flightHome = rect;
  }

  /** Flies the detached clip toward `target` (the intro statement), then fades it out. */
  flyClipTo(target: Element | null, targetRect?: DOMRect): void {
    if (!this.video || this.flown) return;
    if (!this.detached) this.settleClip();
    if (!this.video || !this.detached) return;

    this.flown = true;
    this.flightActive = true;
    const video = this.video;

    if ((!target && !targetRect) || this.reduced) {
      this.fadeOutClip();
      return;
    }

    const home = this.flightHome || video.getBoundingClientRect();
    const destination = targetRect || (target as Element).getBoundingClientRect();
    const dx =
      destination.left - (home.left + home.width / 2) + home.width * FLY_ANCHOR_X;
    const dy = destination.top - (home.top + home.height / 2) + home.height * FLY_ANCHOR_Y;

    void getComputedStyle(video).transform;
    video.style.transition = `transform ${FLY_MS}ms ${FLY_EASE}`;
    video.style.transform = `translate(${dx}px, ${dy}px)`;
    this.entryTimers.push(window.setTimeout(() => this.fadeOutClip(), FLY_MS));
  }

  private fadeOutClip(): void {
    const video = this.video;
    if (!video) return;
    video.style.transition = `${
      video.style.transition ? `${video.style.transition}, ` : ''
    }opacity ${FADE_MS}ms ease`;
    void getComputedStyle(video).opacity;
    video.style.opacity = '0';
    this.entryTimers.push(
      window.setTimeout(() => {
        this.flightActive = false;
        this.freeze();
      }, FADE_MS),
    );
  }

  /** Snaps everything to its end state without animating (user scrolled away). */
  finishInstantly(): void {
    if (this.finishedInstantly) return;
    this.finishedInstantly = true;
    for (const timer of this.entryTimers) window.clearTimeout(timer);
    this.entryTimers = [];
    this.root.classList.remove('is-animating');

    for (const inner of this.inners) {
      if (!inner) continue;
      inner.style.transition = 'none';
      inner.style.opacity = '1';
      inner.style.transform = inner.classList.contains('hero__propeller')
        ? 'translateY(-0.04em)'
        : 'translate(0px, 0px)';
    }

    const propeller = this.root.querySelector<HTMLElement>('.hero__propeller');
    if (propeller) {
      propeller.style.transition = 'none';
      propeller.style.marginInline = '';
    }
    this.letVideoFinish();
  }

  private letVideoFinish(): void {
    if (this.playThrough) return;
    this.playThrough = true;
    this.completed = true;
    if (!this.video) return;
    this.video.pause();
    if (this.onEnded) {
      this.video.removeEventListener('ended', this.onEnded);
      this.onEnded = null;
    }
    if (this.onPauseTime) {
      this.video.removeEventListener('timeupdate', this.onPauseTime);
      this.onPauseTime = null;
    }
    this.flightActive = false;
    this.freeze();
  }

  private complete(): void {
    if (this.completed) return;
    this.completed = true;
    this.onComplete?.();
  }

  /** Replaces the video element with its poster frame so nothing keeps decoding. */
  freeze(): void {
    if (!this.video || this.frozen || this.flightActive) return;
    this.frozen = true;
    document.body.style.background = '#fff';

    const poster = this.video.getAttribute('poster');
    if (!poster) return;

    const still = document.createElement('img');
    still.className = 'hero__propeller-still';
    still.src = poster;
    still.alt = '';
    still.setAttribute('aria-hidden', 'true');

    const host =
      this.placeholder?.closest<HTMLElement>('.hero__propeller') ||
      this.video.closest<HTMLElement>('.hero__propeller');
    if (host) host.style.marginInline = '';

    if (this.detached) {
      if (this.placeholder) {
        this.placeholder.replaceWith(still);
        this.placeholder = null;
      } else if (host) {
        host.appendChild(still);
      }
      this.video.remove();
    } else {
      this.video.replaceWith(still);
    }

    this.onEnded = null;
    this.video = null;
  }

  destroy(): void {
    for (const timer of this.entryTimers) window.clearTimeout(timer);
    this.entryTimers = [];
    if (this.video && this.onEnded) this.video.removeEventListener('ended', this.onEnded);
    if (this.video && this.onPauseTime) {
      this.video.removeEventListener('timeupdate', this.onPauseTime);
    }
    if (this.detached && this.video) this.video.remove();
    this.placeholder?.remove();
  }
}

/**
 * Wires the hero to #intro exactly as the original module-level block does, and returns the
 * `.reveal-headline` element it has taken ownership of (so the generic letter-trail
 * initialiser can skip it) plus a teardown function.
 */
export function initHero(): { owned: Element[]; destroy: () => void } {
  const hero = document.querySelector<HTMLElement>('.hero');
  const intro = document.querySelector<HTMLElement>('#intro');
  const headline = document.querySelector<HTMLElement>('#intro .reveal-headline');
  // Note: on this page `.intro__statement` and the intro `.reveal-headline` are the same node.
  const statement = document.querySelector<HTMLElement>('#intro .intro__statement');

  const cleanups: (() => void)[] = [];
  const owned: Element[] = [];
  let controller: Hero | null = null;

  if (hero && intro && headline) {
    const undim = () => hero.classList.remove('is-dimmed');
    let resumedOnce = false;
    let dimming = false;
    let bailedOut = false;

    const gestureEvents = ['wheel', 'touchmove', 'keydown'];
    const removeGestures = () => {
      for (const event of gestureEvents) {
        window.removeEventListener(event, onGesture as EventListener);
      }
    };

    const threshold = () =>
      Math.max(window.innerHeight * SCROLL_THRESHOLD_RATIO, SCROLL_THRESHOLD_MIN);
    const onScroll = () => {
      if (dimming || bailedOut) return;
      if (window.scrollY > threshold()) bailOut();
    };
    const removeScroll = () => window.removeEventListener('scroll', onScroll);

    const resume = () => {
      if (resumedOnce || bailedOut) return;
      resumedOnce = true;
      controller?.resume();
    };

    const bailOut = () => {
      if (bailedOut || dimming) return;
      bailedOut = true;
      removeGestures();
      removeScroll();
      undim();
      controller?.finishInstantly();
    };

    const NAV_KEYS = new Set([
      'ArrowUp',
      'ArrowDown',
      'PageUp',
      'PageDown',
      'Home',
      'End',
      ' ',
    ]);

    function onGesture(event: WheelEvent | TouchEvent | KeyboardEvent): void {
      if (document.documentElement.classList.contains('nav-open')) return;
      if (event.defaultPrevented) return;
      const modified = event as unknown as {
        ctrlKey?: boolean;
        metaKey?: boolean;
        altKey?: boolean;
      };
      if (modified.ctrlKey || modified.metaKey || modified.altKey) return;
      if (event.type === 'keydown') {
        const key = (event as KeyboardEvent).key;
        const target = event.target;
        if (
          !NAV_KEYS.has(key) ||
          (target instanceof Element &&
            target.closest(
              "input, textarea, select, button, a, [contenteditable]:not([contenteditable='false']), [role='textbox']",
            ))
        ) {
          return;
        }
      }
      if (event.type === 'wheel' && (event as WheelEvent).deltaY === 0) return;
      if (event.type === 'touchmove' && (event as TouchEvent).touches.length !== 1) return;
      if (event.cancelable) event.preventDefault();
      resume();
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    for (const event of gestureEvents) {
      window.addEventListener(event, onGesture as EventListener, { passive: false });
    }

    /** Dim the hero, jump to #intro, then fly the clip to the intro statement. */
    const dimAndAdvance = () => {
      if (dimming || bailedOut) return;
      dimming = true;
      removeScroll();
      let advanced = false;

      const advance = () => {
        if (advanced) return;
        advanced = true;
        removeGestures();
        hero.removeEventListener('transitionend', onTransitionEnd);
        intro.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });
        undim();
        const fly = () => {
          if (!statement) {
            controller?.flyClipTo(statement);
            return;
          }
          controller?.flyClipTo(statement, statement.getBoundingClientRect());
        };
        requestAnimationFrame(() => requestAnimationFrame(fly));
      };

      const onTransitionEnd = (event: TransitionEvent) => {
        if (event.target === hero && event.propertyName === 'background-color') advance();
      };

      hero.addEventListener('transitionend', onTransitionEnd);
      window.setTimeout(advance, DIM_FALLBACK_MS);
      hero.classList.add('is-dimmed');
    };

    controller = new Hero(hero, {
      onComplete: () => {
        if (!bailedOut) dimAndAdvance();
      },
    });

    const trail = new LetterTrail(headline, {
      onStart: () => controller?.freeze(),
      startDelay: INTRO_TRAIL_DELAY,
    });
    owned.push(headline);

    const chevronAction = () => {
      if (bailedOut || dimming) {
        intro.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'start',
        });
      } else if (resumedOnce) {
        dimAndAdvance();
      } else {
        resume();
      }
    };

    const chevron = hero.querySelector<HTMLElement>('.hero__chevron');
    if (chevron) {
      const onChevron = (event: Event) => {
        event.preventDefault();
        chevronAction();
      };
      chevron.addEventListener('click', onChevron);
      cleanups.push(() => chevron.removeEventListener('click', onChevron));
    }

    cleanups.push(() => {
      removeGestures();
      removeScroll();
      trail.destroy();
      controller?.destroy();
    });
  } else if (hero) {
    // No #intro to advance to: still run the entry animation so the words become visible.
    const standalone = new Hero(hero);
    cleanups.push(() => standalone.destroy());
  }

  return {
    owned,
    destroy: () => {
      for (const cleanup of cleanups) cleanup();
    },
  };
}
