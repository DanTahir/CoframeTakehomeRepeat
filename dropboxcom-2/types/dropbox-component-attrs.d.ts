/**
 * Types-only augmentation for Dropbox's `dwg-*` component attributes.
 *
 * WHY THIS EXISTS
 * ---------------
 * Dropbox's own design-system components render genuine, non-standard
 * attributes onto standard elements — `label` and `tag` on `<a>`:
 *
 *     <a class="dwg-button2 ..." label="Get started" tag="a" href="...">
 *
 * These are real upstream markup, live in the served DOM, not capture
 * artifacts, so stripping them would make the replica *less* faithful. But
 * React's `HTMLAttributes` has no such keys, so `tsc` rejects every one of
 * them (~50 × TS2322 on this page).
 *
 * Widening `HTMLAttributes` is the minimal, additive fix: it only adds these
 * two optional keys, so genuine typos in real attribute names are still
 * caught. The alternative — casting each generated element's props — would
 * silence real errors across the whole component tree.
 *
 * Same shape as the template's standing `css-custom-properties.d.ts` fix.
 */

declare module 'react' {
  interface HTMLAttributes<T> {
    /** `dwg-button2` / `dwg-nav-item` accessible label passthrough. */
    label?: string;
    /** Element the `dwg-*` component was asked to render as ("a", "button"). */
    tag?: string;
  }
}

export {};
