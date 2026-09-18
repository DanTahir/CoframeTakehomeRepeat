/**
 * Custom cursor / pointer-feedback effects, ported from `disclaimer.js` and
 * `prefooter.js`.
 *
 *  - `initAppCursor` — a document-level custom cursor element that morphs
 *    between states depending on which "zone" the pointer is over.
 *  - `initCardCursors` — a per-container "Find out more" label that follows the
 *    pointer across the feature cards.
 *  - `initCtaRipple` — a radial fill that grows from the exact hover point on
 *    buttons and pills.
 *  - `initChevronClickFade` — fades a scroll chevron out for 2s once clicked.
 *
 * Every one of these is pointer-only: each bails out unless
 * `(hover: hover) and (pointer: fine)` matches, so touch devices get the plain
 * layout exactly as they do on the live site.
 */

import type { Teardown } from './runtime';

const FINE_POINTER = '(hover: hover) and (pointer: fine)';

/** Zone markers the app cursor reacts to; both are set by other effects. */
const CURSOR_ZONE = '.is-cursor-zone';
const CTA_ZONE = '.is-cta-zone';

/* ------------------------------------------------------------------ */
/* app cursor                                                          */
/* ------------------------------------------------------------------ */

type CursorState = 'hidden' | 'shown' | 'morphed' | 'cta-fade';

/**
 * The page-wide custom cursor.
 *
 * State is derived from the DOM rather than from hit-testing: the original
 * checks for the PRESENCE of a `.is-cursor-zone` / `.is-cta-zone` element
 * anywhere in the document, because those classes are applied by the card and
 * CTA effects as the pointer enters them. Ported as-is.
 */
export function initAppCursor(): Teardown | void {
  const fine = window.matchMedia(FINE_POINTER);
  if (!fine.matches) return;

  const cursor = document.createElement('div');
  cursor.className = 'app-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cursor);
  // Lets the captured CSS hide the native cursor only when ours exists.
  document.documentElement.classList.add('has-app-cursor');

  let state: CursorState = 'hidden';

  const show = () => {
    cursor.style.removeProperty('--app-cursor-color');
    if (state === 'shown') return;
    state = 'shown';
    cursor.classList.add('is-visible');
    cursor.classList.remove('is-morphing', 'is-cta-fade');
  };

  const morph = () => {
    cursor.style.removeProperty('--app-cursor-color');
    if (state === 'morphed') return;
    state = 'morphed';
    cursor.classList.add('is-visible', 'is-morphing');
    cursor.classList.remove('is-cta-fade');
  };

  const hide = () => {
    cursor.style.removeProperty('--app-cursor-color');
    if (state === 'hidden') return;
    state = 'hidden';
    cursor.classList.remove('is-visible', 'is-morphing', 'is-cta-fade');
  };

  const ctaFade = (zone: Element | null) => {
    // The CTA can name its own cursor colour via a custom property.
    const color = zone
      ? getComputedStyle(zone).getPropertyValue('--app-cursor-color').trim()
      : '';
    if (color) cursor.style.setProperty('--app-cursor-color', color);
    else cursor.style.removeProperty('--app-cursor-color');
    if (state === 'cta-fade') return;
    state = 'cta-fade';
    cursor.classList.remove('is-morphing');
    cursor.classList.add('is-cta-fade');
  };

  const inCursorZone = () => document.querySelector(CURSOR_ZONE) !== null;
  const ctaZone = () => document.querySelector(CTA_ZONE);

  let last: { x: number; y: number } | null = null;

  const apply = () => {
    const cta = ctaZone();
    if (cta) ctaFade(cta);
    else if (inCursorZone()) morph();
    else show();
  };

  const onPointer = (event: Event) => {
    const pointer = event as PointerEvent;
    last = { x: pointer.clientX, y: pointer.clientY };
    cursor.style.setProperty('--app-cursor-x', `${pointer.clientX}px`);
    cursor.style.setProperty('--app-cursor-y', `${pointer.clientY}px`);
    apply();
  };

  // Scrolling changes what's under a stationary pointer, so re-derive state.
  const onScroll = () => {
    if (last) apply();
  };

  const onMotionChange = (event: MediaQueryListEvent) => {
    if (event.matches) return;
    // Switched to a coarse pointer (e.g. tablet mode): remove ourselves.
    hide();
    cursor.remove();
    document.documentElement.classList.remove('has-app-cursor');
  };

  window.addEventListener('pointermove', onPointer, { passive: true });
  document.addEventListener('pointerdown', onPointer, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  document.addEventListener('mouseleave', hide);
  window.addEventListener('blur', hide);
  fine.addEventListener('change', onMotionChange);

  return () => {
    window.removeEventListener('pointermove', onPointer);
    document.removeEventListener('pointerdown', onPointer);
    window.removeEventListener('scroll', onScroll, { capture: true });
    document.removeEventListener('mouseleave', hide);
    window.removeEventListener('blur', hide);
    fine.removeEventListener('change', onMotionChange);
    cursor.remove();
    document.documentElement.classList.remove('has-app-cursor');
  };
}

/* ------------------------------------------------------------------ */
/* chevron click fade                                                  */
/* ------------------------------------------------------------------ */

const CHEVRONS = '.hero__chevron, .hcihy__chevron, .intro__chevron';
/** How long a clicked chevron stays faded before returning. */
const CHEVRON_FADE_MS = 2000;

/** Fades a scroll chevron after it is used, so it stops nagging. */
export function initChevronClickFade(): Teardown | void {
  const timers = new WeakMap<Element, number>();
  const pending = new Set<number>();

  const onPointerDown = (event: Event) => {
    const chevron = (event.target as Element | null)?.closest?.(CHEVRONS);
    if (!chevron) return;
    chevron.classList.add('is-click-faded');

    const existing = timers.get(chevron);
    if (existing) {
      window.clearTimeout(existing);
      pending.delete(existing);
    }
    const timer = window.setTimeout(() => {
      chevron.classList.remove('is-click-faded');
      timers.delete(chevron);
      pending.delete(timer);
    }, CHEVRON_FADE_MS);
    timers.set(chevron, timer);
    pending.add(timer);
  };

  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  return () => {
    document.removeEventListener('pointerdown', onPointerDown);
    for (const timer of pending) window.clearTimeout(timer);
    pending.clear();
  };
}

/* ------------------------------------------------------------------ */
/* CTA ripple                                                          */
/* ------------------------------------------------------------------ */

/** Everything that gets the radial hover fill. */
const CTA_TARGETS = [
  '.hcihy__button',
  '.getmoredone .btn',
  '.testimonials__button',
  '.whatsnew__cards__card--btn a',
  '.hcihy__tabs-nav a',
  '.btn-pill',
  '.dropdown-grid__toggle',
].join(', ');

/** How long a touch-tap's ripple stays filled before reversing. */
const TAP_HOLD_MS = 720;

interface RipplePoint {
  x: number;
  y: number;
  radius: number;
}

/**
 * Radial fill that grows from the pointer's entry point.
 *
 * The radius is computed from the FARTHEST corner (plus 1px) so the circle is
 * guaranteed to cover the whole element no matter where the pointer entered.
 * Also sets `is-cta-zone`, which is what makes the app cursor fade over CTAs.
 */
export function initCtaRipple(root: ParentNode = document): Teardown | void {
  const host = (root instanceof Document ? root : document) as Document;

  const pointFor = (element: HTMLElement, event: PointerEvent): RipplePoint => {
    const box = element.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - box.left, 0), box.width);
    const y = Math.min(Math.max(event.clientY - box.top, 0), box.height);
    const radius = Math.hypot(Math.max(x, box.width - x), Math.max(y, box.height - y)) + 1;
    return { x, y, radius };
  };

  const setOrigin = (element: HTMLElement, { x, y }: RipplePoint) => {
    element.style.setProperty('--fill-x', `${x}px`);
    element.style.setProperty('--fill-y', `${y}px`);
  };

  const fillIn = (element: HTMLElement, point: RipplePoint) => {
    setOrigin(element, point);
    element.classList.add('is-cta-zone');
    element.style.setProperty('--fill-radius', '0px');
    // Radius is committed on the next frame so the transition has a start.
    requestAnimationFrame(() => {
      element.dataset.filled = 'true';
      element.style.setProperty('--fill-radius', `${point.radius}px`);
    });
  };

  const fillOut = (element: HTMLElement, point: RipplePoint) => {
    element.classList.remove('is-cta-zone');
    setOrigin(element, point);
    element.style.setProperty('--fill-radius', `${point.radius}px`);
    requestAnimationFrame(() => {
      element.dataset.filled = 'false';
      element.style.setProperty('--fill-radius', '0px');
    });
  };

  const isTouch = (event: PointerEvent) =>
    event.pointerType === 'touch' || event.pointerType === 'pen';

  /** Elements mid-tap, whose pointerleave must not cancel the animation. */
  const tapping = new WeakSet<HTMLElement>();
  const tapTimers = new WeakMap<HTMLElement, number>();

  const onEnter = (event: Event) => {
    const pointer = event as PointerEvent;
    if (isTouch(pointer)) return;
    const target = (pointer.target as Element | null)?.closest?.(CTA_TARGETS) as HTMLElement | null;
    if (!target) return;
    fillIn(target, pointFor(target, pointer));
  };

  const onLeave = (event: Event) => {
    const pointer = event as PointerEvent;
    const target = (pointer.target as Element | null)?.closest?.(CTA_TARGETS) as HTMLElement | null;
    if (!target || isTouch(pointer) || tapping.has(target)) return;
    fillOut(target, pointFor(target, pointer));
  };

  const onDown = (event: Event) => {
    const pointer = event as PointerEvent;
    if (!isTouch(pointer)) return;
    const target = (pointer.target as Element | null)?.closest?.(CTA_TARGETS) as HTMLElement | null;
    if (!target) return;

    // Touch has no hover, so play the fill and auto-reverse it.
    const point = pointFor(target, pointer);
    tapping.add(target);
    fillIn(target, point);
    const existing = tapTimers.get(target);
    if (existing) window.clearTimeout(existing);
    tapTimers.set(
      target,
      window.setTimeout(() => {
        fillOut(target, point);
        tapping.delete(target);
      }, TAP_HOLD_MS),
    );
  };

  // Capture phase: pointerenter/leave don't bubble.
  host.addEventListener('pointerenter', onEnter, true);
  host.addEventListener('pointerleave', onLeave, true);
  host.addEventListener('pointerdown', onDown, true);

  return () => {
    host.removeEventListener('pointerenter', onEnter, true);
    host.removeEventListener('pointerleave', onLeave, true);
    host.removeEventListener('pointerdown', onDown, true);
  };
}

/* ------------------------------------------------------------------ */
/* card cursor                                                         */
/* ------------------------------------------------------------------ */

/**
 * A "Find out more" label that tracks the pointer inside `container`, shown
 * whenever the pointer is over a descendant matching `cardSelector`.
 */
export function createCardCursor(container: HTMLElement | null, cardSelector: string): Teardown {
  if (!container) return () => {};
  if (!window.matchMedia(FINE_POINTER).matches) return () => {};

  const label = document.createElement('span');
  label.className = 'card-cursor';
  label.setAttribute('aria-hidden', 'true');
  label.textContent = 'Find out more';
  container.append(label);

  let active: Element | null = null;
  let x = 0;
  let y = 0;

  const place = (clientX: number, clientY: number) => {
    const box = container.getBoundingClientRect();
    label.style.setProperty('--card-cursor-x', `${clientX - box.left}px`);
    label.style.setProperty('--card-cursor-y', `${clientY - box.top}px`);
  };

  const track = (event: PointerEvent) => {
    x = event.clientX;
    y = event.clientY;
    place(x, y);
  };

  const onScroll = () => {
    if (active) place(x, y);
  };

  const enter = (card: Element, event: PointerEvent) => {
    if (active && active !== card) active.classList.remove('is-cursor-zone');
    active = card;
    // `is-cursor-zone` is also what tells the app cursor to morph.
    card.classList.add('is-cursor-zone');
    track(event);
    requestAnimationFrame(() => label.classList.add('is-active'));
  };

  const leave = (card: Element) => {
    card.classList.remove('is-cursor-zone');
    if (active === card) active = null;
    label.classList.remove('is-active');
  };

  const onOver = (event: Event) => {
    const pointer = event as PointerEvent;
    const card = (pointer.target as Element | null)?.closest?.(cardSelector);
    if (!card || !container.contains(card) || card === active) return;
    enter(card, pointer);
  };

  const onMove = (event: Event) => {
    if (active) track(event as PointerEvent);
  };

  const onOut = (event: Event) => {
    const pointer = event as PointerEvent;
    const card = (pointer.target as Element | null)?.closest?.(cardSelector);
    // Ignore moves between a card's own descendants.
    if (!card || card.contains(pointer.relatedTarget as Node | null)) return;
    if (card === active) leave(card);
  };

  container.addEventListener('pointerover', onOver);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerout', onOut);
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });

  return () => {
    container.removeEventListener('pointerover', onOver);
    container.removeEventListener('pointermove', onMove);
    container.removeEventListener('pointerout', onOut);
    window.removeEventListener('scroll', onScroll, { capture: true });
    active?.classList.remove('is-cursor-zone');
    label.remove();
  };
}

/**
 * Wires the card cursor to the feature cards. The label is hosted on
 * `.features__inner` when present (it is the positioned ancestor), falling back
 * to the card grid itself.
 */
export function initCardCursors(root: ParentNode = document): Teardown | void {
  const grids = Array.from(root.querySelectorAll<HTMLElement>('.features__cards'));
  if (!grids.length) return;

  const teardowns = grids.map((grid) =>
    createCardCursor(grid.closest<HTMLElement>('.features__inner') ?? grid, '.features__card'),
  );
  return () => {
    for (const teardown of teardowns) teardown();
  };
}
