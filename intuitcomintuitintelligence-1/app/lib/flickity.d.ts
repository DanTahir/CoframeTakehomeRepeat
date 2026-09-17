/**
 * Minimal ambient types for the packaged Flickity build.
 *
 * The live page bundles its own copy of Flickity inline inside disclaimer.js, and that bundle is
 * v3: it builds dots as `<div class="flickity-page-dots"><button class="flickity-page-dot">`,
 * tags every cell `.flickity-cell`, and leaves the slider's `left` entirely to CSS. So we install
 * v3.0.0 from npm to match it.
 *
 * This was originally (wrongly) pinned to v2.3.0 on the theory that the
 * `.flickity-enabled`/`.flickity-viewport`/`.flickity-page-dots` names lined up with the captured
 * CSS. They do, but v2 diverges in three ways the captured CSS actively depends on — each of these
 * was measured against live at 375px, not guessed:
 *   1. v2 builds dots as `<ol><li class="dot">`, so every captured `.flickity-page-dot` rule
 *      missed and the dots painted as an unstyled numbered list ("1234.") instead of pills;
 *   2. consequently `.has-carousel-spacer … .flickity-page-dot:last-child{display:none}` never hid
 *      the trailing spacer cell's dot, giving 4 dots where live shows 3;
 *   3. v2's `_createSlider` sets an inline `slider.style.left = 0`, which outranks the captured
 *      `.discover__track .flickity-slider{left:30px}` (and the `.features__cards`/`.trust__cards`
 *      equivalents), so mobile cells sat flush at x=0 instead of inset by 30px.
 *
 * Every option and member declared below is one the page's own v3 call sites already use
 * (`cellAlign`/`contain`/`imagesLoaded`/`groupCells`/… and `destroy`/`selectedIndex`/`next`/
 * `previous`/`isAnimating`), so this surface is valid for v3 by construction.
 *
 * Deliberately the package main (`flickity` → `js/index.js`), NOT `dist/flickity.pkgd.js`.
 * The pkgd bundle is still the only file in the package that mentions jQuery, and webpack
 * resolves its `require("jquery")` statically, so importing it makes `next build` die with
 * "Module not found: Can't resolve 'jquery'". The package main pulls only its own relative
 * modules plus its five declared deps (ev-emitter, fizzy-ui-utils, get-size, imagesloaded,
 * unidragger) and needs no jQuery. Flickity's own stylesheet is likewise not imported: the
 * captured CSS already contains the upstream v3 base rules
 * (`.flickity-viewport{overflow:hidden;position:relative;height:100%;touch-action:pan-y}`,
 * `.flickity-cell{position:absolute;left:0}` and friends), because the live page bundled them too.
 */
declare module 'flickity' {
  export interface FlickityOptions {
    pageDots?: boolean;
    prevNextButtons?: boolean;
    draggable?: boolean;
    dragThreshold?: number;
    autoPlay?: boolean | number;
    cellAlign?: 'left' | 'center' | 'right';
    contain?: boolean;
    imagesLoaded?: boolean;
    initialIndex?: number;
    groupCells?: boolean | number | string;
    [option: string]: unknown;
  }

  export default class Flickity {
    constructor(element: Element | string, options?: FlickityOptions);
    selectedIndex: number;
    isAnimating: boolean;
    destroy(): void;
    append(element: Element): void;
    remove(element: Element): void;
    next(isWrap?: boolean): void;
    previous(isWrap?: boolean): void;
    resize(): void;
  }
}
