/**
 * Scroll reveals for dropbox.com.
 *
 * The page hides three groups of content behind a stylesheet class and adds a
 * "visible" class with its own JS during scroll. Codegen captures the DOM
 * pre-scroll, so without this module those blocks ship frozen at `opacity: 0`
 * (plus blur/scale) forever — no error, just blank space under a heading.
 *
 * Pairs come from `scrape/analysis/scroll-reveals.json`, which diffs class
 * tokens pre/post scroll and flags the ones whose base rule gates visibility.
 *
 * TWO NON-OBVIOUS DETAILS
 * -----------------------
 * 1. CLIPPED CONTAINERS. The quote cards live in a horizontally scrollable rail
 *    (`overflow-x: scroll`) that is far wider than the viewport, so the third
 *    card sits outside the clip window. IntersectionObserver computes
 *    intersection THROUGH that clip while `rootMargin` inflates only the root
 *    rect — so a wide margin does not help, and that card would stay invisible
 *    at every viewport. Hence `groupSelector`: observe the rail and reveal all
 *    of its members at once.
 * 2. `threshold: 0`. A rail ~2.4k px wide peaks near a 0.15 intersection ratio
 *    on a 375px phone, so any fractional threshold could never fire.
 *
 * No JS stagger: the capture already ships inline `--dwg-iteration-index` and
 * the site's CSS turns it into `animation-delay`.
 */
import { $all, prefersReducedMotion, type Teardown } from './runtime';

export interface RevealPair {
  /** Selector for elements the stylesheet hides. */
  base: string;
  /** Class the site's own JS adds to reveal them. */
  visible: string;
  /**
   * Optional clipping/grouping ancestor to observe instead of each element.
   * Required whenever members can sit outside an `overflow` container.
   */
  groupSelector?: string;
}

/**
 * Capture-bound: the hashed CSS-module names rotate whenever Dropbox rebuilds.
 * `tests/dropbox.test.ts` asserts every pair still matches the generated
 * markup, so a rotation fails the suite instead of silently blanking the page.
 */
export const DROPBOX_REVEAL_PAIRS: readonly RevealPair[] = [
  // 9 carriers: the "Do more" / "Everything you need" card grids.
  {
    base: '.dwg-multi-block-card-entry-animation',
    visible: 'dwg-multi-block-card-entry-animation--is-visible',
  },
  // 3 carriers: security quote cards inside the clipped, draggable rail.
  {
    base: '._card_1b963_1._cardEntryAnimation_1b963_1',
    visible: '_cardShow_1b963_8',
    groupSelector: '._scrollArea_bb0ya_5',
  },
  // 1 carrier: the share-UI media stack (base rule translateY(300px)).
  {
    base: '._mediaContainer_thadj_29',
    visible: '_mediaContainerVisible_thadj_62',
  },
];

export interface DropboxRevealOptions {
  pairs?: readonly RevealPair[];
  /**
   * Belt-and-braces for the rails. Does NOT fix clipping (see the header note)
   * but does reveal a group slightly before it scrolls in.
   */
  rootMargin?: string;
}

export function createDropboxReveals(options: DropboxRevealOptions = {}) {
  const { pairs = DROPBOX_REVEAL_PAIRS, rootMargin = '0px 200% 0px 200%' } = options;

  return function initDropboxReveals(root: ParentNode = document): Teardown | void {
    /** trigger element -> the targets revealed when it intersects. */
    const buckets = new Map<Element, Array<{ el: HTMLElement; visible: string }>>();

    for (const pair of pairs) {
      for (const el of $all(pair.base, root)) {
        // `?? el` is the drift fallback: if the rail's hashed class has
        // rotated, observe the card itself rather than reveal nothing.
        const trigger = (pair.groupSelector ? el.closest(pair.groupSelector) : null) ?? el;
        const bucket = buckets.get(trigger);
        if (bucket) bucket.push({ el, visible: pair.visible });
        else buckets.set(trigger, [{ el, visible: pair.visible }]);
      }
    }

    if (buckets.size === 0) return;

    const revealAll = (trigger: Element) => {
      for (const { el, visible } of buckets.get(trigger) ?? []) el.classList.add(visible);
    };

    // The site ships `@media (prefers-reduced-motion: reduce)` rules that reset
    // these blocks to visible, so reveal everything at once to match.
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      for (const trigger of buckets.keys()) revealAll(trigger);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          revealAll(entry.target);
          // One-shot: index.scrolled.html still carries these classes after
          // the capture scrolled back to y=0, so the site never re-hides them.
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0, rootMargin },
    );

    for (const trigger of buckets.keys()) observer.observe(trigger);

    return () => observer.disconnect();
  };
}

export const initDropboxReveals = createDropboxReveals();
