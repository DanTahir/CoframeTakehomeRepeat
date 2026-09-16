/**
 * Dropbox universal-nav behaviour (site-specific).
 *
 * The captured markup is inert: every dropdown panel ships with
 * `aria-expanded="false"` and without its `--open` class. The captured CSS
 * opens a panel with
 *
 *   .dwg-nav-item__dropdown--open { max-height: var(--dwg-nav-current-dropdown-height) }
 *
 * but `--dwg-nav-current-dropdown-height` is defined in **no** captured
 * stylesheet. The original nav script measures the panel and writes the
 * variable inline on the surrounding menu container; the capture froze that
 * inline value at `0`. Re-adding the `--open` class alone therefore leaves the
 * panel clamped to zero height — the measurement has to happen here too.
 *
 * Reproduced from this capture:
 *   - 6 dropdown triggers, `button[aria-haspopup="true"][aria-controls]`
 *     (`nav-item-{horizontal,vertical}-{0,1,5}-controller`), each pointing at a
 *     `div.dwg-nav-item__dropdown[role="menu"]` panel by id;
 *   - the mobile `button.dwg-nav__hamburger-button` and the
 *     `.dwg-nav-mobile-dropdown` panel it reveals
 *     (`.dwg-nav-mobile-dropdown--open` sets max-height + visibility).
 *
 * The generic `initNavToggle` cannot do this job: it matches these elements by
 * substring (`[class*="burger"]`, `[class*="nav-menu"]`) but toggles its own
 * `is-open`/`nav-open` classes, which appear nowhere in Dropbox's CSS.
 */
import { $all, rafThrottle, type Teardown } from './runtime';

const HEIGHT_VAR = '--dwg-nav-current-dropdown-height';
const PANEL_OPEN_CLASS = 'dwg-nav-item__dropdown--open';
const BURGER_OPEN_CLASS = 'dwg-nav__hamburger-button--open';
const MOBILE_OPEN_CLASS = 'dwg-nav-mobile-dropdown--open';

/** Optional nav chrome: toggled only when the capture actually contains it. */
const CHROME: ReadonlyArray<readonly [selector: string, openClass: string]> = [
  ['.dwg-nav__dropdown-background', 'dwg-nav__dropdown-background--open'],
  ['.dwg-nav__overlay', 'dwg-nav__overlay--open'],
];

export interface DropboxNavOptions {
  triggerSelector?: string;
  burgerSelector?: string;
  mobilePanelSelector?: string;
}

/**
 * Finds the element the original script wrote the height variable on: the
 * nearest ancestor already carrying it inline (the capture left it at `0`).
 * Falls back to the panel itself — custom properties inherit, so the `--open`
 * rule resolves either way.
 */
function heightVarHost(panel: HTMLElement): HTMLElement {
  let el: HTMLElement | null = panel.parentElement;
  while (el) {
    if (el.style.getPropertyValue(HEIGHT_VAR) !== '') return el;
    el = el.parentElement;
  }
  return panel;
}

/**
 * Content height of an open panel. `none` is a deliberate fallback rather than
 * `0px`: `max-height: none` leaves the panel uncapped, so a browser that
 * cannot measure yet shows the menu instead of an invisible zero-height strip.
 */
function panelHeight(panel: HTMLElement): string {
  const measured = panel.scrollHeight || (panel.firstElementChild as HTMLElement | null)?.scrollHeight || 0;
  return measured > 0 ? `${measured}px` : 'none';
}

export function createDropboxNav(options: DropboxNavOptions = {}) {
  const {
    triggerSelector = 'button[aria-haspopup="true"][aria-controls]',
    burgerSelector = '.dwg-nav__hamburger-button',
    mobilePanelSelector = '.dwg-nav-mobile-dropdown',
  } = options;

  return function initDropboxNav(root: ParentNode = document): Teardown | void {
    // Idempotent under React strict mode's double mount: a trigger already
    // wired by a live init is skipped rather than double-bound.
    const triggers = $all<HTMLElement>(triggerSelector, root).filter((t) => !t.dataset.dbxNavBound);
    const burger = root.querySelector<HTMLElement>(burgerSelector);
    const mobilePanel = root.querySelector<HTMLElement>(mobilePanelSelector);
    const hasMobile = Boolean(burger && mobilePanel && !burger.dataset.dbxNavBound);

    if (!triggers.length && !hasMobile) return;

    const ownerDoc = (root as Element).ownerDocument ?? document;
    const pairs = triggers
      .map((trigger) => {
        const id = trigger.getAttribute('aria-controls') ?? '';
        const panel = id ? ownerDoc.getElementById(id) : null;
        return panel ? { trigger, panel } : null;
      })
      .filter((p): p is { trigger: HTMLElement; panel: HTMLElement } => p !== null);

    let openPair: { trigger: HTMLElement; panel: HTMLElement } | null = null;

    function setChrome(open: boolean) {
      for (const [selector, openClass] of CHROME) {
        for (const el of $all<HTMLElement>(selector, root)) el.classList.toggle(openClass, open);
      }
    }

    function closeDropdown() {
      if (!openPair) return;
      const { trigger, panel } = openPair;
      panel.classList.remove(PANEL_OPEN_CLASS);
      trigger.setAttribute('aria-expanded', 'false');
      // Restore the captured inline value rather than deleting the property.
      heightVarHost(panel).style.setProperty(HEIGHT_VAR, '0');
      openPair = null;
      setChrome(false);
    }

    function openDropdown(pair: { trigger: HTMLElement; panel: HTMLElement }) {
      closeDropdown();
      const { trigger, panel } = pair;
      panel.classList.add(PANEL_OPEN_CLASS);
      trigger.setAttribute('aria-expanded', 'true');
      heightVarHost(panel).style.setProperty(HEIGHT_VAR, panelHeight(panel));
      openPair = pair;
      setChrome(true);
    }

    function closeMobile() {
      if (!burger || !mobilePanel) return;
      burger.classList.remove(BURGER_OPEN_CLASS);
      mobilePanel.classList.remove(MOBILE_OPEN_CLASS);
      burger.setAttribute('aria-expanded', 'false');
    }

    const cleanups: Teardown[] = [];

    for (const pair of pairs) {
      const onClick = (event: Event) => {
        event.preventDefault();
        if (openPair && openPair.trigger === pair.trigger) closeDropdown();
        else openDropdown(pair);
      };
      pair.trigger.addEventListener('click', onClick);
      pair.trigger.dataset.dbxNavBound = 'true';
      cleanups.push(() => {
        pair.trigger.removeEventListener('click', onClick);
        delete pair.trigger.dataset.dbxNavBound;
      });
    }

    if (hasMobile && burger && mobilePanel) {
      const onBurger = (event: Event) => {
        event.preventDefault();
        const open = !mobilePanel.classList.contains(MOBILE_OPEN_CLASS);
        burger.classList.toggle(BURGER_OPEN_CLASS, open);
        mobilePanel.classList.toggle(MOBILE_OPEN_CLASS, open);
        burger.setAttribute('aria-expanded', String(open));
        if (!open) closeDropdown();
      };
      burger.addEventListener('click', onBurger);
      burger.dataset.dbxNavBound = 'true';
      cleanups.push(() => {
        burger.removeEventListener('click', onBurger);
        delete burger.dataset.dbxNavBound;
      });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeDropdown();
      closeMobile();
    };

    const onDocumentClick = (event: Event) => {
      const target = event.target as Node | null;
      if (!target || !openPair) return;
      if (openPair.panel.contains(target) || openPair.trigger.contains(target)) return;
      closeDropdown();
    };

    // An open panel is height-clamped to a measured pixel value, so a resize
    // (or a reflow that changes its content height) has to be re-measured.
    const onResize = rafThrottle(() => {
      if (!openPair) return;
      heightVarHost(openPair.panel).style.setProperty(HEIGHT_VAR, panelHeight(openPair.panel));
    });

    ownerDoc.addEventListener('keydown', onKeyDown);
    ownerDoc.addEventListener('click', onDocumentClick);
    window.addEventListener('resize', onResize);

    return () => {
      closeDropdown();
      closeMobile();
      ownerDoc.removeEventListener('keydown', onKeyDown);
      ownerDoc.removeEventListener('click', onDocumentClick);
      window.removeEventListener('resize', onResize);
      for (const c of cleanups) c();
    };
  };
}

export const initDropboxNav = createDropboxNav();
