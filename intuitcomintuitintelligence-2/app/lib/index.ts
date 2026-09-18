/** Barrel for every effect module. */
export * from './runtime';
export * from './fadeIn';
export * from './nav';
export * from './reveal';
export * from './forms';
export * from './adapters';

/**
 * Site-specific effects, ported from the original page's own JavaScript
 * (`intelligence.js`, `disclaimer.js`, `prefooter.js`, `navOpen.js`). Unlike
 * the generic modules above, these are not reusable patterns — they reproduce
 * this page's exact behaviour and timings.
 */
export * from './intuitBrandsNav';
export * from './intuitHero';
export * from './intuitLetterTrail';
export * from './intuitVideo';
export * from './intuitCarousels';
export * from './intuitTabbedBanner';
export * from './intuitCursors';
export * from './intuitPage';
