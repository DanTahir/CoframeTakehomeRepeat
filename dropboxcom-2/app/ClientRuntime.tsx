'use client';

/**
 * Re-applies the behaviours the original page's JavaScript provided.
 *
 * Codegen captures the DOM *before* scroll and strips runtime-added classes,
 * so the markup starts in its pristine pre-animation state. Everything that
 * made dropbox.com feel alive is re-implemented here.
 *
 * EVERY GENERIC EFFECT WAS CENSUSED AGAINST THE GENERATED MARKUP.
 * Ten are deliberately NOT registered — eight because they match nothing, and
 * two because they match but are actively harmful. Recorded here so a future
 * run does not helpfully re-add them:
 *
 *   zero targets in app/generated/*.tsx (verified by grep):
 *     fadeIn      - no `.fade-in` / `[data-fade]` / `[data-animate]`; this
 *                   site gates reveals on hashed CSS-module classes instead,
 *                   which is what `dropboxReveals` handles.
 *     navDropdown - no `.w-dropdown` / `[data-dropdown]`.
 *     tabs        - no `.w-tab-link` / `[role="tab"]` / `[data-tab]`.
 *     accordion   - no `.accordion-item` / `.faq-item`.
 *     counters    - no `[data-counter]` / `[data-count-to]`.
 *     lazyImages  - no `img[data-src]` / `[data-bg]`. (`features.json` reports
 *                   77 "lazyImages" but those are native `loading="lazy"`,
 *                   which needs no JS.)
 *     forms       - no `<form>` anywhere on the page.
 *     navScroll   - the nav is CSS `position: sticky`; no scrolled-state class
 *                   exists in the captured CSS.
 *
 *   matches real elements but MUST NOT run:
 *     navToggle   - matches `.dwg-nav__hamburger-button` / `.dwg-nav-menu*`
 *                   but applies its own `is-open`/`nav-open` classes, which
 *                   this site's CSS does not define. It would fight
 *                   `dropboxNav` while producing no visible effect.
 *     marquee     - matches the logo ticker `._ticker_90hav_23`, which is
 *                   ALREADY CSS-animated (`@keyframes _keyframes-standard_90hav_1`,
 *                   translateX -30% -> -50%) over markup that ALREADY contains
 *                   duplicated content. Cloning a third copy desyncs the wrap.
 *
 * `smoothAnchors` IS registered: it matches exactly two real navigation
 * anchors (`#main-content`, `#manage-cookies`), neither of which is a widget
 * control, so it cannot cause the autoplay-driven scroll-hijack trap.
 */

import { useEffect } from 'react';
import { initEffects, type RegisteredEffect } from './lib/runtime';
import { initSmoothAnchors } from './lib/nav';
import { initDropboxReveals } from './lib/dropboxReveals';
import { initDropboxNav } from './lib/dropboxNav';
import { initDropboxVideos } from './lib/dropboxVideos';

const effects: RegisteredEffect[] = [
  // Re-applies the 3 visibility-gating classes from scroll-reveals.json.
  { name: 'dropboxReveals', init: initDropboxReveals },
  // 6 dropdown panels + the mobile burger sheet, incl. the two runtime-only
  // CSS height variables that exist in none of the captured stylesheets.
  { name: 'dropboxNav', init: initDropboxNav },
  // `muted` as a DOM property so the 4 looping .webm files may autoplay.
  { name: 'dropboxVideos', init: initDropboxVideos },
  // Generic, kept: 2 real in-page anchors.
  { name: 'smoothAnchors', init: initSmoothAnchors },
];

export default function ClientRuntime() {
  useEffect(() => {
    // Deferred one frame so the generated markup is committed and laid out
    // before any effect measures it (the nav reads panel scrollHeight).
    let teardown: (() => void) | undefined;
    const raf = requestAnimationFrame(() => {
      teardown = initEffects(effects);
    });
    return () => {
      cancelAnimationFrame(raf);
      teardown?.();
    };
  }, []);

  return null;
}
