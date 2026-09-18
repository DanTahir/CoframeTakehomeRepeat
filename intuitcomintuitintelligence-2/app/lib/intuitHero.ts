/**
 * The hero sequence, ported from the original page's `intelligence.js`.
 *
 * This is the most intricate behaviour on the page, and it is a scroll-gated
 * cinematic rather than a simple entrance animation:
 *
 *  1. Once webfonts are ready, the hero words fade + slide in on a ramped
 *     stagger (first word at 700ms, gaps easing from 300ms down to 200ms).
 *  2. The propeller video plays to 1.8s and freezes there, holding the frame.
 *  3. The page is scroll-locked: wheel/touch/keydown are intercepted and the
 *     FIRST such gesture resumes the propeller clip instead of scrolling.
 *  4. When the clip finishes, the hero dims (`is-dimmed`), the page jumps to
 *     `#intro`, and the clip detaches to fixed positioning and flies to the
 *     intro statement before fading out and being replaced by its poster.
 *  5. Any gesture past a scroll threshold short-circuits the whole thing
 *     (`finishInstantly`), so an impatient visitor is never trapped.
 *
 * The scroll lock is genuinely load-bearing, and so is every one of its
 * escape hatches: `prefers-reduced-motion`, a video that never loads, an
 * autoplay block, and the 900ms fallback timer all release it.
 */

import { LetterTrail } from './intuitLetterTrail';
import type { Teardown } from './runtime';

/* --- word entrance ------------------------------------------------- */
/** Delay before the first word appears. */
const ENTRY_START_MS = 700;
/** Gap between words at the start of the stagger… */
const STAGGER_MAX_MS = 300;
/** …and at the end: the ramp accelerates as the line fills in. */
const STAGGER_MIN_MS = 200;
/** Duration of each word's slide into place. */
const MOVE_MS = 300;
/** How far right each word starts. */
const X_OFFSET_PX = 48;
/** Duration of each word's fade. */
const FADE_MS = 260;
const MOVE_EASE = 'cubic-bezier(0.25,0.46,0.45,0.94)';

/* --- propeller clip ------------------------------------------------ */
/** Timestamp the clip pauses at while waiting for the visitor. */
const HOLD_AT_SECONDS = 1.8;
/** Delay before the propeller's margin/offset settles. */
const MARGIN_DELAY_MS = 800;
const MARGIN_MS = 500;
const MARGIN_EASE = 'ease-out';
/** Negative inline margin pulls the clip tight against its neighbours. */
const MARGIN_INLINE = '-0.25em';
const VIDEO_SHIFT = 'translateY(6%)';
/** Grace period after a clip's nominal end before force-settling it. */
const SETTLE_GRACE_MS = 600;

/* --- flight to the intro statement -------------------------------- */
const FLY_MS = 600;
const FLY_EASE = 'cubic-bezier(0.4,0,0.2,1)';
const FADE_OUT_MS = 300;
/** Landing point inside the target, as a fraction of the clip's own size. */
const FLY_X_RATIO = 0.25;
const FLY_Y_RATIO = 0.25;

/* --- orchestration ------------------------------------------------- */
/** Scroll past max(18vh, 120px) and the cinematic is abandoned. */
const DIM_THRESHOLD_RATIO = 0.18;
const DIM_THRESHOLD_MIN_PX = 120;
/** Fallback in case the hero's background-color transition never fires. */
const DIM_FALLBACK_MS = 900;
/** Head start before the intro headline's letter trail begins. */
const TRAIL_START_DELAY_MS = 500;

/** Keys that count as a scroll intent. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
/** Interactive elements whose own key handling must win over the scroll lock. */
const INTERACTIVE =
  "input, textarea, select, button, a, [contenteditable]:not([contenteditable='false']), [role='textbox']";

/**
 * True while the site's global navigation has locked the page (its drawer sets
 * `overflow: hidden` / `icom-nav-locked` on <body>). Ported from `navOpen.js`;
 * without this check the hero would swallow gestures meant for the open menu.
 */
export function isNavOpen(): boolean {
  return (
    document.body.classList.contains('icom-nav-locked') ||
    document.body.style.overflow.trim() === 'hidden'
  );
}

interface HeroOptions {
  onComplete?: () => void;
  onHold?: () => void;
}

export class HeroPropeller {
  private readonly root: HTMLElement;
  private readonly onComplete?: () => void;
  private readonly onHold?: () => void;

  private readonly words: HTMLElement[];
  private readonly inners: Array<HTMLElement | null> = [];
  private video: HTMLVideoElement | null = null;
  private readonly entryTimers: number[] = [];
  private readonly reduced: boolean;

  private entryPlayed = false;
  private completed = false;
  /** Set once the visitor has bailed out: the clip just plays to its end. */
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

  constructor(root: HTMLElement, { onComplete, onHold }: HeroOptions = {}) {
    this.root = root;
    this.onComplete = onComplete;
    this.onHold = onHold;
    this.words = Array.from(root.querySelectorAll<HTMLElement>('.hero__word'));
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!this.words.length) return;

    this.inners = this.words.map((word) => word.querySelector<HTMLElement>('.hero__word-inner'));
    this.video = root.querySelector('.hero__propeller-video');

    if (this.video) {
      this.video.pause();
      this.video.currentTime = 0;
    }

    // `is-animating` is the captured CSS's pre-entrance state.
    root.classList.add('is-animating');

    if (this.reduced) {
      root.classList.remove('is-animating');
      this.enterHold();
      return;
    }

    // Glyph metrics decide the word offsets, so wait for the real webfont.
    const start = () => this.playEntry();
    if (document.fonts?.status === 'loaded') start();
    else if (document.fonts) document.fonts.ready.then(start, start);
    else start();
  }

  /** Fades + slides each word in on a ramped stagger. */
  private playEntry(): void {
    if (this.entryPlayed) return;
    this.entryPlayed = true;

    // Per-word start times: the gap shrinks from 300ms toward 200ms across the
    // line, so the headline accelerates rather than ticking metronomically.
    const starts: number[] = [];
    let at = ENTRY_START_MS;
    const span = Math.max(this.words.length - 1, 1);
    this.words.forEach((_word, index) => {
      starts.push(at);
      const ramp = Math.min(index, span - 1) / span;
      at += STAGGER_MAX_MS + (STAGGER_MIN_MS - STAGGER_MAX_MS) * ramp;
    });

    // The propeller word carries a small optical y-correction.
    const startTransform = (inner: HTMLElement) =>
      inner.classList.contains('hero__propeller')
        ? `translate(${X_OFFSET_PX}px, -0.04em)`
        : `translateX(${X_OFFSET_PX}px)`;

    for (const inner of this.inners) {
      if (!inner) continue;
      inner.style.opacity = '0';
      inner.style.transform = startTransform(inner);
    }
    this.root.classList.remove('is-animating');

    this.inners.forEach((inner, index) => {
      if (!inner) return;

      this.entryTimers.push(
        window.setTimeout(() => {
          inner.style.transition = `opacity ${FADE_MS}ms ease`;
          inner.style.opacity = '1';
        }, starts[index]),
      );

      // Each word starts moving as the NEXT one starts fading, which is what
      // overlaps the stagger into one continuous motion. The last word has no
      // successor, so it uses a short fraction of the move duration instead.
      const moveAt =
        index < this.words.length - 1 ? starts[index + 1] : starts[index] + MOVE_MS * 0.3;
      this.entryTimers.push(
        window.setTimeout(() => {
          // Forces style flush so the transform transition actually animates.
          void getComputedStyle(inner).transform;
          inner.style.transition = `opacity ${FADE_MS}ms ease, transform ${MOVE_MS}ms ${MOVE_EASE}`;
          inner.style.transform = inner.classList.contains('hero__propeller')
            ? 'translateY(-0.04em)'
            : 'translate(0px, 0px)';
        }, moveAt),
      );
    });

    const propellerAt = starts[this.words.length - 1] + MOVE_MS;
    this.entryTimers.push(window.setTimeout(() => this.startPropeller(), propellerAt));
  }

  /** Starts the clip, which then pauses at 1.8s and waits for the visitor. */
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

    // Visitor already gestured before the clip was ready: skip the hold and
    // play straight through.
    if (this.resumed) {
      this.onEnded = () => this.settleClip();
      this.video.addEventListener('ended', this.onEnded);
      const duration = Number.isFinite(this.video.duration) ? this.video.duration : 3;
      this.entryTimers.push(
        window.setTimeout(() => this.settleClip(), duration * 1000 + SETTLE_GRACE_MS),
      );
      this.video.currentTime = 0;
      const played = this.video.play();
      if (played) played.catch(() => this.settleClip());
      this.animatePropellerMargin();
      return;
    }

    // timeupdate rather than a timer: media time is the only clock that stays
    // in sync with actual decoding.
    this.onPauseTime = () => {
      if (!this.video || this.video.currentTime < HOLD_AT_SECONDS) return;
      this.video.removeEventListener('timeupdate', this.onPauseTime!);
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

  /** Clip is parked on its hold frame, waiting for a gesture. */
  private enterHold(): void {
    if (this.holding || this.resumed) return;
    this.holding = true;
    this.onHold?.();
  }

  /** First scroll gesture: let the held clip run to its end. */
  resume(): void {
    if (this.resumed) return;
    this.resumed = true;
    this.holding = false;
    if (this.playThrough) return;

    if (!this.video) {
      this.settleClip();
      return;
    }
    // Gesture arrived before the clip even started; startPropeller will see
    // `resumed` and play straight through.
    if (!this.propellerStarted) return;

    if (this.onPauseTime) {
      this.video.removeEventListener('timeupdate', this.onPauseTime);
      this.onPauseTime = null;
    }
    this.onEnded = () => this.settleClip();
    this.video.addEventListener('ended', this.onEnded);

    // Safety net: if `ended` never fires (stall, or a source with no metadata)
    // settle anyway so the page can never stay locked.
    const remaining = Number.isFinite(this.video.duration)
      ? Math.max(this.video.duration - this.video.currentTime, 0)
      : 1;
    this.entryTimers.push(
      window.setTimeout(() => this.settleClip(), remaining * 1000 + SETTLE_GRACE_MS),
    );

    const played = this.video.play();
    if (played) played.catch(() => this.settleClip());
  }

  /** Muted autoplay can still be refused; re-arm on the next user gesture. */
  private attemptPlay(): void {
    if (!this.video) return;

    const onPlaying = () => {
      this.animatePropellerMargin();
      this.entryTimers.push(
        window.setTimeout(() => this.enterHold(), HOLD_AT_SECONDS * 1000 + SETTLE_GRACE_MS),
      );
    };

    const onBlocked = () => {
      if (this.gestureRetryArmed) return;
      this.gestureRetryArmed = true;
      const events = ['pointerdown', 'touchstart', 'keydown'];
      const retry = () => {
        for (const type of events) window.removeEventListener(type, retry);
        if (!this.video || this.resumed) return;
        this.video.play().then(onPlaying, () => this.enterHold());
      };
      for (const type of events) window.addEventListener(type, retry, { passive: true, once: true });
    };

    this.video.play().then(onPlaying, onBlocked);
  }

  /** Clip is done: detach it from layout and report completion. */
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

  /** Settles the propeller's negative margin and nudges the clip down. */
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
          video.style.transform = VIDEO_SHIFT;
        }
      }, MARGIN_DELAY_MS),
    );
  }

  /**
   * Lifts the clip out of the document into fixed positioning at its exact
   * current box, leaving a same-size placeholder so the headline's layout
   * doesn't reflow. Required before it can fly across the page.
   */
  private detachClip(): void {
    if (!this.video || this.detached) return;
    this.detached = true;

    const box = this.video.getBoundingClientRect();
    const propeller = this.video.closest<HTMLElement>('.hero__propeller');
    if (propeller) {
      const placeholder = document.createElement('span');
      placeholder.className = 'hero__propeller-placeholder';
      placeholder.style.width = `${box.width}px`;
      placeholder.style.height = `${box.height}px`;
      propeller.appendChild(placeholder);
      this.placeholder = placeholder;
    }

    const video = this.video;
    video.style.transition = 'none';
    video.style.position = 'fixed';
    video.style.margin = '0';
    video.style.left = `${box.left}px`;
    video.style.top = `${box.top}px`;
    video.style.width = `${box.width}px`;
    video.style.height = `${box.height}px`;
    video.style.transformOrigin = 'top left';
    video.style.transform = 'translate(0, 0) scale(1)';
    video.style.zIndex = '5';
    video.style.pointerEvents = 'none';
    document.body.appendChild(video);
    this.flightHome = box;
  }

  /** Flies the detached clip to a target element/box, then fades it out. */
  flyClipTo(target: Element | null, targetBox?: DOMRect): void {
    if (!this.video || this.flown) return;
    if (!this.detached) this.settleClip();
    if (!this.video || !this.detached) return;

    this.flown = true;
    this.flightActive = true;
    const video = this.video;

    if ((!target && !targetBox) || this.reduced) {
      this.fadeOutClip();
      return;
    }

    const home = this.flightHome || video.getBoundingClientRect();
    const destination = targetBox || target!.getBoundingClientRect();
    // Aim a quarter-size inside the target rather than dead centre.
    const dx = destination.left - (home.left + home.width / 2) + home.width * FLY_X_RATIO;
    const dy = destination.top - (home.top + home.height / 2) + home.height * FLY_Y_RATIO;

    void getComputedStyle(video).transform;
    video.style.transition = `transform ${FLY_MS}ms ${FLY_EASE}`;
    video.style.transform = `translate(${dx}px, ${dy}px)`;
    this.entryTimers.push(window.setTimeout(() => this.fadeOutClip(), FLY_MS));
  }

  private fadeOutClip(): void {
    const video = this.video;
    if (!video) return;
    video.style.transition = `${video.style.transition ? `${video.style.transition}, ` : ''}opacity ${FADE_OUT_MS}ms ease`;
    void getComputedStyle(video).opacity;
    video.style.opacity = '0';
    this.entryTimers.push(
      window.setTimeout(() => {
        this.flightActive = false;
        this.freeze();
      }, FADE_OUT_MS),
    );
  }

  /**
   * Visitor scrolled past the threshold: jump every word to its final state
   * immediately and stop pretending there is a cinematic.
   */
  finishInstantly(): void {
    if (this.finishedInstantly) return;
    this.finishedInstantly = true;

    for (const timer of this.entryTimers) window.clearTimeout(timer);
    this.entryTimers.length = 0;
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

  /** Stops driving the clip and swaps in its poster still. */
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

  /**
   * Replaces the <video> with its poster image. Ends the sequence in a stable,
   * cheap state — no decoder left running behind the fold.
   */
  freeze(): void {
    if (!this.video || this.frozen || this.flightActive) return;
    this.frozen = true;
    // The live page commits the hero's final background here.
    document.body.style.background = '#fff';

    const poster = this.video.getAttribute('poster');
    if (!poster) return;

    const still = document.createElement('img');
    still.className = 'hero__propeller-still';
    still.src = poster;
    still.alt = '';
    still.setAttribute('aria-hidden', 'true');

    const propeller =
      this.placeholder?.closest<HTMLElement>('.hero__propeller') ||
      this.video.closest<HTMLElement>('.hero__propeller');
    if (propeller) propeller.style.marginInline = '';

    if (this.detached) {
      if (this.placeholder) {
        this.placeholder.replaceWith(still);
        this.placeholder = null;
      } else if (propeller) {
        propeller.appendChild(still);
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
    this.entryTimers.length = 0;
    if (this.video && this.onEnded) this.video.removeEventListener('ended', this.onEnded);
    if (this.video && this.onPauseTime) {
      this.video.removeEventListener('timeupdate', this.onPauseTime);
    }
    // The clip was reparented to <body>, so unmount has to take it with us.
    if (this.detached && this.video) this.video.remove();
    this.placeholder?.remove();
  }
}

/**
 * Wires the hero cinematic to the page: the scroll lock, the hand-off to
 * `#intro`, the chevron button, and the intro headline's letter trail (which
 * freezes the propeller clip as it starts).
 *
 * The remaining `.reveal-headline` elements are deliberately left alone here —
 * `initIntuitLetterTrails` picks up every headline not already wrapped in
 * `.caterpillar`, which is exactly the set this module didn't claim.
 */
export function initIntuitHero(root: ParentNode = document): Teardown | void {
  const hero = root.querySelector<HTMLElement>('.hero');
  const intro = root.querySelector<HTMLElement>('#intro');
  const introHeadline = root.querySelector<HTMLElement>('#intro .reveal-headline');
  const statement = root.querySelector<HTMLElement>('#intro .intro__statement');
  if (!hero) return;

  let propeller: HeroPropeller | null = null;
  let trail: LetterTrail | null = null;
  /** What the chevron does right now; depends on how far the sequence got. */
  let chevronAction: (() => void) | null = null;
  const cleanups: Array<() => void> = [];

  if (intro && introHeadline) {
    const undim = () => hero.classList.remove('is-dimmed');

    let resumed = false;
    let transitioning = false;
    let abandoned = false;

    const GESTURES = ['wheel', 'touchmove', 'keydown'] as const;
    const detachGestures = () => {
      for (const type of GESTURES) window.removeEventListener(type, onGesture);
    };

    const threshold = () =>
      Math.max(window.innerHeight * DIM_THRESHOLD_RATIO, DIM_THRESHOLD_MIN_PX);

    const onScroll = () => {
      if (transitioning || abandoned) return;
      if (window.scrollY > threshold()) abandon();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    const detachScroll = () => window.removeEventListener('scroll', onScroll);

    /** First gesture: play the held clip rather than scrolling. */
    const resumeClip = () => {
      if (resumed || abandoned) return;
      resumed = true;
      propeller?.resume();
    };

    /** Visitor scrolled away: tear the whole cinematic down at once. */
    const abandon = () => {
      if (abandoned || transitioning) return;
      abandoned = true;
      detachGestures();
      detachScroll();
      undim();
      propeller?.finishInstantly();
    };

    let beginTransition = () => {};

    function onGesture(event: Event): void {
      const mouse = event as WheelEvent & TouchEvent & KeyboardEvent;
      // Never fight the global nav drawer or a modifier-key shortcut.
      if (isNavOpen() || event.defaultPrevented || mouse.ctrlKey || mouse.metaKey || mouse.altKey) {
        return;
      }
      if (event.type === 'keydown') {
        const key = (event as KeyboardEvent).key;
        const target = event.target;
        // Typing in a field, or tabbing to a control, is not a scroll intent.
        if (
          !SCROLL_KEYS.has(key) ||
          (target instanceof Element && target.closest(INTERACTIVE))
        ) {
          return;
        }
      }
      if (event.type === 'wheel' && (event as WheelEvent).deltaY === 0) return;
      // Multi-touch is a pinch/zoom, not a scroll.
      if (event.type === 'touchmove' && (event as TouchEvent).touches.length !== 1) return;

      if (event.cancelable) event.preventDefault();
      resumeClip();
    }

    // Non-passive so preventDefault actually holds the page still.
    for (const type of GESTURES) window.addEventListener(type, onGesture, { passive: false });

    const onHeroComplete = () => {
      if (!abandoned) beginTransition();
    };

    beginTransition = () => {
      if (transitioning || abandoned) return;
      transitioning = true;
      detachScroll();

      let handedOff = false;
      const handOff = () => {
        if (handedOff) return;
        handedOff = true;
        detachGestures();
        hero.removeEventListener('transitionend', onDimEnd);

        // Instant, not smooth: the dim already covered the movement, and a
        // smooth scroll here would race the clip's flight animation.
        intro.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });
        undim();

        const fly = () => {
          if (!statement) {
            propeller?.flyClipTo(statement);
            return;
          }
          // Measured after the scroll has committed, hence the double rAF.
          propeller?.flyClipTo(statement, statement.getBoundingClientRect());
        };
        requestAnimationFrame(() => requestAnimationFrame(fly));
      };

      const onDimEnd = (event: TransitionEvent) => {
        if (event.target === hero && event.propertyName === 'background-color') handOff();
      };
      hero.addEventListener('transitionend', onDimEnd);
      // Fallback if the transition is interrupted or never runs.
      const fallback = window.setTimeout(handOff, DIM_FALLBACK_MS);
      cleanups.push(() => window.clearTimeout(fallback));

      hero.classList.add('is-dimmed');
    };

    chevronAction = () => {
      if (abandoned || transitioning) {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        intro.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        return;
      }
      // Mid-cinematic: the chevron does whatever a scroll gesture would.
      if (resumed) beginTransition();
      else resumeClip();
    };

    propeller = new HeroPropeller(hero, { onComplete: onHeroComplete });

    // The trail starting is the cue to retire the propeller clip.
    trail = new LetterTrail(introHeadline, {
      onStart: () => propeller?.freeze(),
      startDelay: TRAIL_START_DELAY_MS,
    });

    cleanups.push(detachGestures, detachScroll);
  }

  // A hero with no intro section still gets its entrance animation.
  if (!propeller) propeller = new HeroPropeller(hero);

  const chevron = hero.querySelector<HTMLElement>('.hero__chevron');
  const onChevron = (event: Event) => {
    event.preventDefault();
    if (chevronAction) {
      chevronAction();
      return;
    }
    if (!intro) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    intro.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  };
  if (chevron && intro) {
    chevron.addEventListener('click', onChevron);
    cleanups.push(() => chevron.removeEventListener('click', onChevron));
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
    trail?.destroy();
    propeller?.destroy();
  };
}
