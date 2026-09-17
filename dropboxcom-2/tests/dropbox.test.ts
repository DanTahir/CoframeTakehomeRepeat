/**
 * Behavioural + drift tests for the dropbox.com-specific effect modules.
 *
 * Two kinds of test live here, and the second kind matters as much as the first:
 *
 *  1. BEHAVIOUR — the reveal/nav/video logic, driven through the jsdom
 *     IntersectionObserver mock in tests/setup.ts.
 *  2. DRIFT — the selectors these modules depend on are *capture-bound*.
 *     Dropbox's hashed CSS-module names (`_card_1b963_1`, `_scrollArea_bb0ya_5`,
 *     `_cardShow_1b963_8`) rotate whenever they rebuild, and a rotated hash
 *     would silently blank whole sections instead of erroring. So every pair is
 *     asserted against the *generated markup*, and the modules are asserted to
 *     be actually registered in ClientRuntime — a perfectly correct but
 *     unregistered effect is exactly how this ships broken.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { observedElementCount, observerOptionsFor, resetObservers, triggerIntersection } from './setup';
import {
  DROPBOX_REVEAL_PAIRS,
  createDropboxReveals,
  initDropboxReveals,
} from '../app/lib/dropboxReveals';
import { initDropboxNav } from '../app/lib/dropboxNav';
import { initDropboxVideos } from '../app/lib/dropboxVideos';

const root = resolve(__dirname, '..');
const generatedDir = join(root, 'app', 'generated');

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  resetObservers();
});

/* ------------------------------------------------------------------ reveals */

/** The real shape: a clipped rail whose third card sits outside the window. */
const railMarkup = `
  <div class="_scrollArea_bb0ya_5 _grabbable_bb0ya_17" id="rail">
    <div class="_quoteCardsGrid_thadj_158">
      <div class="_card_1b963_1 _cardEntryAnimation_1b963_1" id="c0"></div>
      <div class="_card_1b963_1 _cardEntryAnimation_1b963_1" id="c1"></div>
      <div class="_card_1b963_1 _cardEntryAnimation_1b963_1" id="c2"></div>
    </div>
  </div>`;

describe('dropboxReveals', () => {
  it('reveals nothing before the trigger intersects', () => {
    document.body.innerHTML = railMarkup;
    initDropboxReveals(document);
    for (const id of ['c0', 'c1', 'c2']) {
      expect(document.getElementById(id)!.classList.contains('_cardShow_1b963_8')).toBe(false);
    }
  });

  it('reveals EVERY member of a clipped rail, including the off-window card', () => {
    // The bug this guards: IntersectionObserver intersection is clipped by an
    // overflow ancestor while rootMargin inflates only the root rect, so the
    // third card can never intersect on its own and stayed invisible at all 7
    // viewports. The container is the trigger precisely to avoid that.
    document.body.innerHTML = railMarkup;
    initDropboxReveals(document);

    triggerIntersection(document.getElementById('rail')!);

    for (const id of ['c0', 'c1', 'c2']) {
      expect(
        document.getElementById(id)!.classList.contains('_cardShow_1b963_8'),
        `card ${id} was not revealed`,
      ).toBe(true);
    }
  });

  it('observes the rail itself, not the individual cards', () => {
    document.body.innerHTML = railMarkup;
    initDropboxReveals(document);
    expect(observerOptionsFor(document.getElementById('rail')!).length).toBe(1);
    expect(observerOptionsFor(document.getElementById('c2')!).length).toBe(0);
  });

  it('observes at threshold 0, since a rail wider than the viewport never reaches a ratio', () => {
    // A ~2.4k px rail peaks near 0.15 on a 375px phone, so any fractional
    // threshold would never fire. This assertion pins that reasoning.
    document.body.innerHTML = railMarkup;
    initDropboxReveals(document);
    const [options] = observerOptionsFor(document.getElementById('rail')!);
    expect(options.thresholds).toEqual([0]);
  });

  it('falls back to per-card observation when the rail class has rotated', () => {
    // Drift insurance: if `_scrollArea_bb0ya_5` changes, reveal must degrade to
    // observing each card rather than silently revealing nothing.
    document.body.innerHTML = `
      <div class="_scrollArea_ROTATED">
        <div class="_card_1b963_1 _cardEntryAnimation_1b963_1" id="c0"></div>
      </div>`;
    initDropboxReveals(document);

    const card = document.getElementById('c0')!;
    expect(observerOptionsFor(card).length).toBe(1);
    triggerIntersection(card);
    expect(card.classList.contains('_cardShow_1b963_8')).toBe(true);
  });

  it('is one-shot: stops observing once revealed', () => {
    // index.scrolled.html still carries these classes after the capture
    // scrolled back to y=0, so the live reveal never re-hides.
    document.body.innerHTML = railMarkup;
    initDropboxReveals(document);
    expect(observedElementCount()).toBe(1);

    triggerIntersection(document.getElementById('rail')!);
    expect(observedElementCount()).toBe(0);
  });

  it('reveals the multi-block cards individually (no group ancestor)', () => {
    document.body.innerHTML = `
      <div class="dwg-multi-block-card-entry-animation" id="m0"></div>
      <div class="dwg-multi-block-card-entry-animation" id="m1"></div>`;
    initDropboxReveals(document);

    const m0 = document.getElementById('m0')!;
    triggerIntersection(m0);
    expect(m0.classList.contains('dwg-multi-block-card-entry-animation--is-visible')).toBe(true);
    // Independently observed, so the second stays hidden until it scrolls in.
    expect(
      document
        .getElementById('m1')!
        .classList.contains('dwg-multi-block-card-entry-animation--is-visible'),
    ).toBe(false);
  });

  it('reveals everything immediately under prefers-reduced-motion', () => {
    // The site ships @media (prefers-reduced-motion: reduce) rules that reset
    // these blocks to visible, so matching means revealing without observing.
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    try {
      document.body.innerHTML = railMarkup;
      initDropboxReveals(document);
      expect(document.getElementById('c2')!.classList.contains('_cardShow_1b963_8')).toBe(true);
      expect(observedElementCount()).toBe(0);
    } finally {
      window.matchMedia = original;
    }
  });

  it('no-ops without targets', () => {
    expect(() => initDropboxReveals(document)).not.toThrow();
    expect(initDropboxReveals(document)).toBeUndefined();
  });

  it('disconnects on teardown', () => {
    document.body.innerHTML = railMarkup;
    const teardown = createDropboxReveals()(document);
    expect(observedElementCount()).toBe(1);
    if (typeof teardown === 'function') teardown();
    expect(observedElementCount()).toBe(0);
  });
});

/* ---------------------------------------------------------------------- nav */

const navMarkup = `
  <div class="dwg-nav dwg-nav--sticky dwg-nav--universal" id="nav">
    <div class="dwg-nav__overlay" id="overlay"></div>
    <div class="dwg-nav__dropdown-background" id="backdrop" style="height:0px"></div>
    <button id="t0" class="dwg-nav-item-button" aria-haspopup="true"
            aria-controls="p0" aria-expanded="false">Products</button>
    <div class="dwg-nav-item__dropdown" id="p0" role="menu"></div>
    <button id="t1" class="dwg-nav-item-button" aria-haspopup="true"
            aria-controls="p1" aria-expanded="false">Solutions</button>
    <div class="dwg-nav-item__dropdown" id="p1" role="menu"></div>
    <button id="burger" class="dwg-nav__hamburger-button"></button>
    <div class="dwg-nav-mobile-dropdown" id="mobile"></div>
  </div>`;

/** jsdom has no layout, so panel height has to be stubbed to a real number. */
function stubScrollHeight(id: string, value: number) {
  Object.defineProperty(document.getElementById(id)!, 'scrollHeight', {
    value,
    configurable: true,
  });
}

describe('dropboxNav', () => {
  it('opens a dropdown and sets BOTH runtime-only height variables', () => {
    // Neither variable is defined in any of the 122 captured stylesheets — the
    // site writes them inline. Unset, an "open" dropdown has max-height 0.
    document.body.innerHTML = navMarkup;
    stubScrollHeight('p0', 240);
    initDropboxNav(document);

    document.getElementById('t0')!.click();

    const panel = document.getElementById('p0')!;
    expect(panel.classList.contains('dwg-nav-item__dropdown--open')).toBe(true);
    expect(panel.style.getPropertyValue('--dwg-nav-item__dropdown-max-height')).toBe('240px');
    expect(panel.style.getPropertyValue('--dwg-nav-current-dropdown-height')).toBe('240px');
    expect(document.getElementById('t0')!.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('nav')!.classList.contains('dwg-nav--dropdown-opened')).toBe(true);
  });

  it('drives the dropdown background, which is what gives a desktop panel its surface', () => {
    document.body.innerHTML = navMarkup;
    stubScrollHeight('p0', 300);
    initDropboxNav(document);

    document.getElementById('t0')!.click();
    const backdrop = document.getElementById('backdrop')!;
    expect(backdrop.classList.contains('dwg-nav__dropdown-background--open')).toBe(true);
    expect(backdrop.style.height).toBe('300px');
  });

  it('closes an open dropdown when its trigger is clicked again', () => {
    document.body.innerHTML = navMarkup;
    stubScrollHeight('p0', 240);
    initDropboxNav(document);

    const trigger = document.getElementById('t0')!;
    trigger.click();
    trigger.click();

    const panel = document.getElementById('p0')!;
    expect(panel.classList.contains('dwg-nav-item__dropdown--open')).toBe(false);
    expect(panel.style.getPropertyValue('--dwg-nav-current-dropdown-height')).toBe('');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('only ever has one dropdown open', () => {
    document.body.innerHTML = navMarkup;
    stubScrollHeight('p0', 240);
    stubScrollHeight('p1', 260);
    initDropboxNav(document);

    document.getElementById('t0')!.click();
    document.getElementById('t1')!.click();

    expect(document.getElementById('p0')!.classList.contains('dwg-nav-item__dropdown--open')).toBe(false);
    expect(document.getElementById('p1')!.classList.contains('dwg-nav-item__dropdown--open')).toBe(true);
  });

  it('closes on Escape and on a click outside the nav', () => {
    document.body.innerHTML = `${navMarkup}<main id="outside">content</main>`;
    stubScrollHeight('p0', 240);
    initDropboxNav(document);

    document.getElementById('t0')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('p0')!.classList.contains('dwg-nav-item__dropdown--open')).toBe(false);

    document.getElementById('t0')!.click();
    document.getElementById('outside')!.click();
    expect(document.getElementById('p0')!.classList.contains('dwg-nav-item__dropdown--open')).toBe(false);
  });

  it('toggles the mobile sheet, the burger glyph and the body scroll lock', () => {
    document.body.innerHTML = navMarkup;
    initDropboxNav(document);

    const burger = document.getElementById('burger')!;
    burger.click();

    expect(document.getElementById('mobile')!.classList.contains('dwg-nav-mobile-dropdown--open')).toBe(true);
    expect(burger.classList.contains('dwg-nav__hamburger-button--open')).toBe(true);
    expect(burger.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('overlay')!.classList.contains('dwg-nav__overlay--open')).toBe(true);
    expect(document.body.classList.contains('body--dwg-nav-mobile-dropdown-open--universal')).toBe(true);

    burger.click();
    expect(document.getElementById('mobile')!.classList.contains('dwg-nav-mobile-dropdown--open')).toBe(false);
    expect(document.body.classList.contains('body--dwg-nav-mobile-dropdown-open--universal')).toBe(false);
  });

  it('releases the body scroll lock on teardown', () => {
    document.body.innerHTML = navMarkup;
    const teardown = initDropboxNav(document);
    document.getElementById('burger')!.click();
    expect(document.body.classList.contains('body--dwg-nav-mobile-dropdown-open--universal')).toBe(true);

    if (typeof teardown === 'function') teardown();
    expect(document.body.classList.contains('body--dwg-nav-mobile-dropdown-open--universal')).toBe(false);
  });

  it('no-ops without a nav', () => {
    expect(initDropboxNav(document)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------- videos */

describe('dropboxVideos', () => {
  it('sets muted/playsInline as DOM PROPERTIES and calls play', () => {
    // A JSX `muted` attribute alone does not permit autoplay: the browser
    // reads the property. This is the whole reason the module exists.
    const play = vi.fn(() => Promise.resolve());
    (HTMLMediaElement.prototype as unknown as { play: () => Promise<void> }).play = play;

    document.body.innerHTML = `
      <video id="v" autoplay loop muted playsinline>
        <source src="/assets/video/hero.webm" type="video/webm; codecs=vp9" />
      </video>`;

    initDropboxVideos(document);

    const video = document.getElementById('v') as HTMLVideoElement;
    expect(video.muted).toBe(true);
    expect(video.defaultMuted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(play).toHaveBeenCalled();
  });

  it('retries play when the element becomes decodable', () => {
    const play = vi.fn(() => Promise.resolve());
    (HTMLMediaElement.prototype as unknown as { play: () => Promise<void> }).play = play;

    document.body.innerHTML = '<video id="v" autoplay loop muted></video>';
    initDropboxVideos(document);
    const callsAfterInit = play.mock.calls.length;

    document.getElementById('v')!.dispatchEvent(new Event('canplay'));
    expect(play.mock.calls.length).toBeGreaterThan(callsAfterInit);
  });

  it('leaves a non-autoplay video alone', () => {
    const play = vi.fn(() => Promise.resolve());
    (HTMLMediaElement.prototype as unknown as { play: () => Promise<void> }).play = play;

    document.body.innerHTML = '<video id="v" controls></video>';
    expect(initDropboxVideos(document)).toBeUndefined();
    expect(play).not.toHaveBeenCalled();
  });

  it('survives a play() that throws synchronously', () => {
    (HTMLMediaElement.prototype as unknown as { play: () => Promise<void> }).play = () => {
      throw new Error('not implemented');
    };
    document.body.innerHTML = '<video id="v" autoplay muted></video>';
    expect(() => initDropboxVideos(document)).not.toThrow();
  });
});

/* -------------------------------------------------- drift vs. real artifacts */

/** Every `className="..."` token list in the generated components. */
function generatedClassLists(): string[][] {
  if (!existsSync(generatedDir)) return [];
  const lists: string[][] = [];
  for (const file of readdirSync(generatedDir).filter((f) => f.endsWith('.tsx'))) {
    const text = readFileSync(join(generatedDir, file), 'utf8');
    for (const match of text.matchAll(/className="([^"]+)"/g)) {
      lists.push(match[1].trim().split(/\s+/));
    }
  }
  return lists;
}

/** How many generated elements carry every class token of a class selector. */
function countMatchingElements(selector: string): number {
  const tokens = selector.split('.').filter(Boolean);
  return generatedClassLists().filter((list) => tokens.every((t) => list.includes(t))).length;
}

const hasGenerated = existsSync(join(generatedDir, 'manifest.json'));

describe.skipIf(!hasGenerated)('reveal pairs still match the captured markup', () => {
  // Measured in THIS run's capture. These counts are deliberately exact: if
  // Dropbox rebuilds and a hash rotates, or a section's card count changes,
  // this fails loudly instead of the page shipping blocks stuck at opacity 0.
  const expectedCarriers: Record<string, number> = {
    '.dwg-multi-block-card-entry-animation': 9,
    '._card_1b963_1._cardEntryAnimation_1b963_1': 3,
    '._mediaContainer_thadj_29': 1,
  };

  it('covers exactly the pairs the analyzer flagged as gating visibility', () => {
    expect(DROPBOX_REVEAL_PAIRS.map((p) => p.base).sort()).toEqual(
      Object.keys(expectedCarriers).sort(),
    );
  });

  it.each(DROPBOX_REVEAL_PAIRS.map((p) => [p.base, p] as const))(
    'base selector %s still matches its captured carriers',
    (base, pair) => {
      expect(
        countMatchingElements(base),
        `hash rotation? "${base}" no longer matches the generated markup`,
      ).toBe(expectedCarriers[base]);

      // If the visible class were already baked in, the reveal would ship
      // already-finished rather than animating.
      expect(countMatchingElements(`.${pair.visible}`)).toBe(0);
    },
  );

  it('still finds the clipped rail that groups the quote cards', () => {
    const pair = DROPBOX_REVEAL_PAIRS.find((p) => p.groupSelector);
    expect(pair, 'the rail pair lost its groupSelector').toBeDefined();
    expect(
      countMatchingElements(pair!.groupSelector!),
      `hash rotation? rail "${pair!.groupSelector}" is not in the generated markup`,
    ).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasGenerated)('nav + video selectors still match the captured markup', () => {
  it('finds the 6 dropdown triggers, their panels and the burger', () => {
    const tsx = readFileSync(join(generatedDir, 'RootSection.tsx'), 'utf8');
    expect([...tsx.matchAll(/aria-haspopup="true"/g)].length).toBe(6);
    expect([...tsx.matchAll(/aria-controls="nav-item-/g)].length).toBe(6);
    expect(countMatchingElements('.dwg-nav-item__dropdown')).toBe(6);
    expect(countMatchingElements('.dwg-nav__hamburger-button')).toBe(1);
    expect(countMatchingElements('.dwg-nav-mobile-dropdown')).toBe(1);
    expect(countMatchingElements('.dwg-nav--universal')).toBe(1);
  });

  it('finds 4 autoplaying videos, every source self-hosted', () => {
    const tsx = readFileSync(join(generatedDir, 'RootSection.tsx'), 'utf8');
    expect([...tsx.matchAll(/<video\b/g)].length).toBe(4);
    expect([...tsx.matchAll(/autoPlay/g)].length).toBe(4);
    for (const match of tsx.matchAll(/type="video\/webm[^"]*"/g)) {
      expect(match[0]).toBeTruthy();
    }
    // Every non-empty video source must be a local /assets path.
    for (const match of tsx.matchAll(/src="([^"]*)"\s*\n?\s*type="video\//g)) {
      if (match[1]) expect(match[1].startsWith('/assets/')).toBe(true);
    }
  });
});

describe('every hand-written effect is actually registered', () => {
  // A correct-but-unregistered effect is exactly how a replica ships broken,
  // so the wiring is asserted, not assumed.
  const clientRuntime = readFileSync(join(root, 'app', 'ClientRuntime.tsx'), 'utf8');

  it.each(['dropboxReveals', 'dropboxNav', 'dropboxVideos', 'smoothAnchors'])(
    'registers %s',
    (name) => {
      expect(clientRuntime).toMatch(new RegExp(`name:\\s*'${name}'`));
    },
  );

  it('does NOT register the two generic effects that would fight this site', () => {
    // navToggle applies classes this site's CSS does not define; marquee would
    // clone an already-duplicated, already-CSS-animated ticker.
    expect(clientRuntime).not.toMatch(/name:\s*'navToggle'/);
    expect(clientRuntime).not.toMatch(/name:\s*'marquee'/);
  });
});
