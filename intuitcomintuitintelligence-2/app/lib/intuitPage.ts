/**
 * Page-level behaviours ported from `intelligence.js`, `disclaimer.js` and
 * `prefooter.js`:
 *
 *  - `initPageReady` — adds `is-ready` to <html> once webfonts have settled
 *    (with a 1.5s hard timeout), plus the original's scroll-restoration reset.
 *  - `initStaggerReveals` — the `[data-stagger]` cascade that reveals grids.
 *  - `initNavLock` — mirrors <body>'s scroll lock into a class + offset so the
 *    page doesn't jump when the global nav drawer opens.
 *  - `initDisclaimerAccordion` — makes `.disclaimer__title` an a11y-correct
 *    expander.
 *  - `initPrefooterIconCycle` — idle highlight cycle across the prefooter icons.
 */

import type { Teardown } from './runtime';

/* ------------------------------------------------------------------ */
/* is-ready / scroll restoration                                       */
/* ------------------------------------------------------------------ */

/** Hard cap: `is-ready` lands even if font loading never resolves. */
const PAGE_READY_TIMEOUT_MS = 1500;

/**
 * Runs once per page load, never again on a React re-mount.
 *
 * `window.scrollTo(0, 0)` is deliberately one-shot: the original runs it at
 * script-eval time to guarantee the hero cinematic starts from the top, and
 * re-running it on a strict-mode remount would yank a scrolled visitor back.
 */
let pageReadyRan = false;

export function initPageReady(): Teardown | void {
  if (pageReadyRan) return;
  pageReadyRan = true;

  // The hero sequence is only coherent from scroll position 0, so opt out of
  // the browser restoring a previous offset on reload.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  const markReady = () => document.documentElement.classList.add('is-ready');
  const timer = window.setTimeout(markReady, PAGE_READY_TIMEOUT_MS);
  const onFonts = () => {
    window.clearTimeout(timer);
    // Double rAF: one frame to apply the newly-loaded font, one to paint it,
    // so `is-ready` transitions never reveal fallback-font text.
    requestAnimationFrame(() => requestAnimationFrame(markReady));
  };

  if (document.fonts) document.fonts.ready.then(onFonts, onFonts);
  else onFonts();

  return () => window.clearTimeout(timer);
}

/* ------------------------------------------------------------------ */
/* [data-stagger]                                                      */
/* ------------------------------------------------------------------ */

/** Gap between successive children being revealed. */
const STAGGER_STEP_MS = 300;

/**
 * Reveals a container's children one after another via `is-revealed`.
 *
 * `.features__cards` is special-cased to its `.features__card` descendants
 * rather than its direct children, because that grid wraps cards in layout
 * elements. Fires once per container, then unobserves.
 */
export function initStaggerReveals(root: ParentNode = document): Teardown | void {
  const containers = Array.from(root.querySelectorAll<HTMLElement>('[data-stagger]'));
  if (!containers.length) return;

  const timers = new Set<number>();

  const reveal = (container: HTMLElement) => {
    const items = container.matches('.features__cards')
      ? Array.from(container.querySelectorAll<HTMLElement>('.features__card'))
      : (Array.from(container.children) as HTMLElement[]);

    items.forEach((item, index) => {
      const timer = window.setTimeout(() => {
        item.classList.add('is-revealed');
        timers.delete(timer);
      }, index * STAGGER_STEP_MS);
      timers.add(timer);
    });
  };

  if (!('IntersectionObserver' in window)) {
    for (const container of containers) reveal(container);
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
    };
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        reveal(entry.target as HTMLElement);
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0, rootMargin: '0px 0px -20% 0px' },
  );
  for (const container of containers) observer.observe(container);

  return () => {
    observer.disconnect();
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
  };
}

/* ------------------------------------------------------------------ */
/* nav scroll lock                                                     */
/* ------------------------------------------------------------------ */

const NAV_LOCK_CLASS = 'icom-nav-locked';

/**
 * Turns the global nav's `overflow: hidden` into a proper scroll lock.
 *
 * The nav component only sets `overflow: hidden` on <body>, which on iOS still
 * lets the page drift and, once `position` changes, loses the scroll offset
 * entirely. A MutationObserver on <body>'s `style` attribute is the only hook
 * available (the nav is third-party markup), so we watch it and pin the body at
 * a negative `top` equal to the current scroll offset, restoring it on unlock.
 */
export function initNavLock(): Teardown | void {
  const body = document.body;
  let locked = false;
  let offset = 0;

  const lock = () => {
    if (locked) return;
    locked = true;
    offset = window.scrollY || window.pageYOffset || 0;
    body.style.top = `-${offset}px`;
    body.classList.add(NAV_LOCK_CLASS);
  };

  const unlock = () => {
    if (!locked) return;
    locked = false;
    body.classList.remove(NAV_LOCK_CLASS);
    body.style.top = '';
    // 'instant' so restoring position is never animated.
    window.scrollTo({ top: offset, left: 0, behavior: 'instant' as ScrollBehavior });
  };

  const sync = () => (body.style.overflow.trim() === 'hidden' ? lock() : unlock());

  const observer = new MutationObserver(sync);
  observer.observe(body, { attributes: true, attributeFilter: ['style'] });
  sync();

  return () => {
    observer.disconnect();
    unlock();
  };
}

/* ------------------------------------------------------------------ */
/* disclaimer accordion                                               */
/* ------------------------------------------------------------------ */

/**
 * Makes `.disclaimer__title` an expander for `.disclaimer__content`.
 *
 * The captured markup is a plain <div>, so the roles/ARIA wiring has to be
 * applied at runtime exactly as the original does — including Enter/Space
 * activation, since a div gets none of a button's behaviour for free.
 */
export function initDisclaimerAccordion(root: ParentNode = document): Teardown | void {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.disclaimer'));
  if (!blocks.length) return;

  const cleanups: Array<() => void> = [];

  for (const block of blocks) {
    const title = block.querySelector<HTMLElement>('.disclaimer__title');
    const content = block.querySelector<HTMLElement>('.disclaimer__content');
    if (!title) continue;

    title.setAttribute('role', 'button');
    title.setAttribute('tabindex', '0');
    title.setAttribute('aria-expanded', 'false');
    title.style.cursor = 'pointer';
    if (content) {
      if (!content.id) content.id = 'disclaimer-content';
      title.setAttribute('aria-controls', content.id);
    }

    const toggle = () => {
      const open = block.classList.toggle('is-open');
      title.setAttribute('aria-expanded', String(open));
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      // Space would otherwise scroll the page.
      event.preventDefault();
      toggle();
    };

    title.addEventListener('click', toggle);
    title.addEventListener('keydown', onKeydown);
    cleanups.push(() => {
      title.removeEventListener('click', toggle);
      title.removeEventListener('keydown', onKeydown);
    });
  }

  if (!cleanups.length) return;
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

/* ------------------------------------------------------------------ */
/* prefooter icon cycle                                                */
/* ------------------------------------------------------------------ */

/** Time each icon stays highlighted. */
const HIGHLIGHT_STEP_MS = 1000;
/** Idle time before the automatic cycle takes over. */
const IDLE_DELAY_MS = 4000;
/** The cycle only runs while this much of the prefooter is visible. */
const PREFOOTER_THRESHOLD = 0.4;

class PrefooterIconCycle {
  private readonly items: HTMLElement[];
  private readonly cleanups: Array<() => void> = [];
  private observer?: IntersectionObserver;

  private index = 0;
  private timer: number | null = null;
  private idleTimer: number | null = null;
  private inView = false;
  private hovering = false;

  constructor(private readonly root: HTMLElement) {
    // Equivalent to the original's `li:has(a)`, but computed in JS so it also
    // works where `:has()` in querySelectorAll isn't supported.
    this.items = Array.from(root.querySelectorAll<HTMLElement>('.prefooter__icons li')).filter(
      (item) => item.querySelector('a'),
    );
    if (!this.items.length) return;

    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) this.bindHover();

    this.observer = new IntersectionObserver(
      ([entry]) => {
        this.inView = entry.isIntersecting;
        if (this.inView) this.scheduleIdle();
        else this.stop();
      },
      { threshold: PREFOOTER_THRESHOLD },
    );
    this.observer.observe(root);
  }

  private on(target: EventTarget, type: string, handler: EventListener): void {
    target.addEventListener(type, handler);
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }

  /** Pointer interaction always wins: the visitor's hover beats the cycle. */
  private bindHover(): void {
    for (const item of this.items) {
      this.on(item, 'pointerenter', () => {
        this.hovering = true;
        this.clearIdle();
        this.stop();
      });
      this.on(item, 'pointerleave', () => {
        this.hovering = false;
        this.scheduleIdle();
      });
    }
    // Moving anywhere in the prefooter (but not over an icon) restarts the
    // idle countdown rather than cycling immediately under the pointer.
    this.on(this.root, 'pointermove', () => {
      if (this.hovering) return;
      this.stop();
      this.scheduleIdle();
    });
  }

  private scheduleIdle(): void {
    this.clearIdle();
    if (!this.inView || this.hovering) return;
    this.idleTimer = window.setTimeout(() => this.start(), IDLE_DELAY_MS);
  }

  private clearIdle(): void {
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private start(): void {
    if (this.timer !== null || !this.inView || this.hovering) return;
    const step = () => {
      this.clearHighlight();
      this.items[this.index % this.items.length].classList.add('is-highlighted');
      this.index += 1;
      this.timer = window.setTimeout(step, HIGHLIGHT_STEP_MS);
    };
    step();
  }

  private stop(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.clearHighlight();
  }

  private clearHighlight(): void {
    for (const item of this.items) item.classList.remove('is-highlighted');
  }

  destroy(): void {
    this.stop();
    this.clearIdle();
    this.observer?.disconnect();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }
}

/** Starts the idle icon cycle for every `.prefooter`. */
export function initPrefooterIconCycle(root: ParentNode = document): Teardown | void {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.prefooter'));
  if (!blocks.length) return;
  const cycles = blocks.map((block) => new PrefooterIconCycle(block));
  return () => {
    for (const cycle of cycles) cycle.destroy();
  };
}
