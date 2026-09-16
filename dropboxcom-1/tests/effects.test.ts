/**
 * Unit tests for the effect modules.
 *
 * These are the replica's real behavioural guarantees: the captured markup is
 * inert, so if an effect stops re-applying its class the page silently ships
 * frozen mid-animation (usually invisible). Each test asserts the effect both
 * applies its state AND cleans up.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  observedElementCount,
  observerOptionsFor,
  resetObservers,
  triggerIntersection,
} from './setup';
import { createFadeIn } from '../app/lib/fadeIn';
import { createNavToggle, createNavScroll, initSmoothAnchors } from '../app/lib/nav';
import {
  createAccordion,
  createCounters,
  createLazyImages,
  createMarquee,
  createTabs,
} from '../app/lib/reveal';
import { createForms } from '../app/lib/forms';
import { createDropboxNav } from '../app/lib/dropboxNav';
import { createDropboxReveals, DROPBOX_REVEAL_PAIRS } from '../app/lib/dropboxReveals';
import { createDropboxVideos } from '../app/lib/dropboxVideos';
import { initEffects } from '../app/lib/runtime';

beforeEach(() => {
  document.body.innerHTML = '';
  resetObservers();
});

afterEach(() => {
  document.body.className = '';
});

describe('fadeIn', () => {
  it('adds the active class only once the element intersects', () => {
    document.body.innerHTML = '<div class="fade-in" id="a">hi</div>';
    const el = document.getElementById('a')!;

    const teardown = createFadeIn()(document);

    // Pre-intersection it must stay in its captured (hidden) state.
    expect(el.classList.contains('faded-in')).toBe(false);

    triggerIntersection(el);
    expect(el.classList.contains('faded-in')).toBe(true);

    if (typeof teardown === 'function') teardown();
  });

  it('honours a custom active class', () => {
    document.body.innerHTML = '<div class="fade-in" id="a"></div>';
    const el = document.getElementById('a')!;
    createFadeIn({ activeClass: 'is-visible' })(document);
    triggerIntersection(el);
    expect(el.classList.contains('is-visible')).toBe(true);
    expect(el.classList.contains('faded-in')).toBe(false);
  });

  it('stops observing after teardown', () => {
    document.body.innerHTML = '<div class="fade-in"></div><div class="fade-in"></div>';
    const teardown = createFadeIn()(document);
    expect(observedElementCount()).toBe(2);
    if (typeof teardown === 'function') teardown();
    expect(observedElementCount()).toBe(0);
  });

  it('no-ops without targets', () => {
    expect(() => createFadeIn()(document)).not.toThrow();
  });
});

describe('navToggle', () => {
  const markup = `
    <nav>
      <div class="w-nav-button" id="burger"></div>
      <div class="w-nav-menu" id="menu"></div>
    </nav>`;

  it('toggles open state and aria-expanded', () => {
    document.body.innerHTML = markup;
    const burger = document.getElementById('burger')!;
    const menu = document.getElementById('menu')!;

    createNavToggle()(document);
    expect(burger.getAttribute('aria-expanded')).toBe('false');

    burger.click();
    expect(menu.classList.contains('is-open')).toBe(true);
    expect(burger.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.classList.contains('nav-open')).toBe(true);

    burger.click();
    expect(menu.classList.contains('is-open')).toBe(false);
    expect(document.body.classList.contains('nav-open')).toBe(false);
  });

  it('closes on Escape', () => {
    document.body.innerHTML = markup;
    const burger = document.getElementById('burger')!;
    const menu = document.getElementById('menu')!;
    createNavToggle()(document);

    burger.click();
    expect(menu.classList.contains('is-open')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu.classList.contains('is-open')).toBe(false);
  });

  it('removes the body class on teardown', () => {
    document.body.innerHTML = markup;
    const burger = document.getElementById('burger')!;
    const teardown = createNavToggle()(document);
    burger.click();
    expect(document.body.classList.contains('nav-open')).toBe(true);
    if (typeof teardown === 'function') teardown();
    expect(document.body.classList.contains('nav-open')).toBe(false);
  });
});

describe('navScroll', () => {
  it('applies the scrolled class past the offset', () => {
    document.body.innerHTML = '<header id="h"></header>';
    const header = document.getElementById('h')!;
    createNavScroll({ offset: 10 })(document);

    expect(header.classList.contains('is-scrolled')).toBe(false);

    Object.defineProperty(window, 'scrollY', { value: 50, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    expect(header.classList.contains('is-scrolled')).toBe(true);

    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    expect(header.classList.contains('is-scrolled')).toBe(false);
  });
});

describe('tabs', () => {
  it('activates the clicked tab and its pane', () => {
    document.body.innerHTML = `
      <div class="w-tab-link" id="t0"></div>
      <div class="w-tab-link" id="t1"></div>
      <div class="w-tab-pane" id="p0"></div>
      <div class="w-tab-pane" id="p1"></div>`;
    createTabs()(document);

    // Falls back to the first tab when the capture had none marked current.
    expect(document.getElementById('t0')!.classList.contains('w--current')).toBe(true);

    document.getElementById('t1')!.click();
    expect(document.getElementById('t1')!.classList.contains('w--current')).toBe(true);
    expect(document.getElementById('p1')!.classList.contains('w--tab-active')).toBe(true);
    expect(document.getElementById('t0')!.classList.contains('w--current')).toBe(false);
  });

  it('does not hijack a single-tab page', () => {
    document.body.innerHTML = '<div class="w-tab-link"></div><div class="w-tab-pane"></div>';
    expect(createTabs()(document)).toBeUndefined();
  });
});

describe('accordion', () => {
  it('opens one item at a time', () => {
    document.body.innerHTML = `
      <div class="faq-item" id="i0"><button></button><div class="accordion-content"></div></div>
      <div class="faq-item" id="i1"><button></button><div class="accordion-content"></div></div>`;
    createAccordion()(document);

    const i0 = document.getElementById('i0')!;
    const i1 = document.getElementById('i1')!;

    i0.querySelector('button')!.click();
    expect(i0.classList.contains('is-open')).toBe(true);

    i1.querySelector('button')!.click();
    expect(i1.classList.contains('is-open')).toBe(true);
    expect(i0.classList.contains('is-open')).toBe(false);
  });
});

describe('counters', () => {
  it('counts to the target value on intersection', () => {
    document.body.innerHTML = '<span data-count-to="1200" id="c">0</span>';
    const el = document.getElementById('c')!;
    createCounters({ durationMs: 0 })(document);

    triggerIntersection(el);
    // rAF is synchronous in setup.ts, so the animation completes immediately.
    expect(el.textContent).toBe((1200).toLocaleString());
  });

  it('strips formatting when reading the target from text', () => {
    document.body.innerHTML = '<span data-counter id="c">1,500+</span>';
    const el = document.getElementById('c')!;
    createCounters({ durationMs: 0, attribute: 'data-nonexistent' })(document);
    triggerIntersection(el);
    expect(el.textContent).toBe((1500).toLocaleString());
  });
});

describe('marquee', () => {
  it('clones children once and restores on teardown', () => {
    document.body.innerHTML = `
      <div class="marquee"><div class="track"><span>a</span><span>b</span></div></div>`;
    const track = document.querySelector('.track')!;

    const teardown = createMarquee()(document);
    expect(track.children.length).toBe(4);

    // Idempotency: a second init (React strict mode) must not clone again.
    createMarquee()(document);
    expect(track.children.length).toBe(4);

    if (typeof teardown === 'function') teardown();
    expect(track.children.length).toBe(2);
  });

  it('marks clones aria-hidden so screen readers do not repeat them', () => {
    document.body.innerHTML =
      '<div class="marquee"><div class="track"><span>a</span></div></div>';
    createMarquee()(document);
    const clone = document.querySelector('[data-marquee-clone="true"]')!;
    expect(clone.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('lazyImages', () => {
  it('promotes data-src to src on intersection', () => {
    document.body.innerHTML = '<img id="i" data-src="/assets/img/hero.png" alt="" />';
    const img = document.getElementById('i') as HTMLImageElement;
    createLazyImages()(document);

    triggerIntersection(img);
    expect(img.getAttribute('src')).toBe('/assets/img/hero.png');
    expect(img.classList.contains('is-loaded')).toBe(true);
  });
});

describe('forms', () => {
  it('intercepts submit, never navigating, and shows the done block', async () => {
    document.body.innerHTML = `
      <div>
        <form id="f"><input name="email" value="a@b.co" /><button type="submit">Go</button></form>
        <div class="w-form-done" id="done" style="display:none"></div>
      </div>`;
    const form = document.getElementById('f') as HTMLFormElement;
    const done = document.getElementById('done')!;

    let captured: Record<string, string> | null = null;
    createForms({ latencyMs: 0, onSubmit: (data) => (captured = data) })(document);

    const event = new Event('submit', { cancelable: true, bubbles: true });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    await new Promise((r) => setTimeout(r, 5));
    expect(captured).toEqual({ email: 'a@b.co' });
    expect(done.style.display).toBe('block');
    expect(form.style.display).toBe('none');
  });
});

describe('smoothAnchors', () => {
  it('prevents default only for anchors with a real target', () => {
    document.body.innerHTML = `
      <a href="#sec" id="good">to section</a>
      <a href="#missing" id="bad">broken</a>
      <div id="sec"></div>`;
    // jsdom lacks scrollIntoView.
    Element.prototype.scrollIntoView = () => {};
    initSmoothAnchors(document);

    const good = new MouseEvent('click', { cancelable: true, bubbles: true });
    document.getElementById('good')!.dispatchEvent(good);
    expect(good.defaultPrevented).toBe(true);

    const bad = new MouseEvent('click', { cancelable: true, bubbles: true });
    document.getElementById('bad')!.dispatchEvent(bad);
    expect(bad.defaultPrevented).toBe(false);
  });

  // Regression guard. A Webflow tab link is `<a href="#pane" role="tab">`: the
  // href names a pane to reveal, not a place to scroll. Carousel autoplay
  // synthesises `tab.click()` on a timer, so if smooth-scroll binds to one the
  // page yanks itself back to that carousel every few seconds forever.
  it('ignores widget-control anchors like Webflow tab links', () => {
    document.body.innerHTML = `
      <a href="#pane-0" id="tab" class="w-tab-link" role="tab" aria-controls="pane-0">step</a>
      <a href="#sec" id="plain">to section</a>
      <div id="pane-0"></div>
      <div id="sec"></div>`;
    Element.prototype.scrollIntoView = () => {};
    initSmoothAnchors(document);

    const onTab = new MouseEvent('click', { cancelable: true, bubbles: true });
    document.getElementById('tab')!.dispatchEvent(onTab);
    expect(onTab.defaultPrevented).toBe(false);

    // A genuine navigation anchor must still get smooth scrolling.
    const onPlain = new MouseEvent('click', { cancelable: true, bubbles: true });
    document.getElementById('plain')!.dispatchEvent(onPlain);
    expect(onPlain.defaultPrevented).toBe(true);
  });
});

// --- site-specific effects for dropbox.com ----------------------------------

describe('dropboxReveals', () => {
  const markup = `
    <div class="dwg-multi-block-card-entry-animation" id="block"></div>
    <div class="_card_1b963_1 _cardEntryAnimation_1b963_1" id="card"></div>
    <div class="_mediaContainer_thadj_29" id="media"></div>`;

  it('adds each pair\'s own visible class on intersection', () => {
    document.body.innerHTML = markup;
    const block = document.getElementById('block')!;
    const card = document.getElementById('card')!;
    const media = document.getElementById('media')!;

    createDropboxReveals()(document);

    // The capture ships these hidden; they must stay hidden until seen.
    expect(block.className).not.toContain('--is-visible');
    expect(card.classList.contains('_cardShow_1b963_8')).toBe(false);
    expect(media.classList.contains('_mediaContainerVisible_thadj_62')).toBe(false);

    triggerIntersection(block);
    triggerIntersection(card);
    triggerIntersection(media);

    expect(
      block.classList.contains('dwg-multi-block-card-entry-animation--is-visible'),
    ).toBe(true);
    expect(card.classList.contains('_cardShow_1b963_8')).toBe(true);
    expect(media.classList.contains('_mediaContainerVisible_thadj_62')).toBe(true);
  });

  it('does not cross-apply a class to the wrong pair', () => {
    document.body.innerHTML = markup;
    const card = document.getElementById('card')!;
    createDropboxReveals()(document);
    triggerIntersection(card);
    expect(card.classList.contains('_mediaContainerVisible_thadj_62')).toBe(false);
    expect(card.className).not.toContain('--is-visible');
  });

  it('observes every gating pair and disconnects on teardown', () => {
    document.body.innerHTML = markup;
    const teardown = createDropboxReveals()(document);
    expect(observedElementCount()).toBe(DROPBOX_REVEAL_PAIRS.length);
    if (typeof teardown === 'function') teardown();
    expect(observedElementCount()).toBe(0);
  });

  it('no-ops without targets', () => {
    expect(() => createDropboxReveals()(document)).not.toThrow();
  });

  // Regression guard. Both card pairs sit inside `._scrollArea_bb0ya_5`, an
  // overflow-x:scroll rail wider than the window, so their outer members are
  // horizontally off-window. IntersectionObserver intersects in both axes, so
  // without a widened horizontal margin those cards never intersect and ship
  // permanently transparent — which is exactly what the viewport gate caught
  // at all 7 viewports while the live site hid none of them.
  it('widens the horizontal margin for the rail pairs', () => {
    const rail = DROPBOX_REVEAL_PAIRS.filter(
      (p) =>
        p.selector.includes('_cardEntryAnimation_1b963_1') ||
        p.selector.includes('dwg-multi-block-card-entry-animation'),
    );
    expect(rail).toHaveLength(2);
    for (const pair of rail) {
      expect(pair.rootMargin, `${pair.selector} must ignore horizontal position`).toContain(
        '9999px',
      );
      // Top/bottom must stay 0 so reveal still tracks vertical entry.
      expect(pair.rootMargin?.startsWith('0px')).toBe(true);
    }
  });

  // Regression guard for the real gate failure. `._scrollArea_bb0ya_5` is an
  // overflow-x:scroll rail ~1169px wide holding a ~2304px grid, so its outer
  // cards are clipped out of the window. An observer's intersection rect is
  // clipped by overflow ancestors as well as the root, so observing the CARDS
  // (even with a huge rootMargin) never fires for them — the rail itself must
  // be observed and all of its cards revealed together.
  it('reveals every card in a clipped rail when the rail enters view', () => {
    document.body.innerHTML = `
      <div class="_scrollArea_bb0ya_5 _grabbable_bb0ya_17" id="rail">
        <div class="_card_1b963_1 _cardEntryAnimation_1b963_1" id="c1"></div>
        <div class="_card_1b963_1 _cardEntryAnimation_1b963_1" id="c2"></div>
        <div class="_card_1b963_1 _cardEntryAnimation_1b963_1" id="c3"></div>
      </div>`;
    createDropboxReveals()(document);

    // Only the rail is watched, not the three cards.
    expect(observedElementCount()).toBe(1);

    // The rail must be observed at ratio 0: a container far wider than the
    // viewport (2452px vs a 375px phone) peaks near 0.15, so any fractional
    // threshold could never fire and the whole group would stay hidden.
    const opts = observerOptionsFor(document.getElementById('rail')!);
    expect(opts).toHaveLength(1);
    expect(opts[0].thresholds, 'rail must use threshold 0').toEqual([0]);
    expect(opts[0].rootMargin).toContain('9999px');

    triggerIntersection(document.getElementById('rail')!);
    for (const id of ['c1', 'c2', 'c3']) {
      expect(
        document.getElementById(id)!.classList.contains('_cardShow_1b963_8'),
        `${id} should be revealed with its rail`,
      ).toBe(true);
    }

    // One-shot: the rail is unobserved once it has fired.
    expect(observedElementCount()).toBe(0);
  });

  it('falls back to per-element reveal when the rail is absent', () => {
    document.body.innerHTML =
      '<div class="_card_1b963_1 _cardEntryAnimation_1b963_1" id="lone"></div>';
    const el = document.getElementById('lone')!;
    createDropboxReveals()(document);
    triggerIntersection(el);
    expect(el.classList.contains('_cardShow_1b963_8')).toBe(true);
  });

  it('still reveals a pair that opts out of the rail margin', () => {
    document.body.innerHTML = '<div class="_mediaContainer_thadj_29" id="m"></div>';
    const el = document.getElementById('m')!;
    createDropboxReveals()(document);
    triggerIntersection(el);
    expect(el.classList.contains('_mediaContainerVisible_thadj_62')).toBe(true);
  });
});

describe('dropboxNav', () => {
  const markup = `
    <div class="dwg-nav">
      <div id="host">
        <ul class="dwg-nav-menu dwg-nav-menu--horizontal">
          <li class="dwg-nav-item">
            <button id="t0" class="dwg-nav-item-button" aria-controls="p0"
                    aria-expanded="false" aria-haspopup="true"></button>
            <div id="p0" class="dwg-nav-item__dropdown dwg-nav-item--nav-redesign__dropdown"
                 role="menu"><span>one</span></div>
          </li>
          <li class="dwg-nav-item">
            <button id="t1" class="dwg-nav-item-button" aria-controls="p1"
                    aria-expanded="false" aria-haspopup="true"></button>
            <div id="p1" class="dwg-nav-item__dropdown" role="menu"><span>two</span></div>
          </li>
        </ul>
      </div>
      <button id="burger" class="dwg-nav__hamburger-button"></button>
      <div id="mobile" class="dwg-nav-mobile-dropdown"></div>
    </div>`;

  /** Mirrors the capture, which froze the variable inline at `0`. */
  function mount() {
    document.body.innerHTML = markup;
    document.getElementById('host')!.style.setProperty('--dwg-nav-current-dropdown-height', '0');
  }

  /** jsdom cannot measure, so accept the host or the panel fallback. */
  function heightVar() {
    const host = document.getElementById('host')!;
    const panel = document.getElementById('p0')!;
    return (
      host.style.getPropertyValue('--dwg-nav-current-dropdown-height') ||
      panel.style.getPropertyValue('--dwg-nav-current-dropdown-height')
    );
  }

  it('opens a dropdown with the real class and a non-zero height variable', () => {
    mount();
    const trigger = document.getElementById('t0')!;
    const panel = document.getElementById('p0')!;

    createDropboxNav()(document);
    expect(panel.classList.contains('dwg-nav-item__dropdown--open')).toBe(false);
    expect(heightVar()).toBe('0');

    trigger.click();
    expect(panel.classList.contains('dwg-nav-item__dropdown--open')).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // Zero would clamp the panel shut — the whole point of this module.
    expect(heightVar()).not.toBe('0');
    expect(heightVar()).not.toBe('');
  });

  it('toggles the same trigger shut and restores the captured variable', () => {
    mount();
    const trigger = document.getElementById('t0')!;
    const panel = document.getElementById('p0')!;
    createDropboxNav()(document);

    trigger.click();
    trigger.click();
    expect(panel.classList.contains('dwg-nav-item__dropdown--open')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(heightVar()).toBe('0');
  });

  it('keeps at most one dropdown open', () => {
    mount();
    createDropboxNav()(document);

    document.getElementById('t0')!.click();
    document.getElementById('t1')!.click();

    expect(document.getElementById('p0')!.classList.contains('dwg-nav-item__dropdown--open')).toBe(
      false,
    );
    expect(document.getElementById('p1')!.classList.contains('dwg-nav-item__dropdown--open')).toBe(
      true,
    );
    expect(document.getElementById('t0')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape and on an outside click', () => {
    mount();
    const panel = document.getElementById('p0')!;
    createDropboxNav()(document);

    document.getElementById('t0')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.classList.contains('dwg-nav-item__dropdown--open')).toBe(false);

    document.getElementById('t0')!.click();
    expect(panel.classList.contains('dwg-nav-item__dropdown--open')).toBe(true);
    document.body.click();
    expect(panel.classList.contains('dwg-nav-item__dropdown--open')).toBe(false);
  });

  it('leaves an open dropdown alone when clicking inside its panel', () => {
    mount();
    const panel = document.getElementById('p0')!;
    createDropboxNav()(document);

    document.getElementById('t0')!.click();
    panel.querySelector('span')!.click();
    expect(panel.classList.contains('dwg-nav-item__dropdown--open')).toBe(true);
  });

  it('toggles the mobile panel from the hamburger button', () => {
    mount();
    const burger = document.getElementById('burger')!;
    const mobile = document.getElementById('mobile')!;
    createDropboxNav()(document);

    burger.click();
    expect(mobile.classList.contains('dwg-nav-mobile-dropdown--open')).toBe(true);
    expect(burger.classList.contains('dwg-nav__hamburger-button--open')).toBe(true);
    expect(burger.getAttribute('aria-expanded')).toBe('true');

    burger.click();
    expect(mobile.classList.contains('dwg-nav-mobile-dropdown--open')).toBe(false);
    expect(burger.classList.contains('dwg-nav__hamburger-button--open')).toBe(false);
  });

  it('is idempotent under a double init (React strict mode)', () => {
    mount();
    const trigger = document.getElementById('t0')!;
    const panel = document.getElementById('p0')!;

    createDropboxNav()(document);
    createDropboxNav()(document);

    // A double-bound trigger would open then immediately close again.
    trigger.click();
    expect(panel.classList.contains('dwg-nav-item__dropdown--open')).toBe(true);
  });

  it('restores the captured state on teardown', () => {
    mount();
    const trigger = document.getElementById('t0')!;
    const panel = document.getElementById('p0')!;
    const teardown = createDropboxNav()(document);

    trigger.click();
    if (typeof teardown === 'function') teardown();

    expect(panel.classList.contains('dwg-nav-item__dropdown--open')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(heightVar()).toBe('0');

    // Listeners are gone: a click must no longer reopen the panel.
    trigger.click();
    expect(panel.classList.contains('dwg-nav-item__dropdown--open')).toBe(false);
  });

  it('no-ops without nav markup', () => {
    expect(() => createDropboxNav()(document)).not.toThrow();
  });
});

describe('dropboxVideos', () => {
  it('sets muted as a property, not just an attribute, and plays', () => {
    document.body.innerHTML =
      '<video id="v" class="dwg-media-video" autoplay loop muted playsinline></video>';
    const video = document.getElementById('v') as HTMLVideoElement;

    let plays = 0;
    // jsdom does not implement playback.
    HTMLMediaElement.prototype.play = function play() {
      plays += 1;
      return Promise.resolve();
    };

    const teardown = createDropboxVideos()(document);

    // The attribute alone leaves Chrome's autoplay policy unsatisfied.
    expect(video.muted).toBe(true);
    expect(video.defaultMuted).toBe(true);
    expect(plays).toBe(1);

    // Retried once the media reports it has data.
    video.dispatchEvent(new Event('canplay'));
    expect(plays).toBe(2);

    if (typeof teardown === 'function') teardown();
    video.dispatchEvent(new Event('canplay'));
    expect(plays).toBe(2);
  });

  it('swallows a rejected play() so autoplay blocking is not an unhandled rejection', () => {
    document.body.innerHTML = '<video id="v" class="dwg-media-video" autoplay></video>';
    HTMLMediaElement.prototype.play = function play() {
      return Promise.reject(new Error('NotAllowedError'));
    };
    expect(() => createDropboxVideos()(document)).not.toThrow();
  });

  it('no-ops without videos', () => {
    document.body.innerHTML = '';
    expect(() => createDropboxVideos()(document)).not.toThrow();
  });
});

describe('initEffects', () => {
  it('isolates a throwing effect and still runs the rest', () => {
    let ranAfter = false;
    const teardown = initEffects([
      {
        name: 'boom',
        init: () => {
          throw new Error('effect exploded');
        },
      },
      {
        name: 'after',
        init: () => {
          ranAfter = true;
        },
      },
    ]);
    expect(ranAfter).toBe(true);
    expect(() => teardown()).not.toThrow();
  });

  it('swallows teardown errors so unmount never breaks', () => {
    const teardown = initEffects([
      {
        name: 'bad-teardown',
        init: () => () => {
          throw new Error('teardown exploded');
        },
      },
    ]);
    expect(() => teardown()).not.toThrow();
  });
});
