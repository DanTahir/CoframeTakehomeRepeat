/**
 * dropbox.com navigation: desktop dropdown panels + the mobile burger menu.
 *
 * WHY THIS IS HAND-WRITTEN RATHER THAN THE GENERIC `navToggle`/`navDropdown`
 * -------------------------------------------------------------------------
 * The generic modules DO match these elements (`[class*="hamburger"]`,
 * `[class*="nav-menu"]`) but apply their own `is-open` / `w--open` classes,
 * which this site's CSS knows nothing about — so they would fight this module
 * while producing no visible effect. They are deliberately unregistered.
 *
 * TWO CSS VARIABLES ARE RUNTIME-AUTHORED AND IN NO CAPTURED STYLESHEET
 * --------------------------------------------------------------------
 * The open-state rules read their height from variables the site's own JS
 * writes inline. Grepping all 122 captured sheets finds no definition for
 * either, which is evidence they were runtime-authored, not evidence of a
 * broken capture. Leave them unset and a dropdown "opens" to zero height:
 *
 *   .dwg-nav-item__dropdown--open            { max-height: var(--dwg-nav-item__dropdown-max-height) }   // < 1280px
 *   .dwg-nav-item--nav-redesign__dropdown
 *     .dwg-nav-item__dropdown--open          { max-height: var(--dwg-nav-current-dropdown-height) }     // >= 1280px
 *
 * Both are set here from the panel's own `scrollHeight` (which reports full
 * content height despite `max-height: 0; overflow: hidden`).
 *
 * `.dwg-nav__dropdown-background` is the white sheet behind an open desktop
 * panel — the panel itself is `desktop:dwg-bg-color--transparent`, so its
 * height has to be driven too or the dropdown reads as floating text.
 */
import { $all, type Teardown } from './runtime';

const SEL = {
  navRoot: '.dwg-nav--universal',
  /** The 6 real dropdown triggers: 3 horizontal (desktop) + 3 vertical (mobile). */
  trigger: 'button[aria-haspopup="true"][aria-controls]',
  backdrop: '.dwg-nav__dropdown-background',
  overlay: '.dwg-nav__overlay',
  burger: '.dwg-nav__hamburger-button',
  mobileDropdown: '.dwg-nav-mobile-dropdown',
} as const;

const CLS = {
  panelOpen: 'dwg-nav-item__dropdown--open',
  buttonOpen: 'dwg-nav-item-button--dropdown-open',
  navDropdownOpened: 'dwg-nav--dropdown-opened',
  backdropOpen: 'dwg-nav__dropdown-background--open',
  overlayOpen: 'dwg-nav__overlay--open',
  burgerOpen: 'dwg-nav__hamburger-button--open',
  mobileOpen: 'dwg-nav-mobile-dropdown--open',
  bodyMobileOpen: 'body--dwg-nav-mobile-dropdown-open--universal',
} as const;

const VAR_PANEL_MAX_MOBILE = '--dwg-nav-item__dropdown-max-height';
const VAR_PANEL_MAX_DESKTOP = '--dwg-nav-current-dropdown-height';

export function initDropboxNav(root: ParentNode = document): Teardown | void {
  const navRoot = root.querySelector<HTMLElement>(SEL.navRoot);
  const triggers = $all<HTMLButtonElement>(SEL.trigger, root);
  const burger = root.querySelector<HTMLElement>(SEL.burger);
  const mobileDropdown = root.querySelector<HTMLElement>(SEL.mobileDropdown);
  const backdrop = root.querySelector<HTMLElement>(SEL.backdrop);
  const overlay = root.querySelector<HTMLElement>(SEL.overlay);

  if (!triggers.length && !(burger && mobileDropdown)) return;

  const panelOf = (trigger: Element): HTMLElement | null => {
    const id = trigger.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  };

  const closeDropdowns = () => {
    for (const trigger of triggers) {
      trigger.classList.remove(CLS.buttonOpen);
      trigger.setAttribute('aria-expanded', 'false');
      const panel = panelOf(trigger);
      if (!panel) continue;
      panel.classList.remove(CLS.panelOpen);
      panel.style.removeProperty(VAR_PANEL_MAX_MOBILE);
      panel.style.removeProperty(VAR_PANEL_MAX_DESKTOP);
    }
    navRoot?.classList.remove(CLS.navDropdownOpened);
    if (backdrop) {
      backdrop.classList.remove(CLS.backdropOpen);
      backdrop.style.height = '0px';
    }
  };

  const openDropdown = (trigger: HTMLElement) => {
    const panel = panelOf(trigger);
    if (!panel) return;

    closeDropdowns();

    // Measured before the open class lands: `max-height` never clips
    // scrollHeight, so this is the panel's full content height either way.
    const height = panel.scrollHeight;
    panel.style.setProperty(VAR_PANEL_MAX_MOBILE, `${height}px`);
    panel.style.setProperty(VAR_PANEL_MAX_DESKTOP, `${height}px`);
    panel.classList.add(CLS.panelOpen);

    trigger.classList.add(CLS.buttonOpen);
    trigger.setAttribute('aria-expanded', 'true');
    // Gates the per-item opacity/translate stagger on the dropdown's links.
    navRoot?.classList.add(CLS.navDropdownOpened);

    if (backdrop) {
      backdrop.style.height = `${height}px`;
      backdrop.classList.add(CLS.backdropOpen);
    }
  };

  const isDropdownOpen = (trigger: Element) =>
    trigger.getAttribute('aria-expanded') === 'true';

  const setMobileOpen = (open: boolean) => {
    if (!burger || !mobileDropdown) return;
    mobileDropdown.classList.toggle(CLS.mobileOpen, open);
    burger.classList.toggle(CLS.burgerOpen, open);
    burger.setAttribute('aria-expanded', String(open));
    overlay?.classList.toggle(CLS.overlayOpen, open);
    // The site's own rule: body overflow is locked while the sheet is open.
    document.body.classList.toggle(CLS.bodyMobileOpen, open);
    if (!open) closeDropdowns();
  };

  const isMobileOpen = () => !!mobileDropdown?.classList.contains(CLS.mobileOpen);

  const cleanups: Array<() => void> = [];

  for (const trigger of triggers) {
    const onClick = (event: Event) => {
      // These are <button>s so there is no href to suppress, but the original
      // handler stopped propagation reaching the document-level close below.
      event.preventDefault();
      event.stopPropagation();
      if (isDropdownOpen(trigger)) closeDropdowns();
      else openDropdown(trigger);
    };
    trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('click', onClick);
    cleanups.push(() => trigger.removeEventListener('click', onClick));
  }

  if (burger && mobileDropdown) {
    const onBurger = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      setMobileOpen(!isMobileOpen());
    };
    burger.setAttribute('aria-expanded', 'false');
    burger.addEventListener('click', onBurger);
    cleanups.push(() => burger.removeEventListener('click', onBurger));
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    closeDropdowns();
    setMobileOpen(false);
  };

  const onDocumentClick = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (target && navRoot?.contains(target)) return;
    closeDropdowns();
    setMobileOpen(false);
  };

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', onDocumentClick);
  cleanups.push(() => {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('click', onDocumentClick);
  });

  return () => {
    for (const cleanup of cleanups) cleanup();
    closeDropdowns();
    setMobileOpen(false);
    document.body.classList.remove(CLS.bodyMobileOpen);
  };
}
