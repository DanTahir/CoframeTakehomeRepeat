/**
 * Scroll-reveal classes for dropbox.com (site-specific).
 *
 * `scrape/analysis/scroll-reveals.json` flags exactly three class pairs on
 * this page whose *base* rule hides the element (`opacity:0` / translated /
 * `visibility:hidden`) and whose visible twin is added by the original page's
 * JavaScript as the element scrolls in. Codegen captures the pre-scroll DOM,
 * so all three arrive hidden: without this effect the customer-quote cards and
 * the feature-plank media containers stay permanently blank.
 *
 * Reproduced pairs (base selector -> class the site's CSS uses for the
 * finished state):
 *   .dwg-multi-block-card-entry-animation -> ...--is-visible   (9 elements)
 *   ._card_1b963_1._cardEntryAnimation_1b963_1 -> _cardShow_1b963_8  (3)
 *   ._mediaContainer_thadj_29 -> _mediaContainerVisible_thadj_62     (1)
 *
 * No JS stagger is needed: the captured markup already carries the inline
 * `--dwg-iteration-index` custom property (12 elements) that the site's CSS
 * turns into a per-card `animation-delay`.
 */
import { $all, prefersReducedMotion, type Teardown } from './runtime';

export interface RevealPair {
  /** Elements that start hidden. */
  selector: string;
  /** Class the captured CSS uses for the revealed state. */
  visibleClass: string;
  /** Overrides the default intersection margin for this pair. */
  rootMargin?: string;
  /**
   * Observe this ancestor instead of each element, revealing every match
   * inside it at once. Required when an ancestor CLIPS the elements — see
   * `QUOTE_RAIL` below. Falls back to per-element observation when the
   * ancestor is absent.
   */
  groupSelector?: string;
}

/**
 * Widened horizontal margin for cards laid out in a row wider than the window.
 *
 * An IntersectionObserver intersects in BOTH axes, so a card sitting entirely
 * to the right of the window never intersects and stays at `opacity: 0`
 * forever. Expanding the root rect horizontally (top/bottom stay 0) makes the
 * reveal depend on vertical entry only, which is how the live site behaves.
 * This is sufficient ONLY when nothing clips the cards.
 */
const RAIL_MARGIN = '0px 9999px';

/**
 * The quote-card rail CLIPS its own cards, so no root margin can reach them.
 *
 * `._scrollArea_bb0ya_5` is `overflow-x: scroll` and ~1169px wide holding a
 * ~2304px grid; at 1280px its three cards sit at x=168, x=912 and x=1656.
 * IntersectionObserver computes intersection *through* an overflow-clipping
 * ancestor, while `rootMargin` inflates only the ROOT rect — so a card parked
 * outside the clip window never intersects at any margin. That was measured,
 * not assumed: widening the margin alone left the third card hidden at all 7
 * viewports. Observing the rail and revealing the whole group fixes it, and
 * matches live, which hides none of these at ipad-mini/ipad-pro/laptop/
 * desktop-wide (see `scrape/viewport-report.json`).
 */
const QUOTE_RAIL = '._scrollArea_bb0ya_5';

/**
 * Group triggers are observed at ratio 0, never the default threshold.
 *
 * A container far wider than the viewport may never reach a fractional ratio
 * at all: this rail measures 2452px against a 375px phone, peaking near 0.15.
 * Any non-zero threshold can therefore never fire and the group stays hidden.
 */
const GROUP_THRESHOLD = 0;

/** The three gating pairs this capture actually contains. */
export const DROPBOX_REVEAL_PAIRS: readonly RevealPair[] = [
  {
    selector: '.dwg-multi-block-card-entry-animation',
    visibleClass: 'dwg-multi-block-card-entry-animation--is-visible',
    rootMargin: RAIL_MARGIN,
  },
  {
    selector: '._card_1b963_1._cardEntryAnimation_1b963_1',
    visibleClass: '_cardShow_1b963_8',
    rootMargin: RAIL_MARGIN,
    groupSelector: QUOTE_RAIL,
  },
  {
    selector: '._mediaContainer_thadj_29',
    visibleClass: '_mediaContainerVisible_thadj_62',
  },
];

export interface DropboxRevealsOptions {
  pairs?: readonly RevealPair[];
  threshold?: number;
  rootMargin?: string;
}

interface Target {
  el: HTMLElement;
  visibleClass: string;
}

export function createDropboxReveals(options: DropboxRevealsOptions = {}) {
  const {
    pairs = DROPBOX_REVEAL_PAIRS,
    threshold = 0.1,
    rootMargin = '0px 0px -5% 0px',
  } = options;

  return function initDropboxReveals(root: ParentNode = document): Teardown | void {
    // What gets OBSERVED (a card, or the rail that clips it) mapped to what
    // gets REVEALED when it intersects.
    const triggers = new Map<
      HTMLElement,
      { margin: string; threshold: number; targets: Target[] }
    >();
    let total = 0;

    for (const pair of pairs) {
      const margin = pair.rootMargin ?? rootMargin;
      for (const el of $all<HTMLElement>(pair.selector, root)) {
        // Fall back to the element itself when the group ancestor is absent,
        // so a rotated hash degrades to per-element reveal instead of silence.
        const group = pair.groupSelector
          ? el.closest<HTMLElement>(pair.groupSelector)
          : null;
        const trigger = group ?? el;
        const entry = triggers.get(trigger) ?? {
          margin,
          // Only a real group container needs the ratio-0 treatment.
          threshold: group ? GROUP_THRESHOLD : threshold,
          targets: [],
        };
        entry.targets.push({ el, visibleClass: pair.visibleClass });
        triggers.set(trigger, entry);
        total += 1;
      }
    }
    if (!total) return;

    const revealAll = (targets: Target[]) => {
      for (const { el, visibleClass } of targets) el.classList.add(visibleClass);
    };

    // Reduced motion, or no observer support: reveal immediately. Leaving the
    // content hidden would be far worse than skipping the animation.
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      for (const { targets } of triggers.values()) revealAll(targets);
      return;
    }

    // IntersectionObserver options are per-observer, so triggers are bucketed
    // by the (margin, threshold) pair they need.
    const buckets = new Map<string, Array<[HTMLElement, Target[]]>>();
    const optionsFor = new Map<string, { margin: string; threshold: number }>();
    for (const [trigger, { margin, threshold: thr, targets }] of triggers) {
      const key = `${margin}|${thr}`;
      optionsFor.set(key, { margin, threshold: thr });
      buckets.set(key, [...(buckets.get(key) ?? []), [trigger, targets]]);
    }

    const observers: IntersectionObserver[] = [];

    for (const [key, entries] of buckets) {
      const { margin, threshold: thr } = optionsFor.get(key)!;
      const targetsFor = new WeakMap<Element, Target[]>();
      for (const [trigger, targets] of entries) targetsFor.set(trigger, targets);

      const observer = new IntersectionObserver(
        (records) => {
          for (const record of records) {
            if (!record.isIntersecting) continue;
            const targets = targetsFor.get(record.target);
            if (targets) revealAll(targets);
            // One-shot, matching the original: these cards never re-hide.
            observer.unobserve(record.target);
          }
        },
        { threshold: thr, rootMargin: margin },
      );

      for (const [trigger] of entries) observer.observe(trigger);
      observers.push(observer);
    }

    return () => {
      for (const observer of observers) observer.disconnect();
    };
  };
}

export const initDropboxReveals = createDropboxReveals();
