/**
 * Type augmentation for Dropbox's design-system component attributes.
 *
 * dropbox.com renders its `dwg-*` design-system components server-side and
 * leaves the component's own props on the resulting HTML elements. This
 * capture contains 50 `label="..."` and 50 `tag="..."` attributes on plain
 * `<a>` / `<span>` / `<div>` elements. They are meaningless to the browser but
 * are part of the captured markup, so codegen faithfully re-emits them — and
 * `tsc` rejects them as unknown JSX props (TS2322) without this file.
 *
 * Declaring them here keeps the generated TSX byte-faithful to the capture
 * instead of forcing codegen to silently drop real upstream attributes.
 * Types only — this file emits no runtime code.
 */
import 'react';

declare module 'react' {
  interface HTMLAttributes<T> {
    /** `dwg-*` component prop: accessible/visible label text. */
    label?: string;
    /** `dwg-*` component prop: element the component should render as. */
    tag?: string;
  }
}
