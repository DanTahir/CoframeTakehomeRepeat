/**
 * Page-level effects ported from scrape/raw/js/intelligence.a7cda79c.js
 * (functions `be` stagger, `Se` visible-video autoplay, `U`/`Re` page-ready) and
 * scrape/raw/js/prefooter.a922aff5.js (class `P` prefooter icons, function `C` card cursor).
 *
 * The reveal helpers here are load-bearing: `.intro__point`, `.features__card` and
 * `.intro .tabbed-banner` are all `opacity:0` in the page's base CSS and only become
 * visible once `is-revealed` / `is-inview` is applied.
 */

const READY_FALLBACK_MS = 1500; // `Re`
const STAGGER_STEP_MS = 300; // `Le`
const PREFOOTER_STEP_MS = 1000; // `k`
const PREFOOTER_IDLE_MS = 4000; // `A`

/** `Ae` — videos owned by another controller must not be auto-played by the generic pass. */
const OWNED_VIDEO_SELECTOR =
  '.hero__propeller-video, [data-play-when-visible], [data-playback-owned]';

const canHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/** `Vt` / `Qt` from disclaimer.js — chevrons dim for 2s when pressed. */
const CLICK_FADE_SELECTOR = '.hero__chevron, .hcihy__chevron, .intro__chevron';
const CLICK_FADE_MS = 2000;

/**
 * `ie` — a delegated pointerdown that briefly adds `is-click-faded` to a chevron, so the
 * scroll cue fades out of the way once the visitor has acted on it.
 */
export function initClickFade(): () => void {
  const timers = new WeakMap<Element, number>();

  const onPointerDown = (event: PointerEvent) => {
    const target = (event.target as Element | null)?.closest?.(CLICK_FADE_SELECTOR);
    if (!target) return;
    target.classList.add('is-click-faded');
    const existing = timers.get(target);
    if (existing) window.clearTimeout(existing);
    timers.set(
      target,
      window.setTimeout(() => {
        target.classList.remove('is-click-faded');
        timers.delete(target);
      }, CLICK_FADE_MS),
    );
  };

  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  return () => document.removeEventListener('pointerdown', onPointerDown);
}

/**
 * Adds `is-ready` to <html> once fonts have settled (or after 1500ms regardless), which is
 * what un-gates the page's entry animations. Also mirrors the original's scroll reset.
 */
export function initPageReady(): () => void {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  const markReady = () => document.documentElement.classList.add('is-ready');
  const fallback = window.setTimeout(markReady, READY_FALLBACK_MS);
  const ready = () => {
    window.clearTimeout(fallback);
    requestAnimationFrame(() => requestAnimationFrame(markReady));
  };

  if (document.fonts) document.fonts.ready.then(ready, ready);
  else ready();

  return () => window.clearTimeout(fallback);
}

/**
 * `be` — reveals the children of every `[data-stagger]` container 300ms apart once the
 * container scrolls into view. `.features__cards` staggers its `.features__card`
 * descendants; anything else staggers its direct children.
 */
export function initStagger(scope: ParentNode = document): () => void {
  const containers = Array.from(scope.querySelectorAll<HTMLElement>('[data-stagger]'));
  if (!containers.length) return () => {};

  const timers: number[] = [];
  const reveal = (container: Element) => {
    const children = container.matches('.features__cards')
      ? Array.from(container.querySelectorAll<HTMLElement>('.features__card'))
      : (Array.from(container.children) as HTMLElement[]);
    children.forEach((child, index) => {
      timers.push(
        window.setTimeout(() => child.classList.add('is-revealed'), index * STAGGER_STEP_MS),
      );
    });
  };

  if (!('IntersectionObserver' in window)) {
    containers.forEach(reveal);
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        reveal(entry.target);
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0, rootMargin: '0px 0px -20% 0px' },
  );
  for (const container of containers) observer.observe(container);

  return () => {
    observer.disconnect();
    for (const timer of timers) window.clearTimeout(timer);
  };
}

/** The trailing block of the original bundle: `.intro .tabbed-banner` gains `is-inview`. */
export function initIntroBannerReveal(scope: ParentNode = document): () => void {
  const banners = Array.from(scope.querySelectorAll<HTMLElement>('.intro .tabbed-banner'));
  if (!banners.length) return () => {};

  if (!('IntersectionObserver' in window)) {
    for (const banner of banners) banner.classList.add('is-inview');
    return () => {};
  }

  const observers = banners.map((banner) => {
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
    observer.observe(banner);
    return observer;
  });

  return () => {
    for (const observer of observers) observer.disconnect();
  };
}

/**
 * `Se` — plays/pauses any video that no other controller owns as it enters/leaves view.
 * A video is only resumed if it was actually playing when it left.
 */
export function initVisibleVideos(scope: ParentNode = document): () => void {
  const videos = Array.from(scope.querySelectorAll<HTMLVideoElement>('video')).filter(
    (video) => !video.matches(OWNED_VIDEO_SELECTOR),
  );
  if (!videos.length || !('IntersectionObserver' in window)) return () => {};

  const wasPlaying = new WeakMap<Element, boolean>();
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

/**
 * `C` — the "Find out more" label that follows the pointer across the feature cards.
 * Hover-capable pointers only, so it is inert on touch devices and in screenshots.
 */
export function initCardCursor(container: HTMLElement | null, cardSelector: string): () => void {
  if (!container || !cardSelector) return () => {};
  if (!canHover()) return () => {};

  const cursor = document.createElement('span');
  cursor.className = 'card-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.textContent = 'Find out more';
  container.append(cursor);

  let zone: HTMLElement | null = null;
  let pointerX = 0;
  let pointerY = 0;

  const place = (x: number, y: number) => {
    const rect = container.getBoundingClientRect();
    cursor.style.setProperty('--card-cursor-x', `${x - rect.left}px`);
    cursor.style.setProperty('--card-cursor-y', `${y - rect.top}px`);
  };
  const track = (event: PointerEvent) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    place(pointerX, pointerY);
  };
  const reposition = () => {
    if (zone) place(pointerX, pointerY);
  };
  const enter = (card: HTMLElement, event: PointerEvent) => {
    if (zone && zone !== card) zone.classList.remove('is-cursor-zone');
    zone = card;
    card.classList.add('is-cursor-zone');
    track(event);
    requestAnimationFrame(() => cursor.classList.add('is-active'));
  };
  const leave = (card: HTMLElement) => {
    card.classList.remove('is-cursor-zone');
    if (zone === card) zone = null;
    cursor.classList.remove('is-active');
  };

  const onOver = (event: PointerEvent) => {
    const card = (event.target as Element | null)?.closest<HTMLElement>(cardSelector);
    if (!card || !container.contains(card)) return;
    if (card !== zone) enter(card, event);
  };
  const onMove = (event: PointerEvent) => {
    if (zone) track(event);
  };
  const onOut = (event: PointerEvent) => {
    const card = (event.target as Element | null)?.closest<HTMLElement>(cardSelector);
    if (!card) return;
    if (card.contains(event.relatedTarget as Node | null)) return;
    if (card === zone) leave(card);
  };

  container.addEventListener('pointerover', onOver);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerout', onOut);
  window.addEventListener('scroll', reposition, { passive: true, capture: true });

  return () => {
    container.removeEventListener('pointerover', onOver);
    container.removeEventListener('pointermove', onMove);
    container.removeEventListener('pointerout', onOut);
    window.removeEventListener('scroll', reposition, { capture: true });
    cursor.remove();
  };
}

/** Wires a card cursor onto every `.features__cards` group, scoped to its `.features__inner`. */
export function initCardCursors(scope: ParentNode = document): () => void {
  const cleanups = Array.from(scope.querySelectorAll<HTMLElement>('.features__cards')).map(
    (cards) =>
      initCardCursor(
        cards.closest<HTMLElement>('.features__inner') || cards,
        '.features__card',
      ),
  );
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

/**
 * `P` — once the prefooter has been in view and idle for 4s, highlight its icons one after
 * another every second. Hovering (or any pointer movement over it) cancels the cycle.
 */
export function initPrefooterIcons(scope: ParentNode = document): () => void {
  const roots = Array.from(scope.querySelectorAll<HTMLElement>('.prefooter'));
  const cleanups: (() => void)[] = [];

  for (const root of roots) {
    const items = Array.from(root.querySelectorAll<HTMLElement>('.prefooter__icons li')).filter(
      (item) => item.querySelector('a'),
    );
    if (!items.length) continue;

    let index = 0;
    let timer: number | null = null;
    let idleTimer: number | null = null;
    let inView = false;
    let hovering = false;

    const clearHighlight = () => {
      for (const item of items) item.classList.remove('is-highlighted');
    };
    const stop = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      clearHighlight();
    };
    const clearIdle = () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = null;
    };
    const start = () => {
      if (timer !== null || !inView || hovering) return;
      const step = () => {
        clearHighlight();
        items[index % items.length].classList.add('is-highlighted');
        index += 1;
        timer = window.setTimeout(step, PREFOOTER_STEP_MS);
      };
      step();
    };
    const scheduleIdle = () => {
      clearIdle();
      if (!inView || hovering) return;
      idleTimer = window.setTimeout(start, PREFOOTER_IDLE_MS);
    };

    const itemCleanups: (() => void)[] = [];
    if (canHover()) {
      for (const item of items) {
        const onEnter = () => {
          hovering = true;
          clearIdle();
          stop();
        };
        const onLeave = () => {
          hovering = false;
          scheduleIdle();
        };
        item.addEventListener('pointerenter', onEnter);
        item.addEventListener('pointerleave', onLeave);
        itemCleanups.push(() => {
          item.removeEventListener('pointerenter', onEnter);
          item.removeEventListener('pointerleave', onLeave);
        });
      }
      const onMove = () => {
        if (hovering) return;
        stop();
        scheduleIdle();
      };
      root.addEventListener('pointermove', onMove);
      itemCleanups.push(() => root.removeEventListener('pointermove', onMove));
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        if (inView) scheduleIdle();
        else stop();
      },
      { threshold: 0.4 },
    );
    observer.observe(root);

    cleanups.push(() => {
      observer.disconnect();
      clearIdle();
      stop();
      for (const cleanup of itemCleanups) cleanup();
    });
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
