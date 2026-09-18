/**
 * Flickity v3 ships no type declarations (and there is no @types package for
 * v3 — DefinitelyTyped only covers v2, whose API differs). The original page
 * bundles Flickity v3, so we match that major version exactly and declare the
 * module as ambient `any`; the narrow surface we actually use is described by
 * the `FlickityInstance` interface in `intuitCarousels.ts`.
 */
declare module 'flickity';
