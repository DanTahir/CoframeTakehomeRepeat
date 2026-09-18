/**
 * The "caterpillar" letter-trail headline effect, ported from the original
 * page's `intelligence.js`.
 *
 * A dot crawls along the headline one grapheme at a time; each letter fades in
 * (`is-visible`) 110ms after the dot reaches it, and a coloured particle is
 * spawned at every stop. Between lines the dot follows a four-point curve down
 * to the start of the next line. Punctuation adds a per-character pause, which
 * is what gives the effect its speech-like rhythm.
 *
 * Two things make this load-bearing rather than decorative:
 *  - The captured CSS ships `.letter-trail__letter` at opacity 0, so without
 *    this module every `.reveal-headline` on the page is permanently blank.
 *  - The letters/word spans and the dot layer exist ONLY at runtime — they are
 *    absent from the static capture — so the DOM has to be built here.
 */

import type { Teardown } from './runtime';

/** Particle palette, in emission order. */
const PARTICLE_COLORS = [
  '#D6E8F8',
  '#C9FF98',
  '#F6EA00',
  '#FFB238',
  '#FF4D40',
  '#A30D0D',
  '#FF2AF8',
  '#236CFF',
];

/** Global speed divisor; 1 = the live site's timing. */
const SPEED = 1;
/** Delay between the dot arriving and the letter fading in. */
const LETTER_REVEAL_MS = 110;
/** Default per-letter crawl duration (overridable via `data-letter-delay`). */
const LETTER_DELAY_MS = 20;
/** Duration of the curve that carries the dot to the next line. */
const LINE_MOVE_MS = 110;
/** Lifetime of a spawned particle. */
const PARTICLE_MS = 430;

/** Extra pause after specific characters, in ms — the effect's "phrasing". */
const PUNCTUATION_PAUSES: Record<string, number> = {
  '.': 520,
  '!': 620,
  '?': 620,
  ',': 240,
  ':': 320,
  ';': 340,
  '\u2014': 300,
  '\u2013': 300,
};

const scaled = (ms: number): number => ms / SPEED;

/** Splits into user-perceived characters so emoji/combining marks stay intact. */
function graphemes(text: string): string[] {
  if ('Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
      ({ segment }) => segment,
    );
  }
  return Array.from(text);
}

interface TrailPoint {
  x: number;
  y: number;
  minParticleSize?: number;
}

interface LetterTrailOptions {
  onStart?: () => void;
  onComplete?: () => void;
  startDelay?: number;
}

export class LetterTrail {
  private readonly root: HTMLElement;
  private readonly onStart?: () => void;
  private readonly onComplete?: () => void;
  private readonly startDelay: number;
  private readonly reducedMotion: MediaQueryList;
  private readonly onMotionChange: () => void;

  private wrapper!: HTMLElement;
  private dotLayer!: HTMLElement;
  private observer?: IntersectionObserver;
  private startTimer?: number;

  private completed = false;
  private started = false;
  /** Monotonic run id; bumping it invalidates every in-flight animation. */
  private run = 0;

  constructor(root: HTMLElement, { onStart, onComplete, startDelay = 0 }: LetterTrailOptions = {}) {
    this.root = root;
    this.onStart = onStart;
    this.onComplete = onComplete;
    this.startDelay = startDelay;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.onMotionChange = () => void this.play();

    // Wrap the headline so the absolutely-positioned dot layer has a
    // containing block that matches the text box exactly.
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'caterpillar';
    root.replaceWith(this.wrapper);
    this.wrapper.append(root);

    this.dotLayer = document.createElement('div');
    this.dotLayer.className = 'dot-layer';
    this.dotLayer.setAttribute('aria-hidden', 'true');
    this.wrapper.append(this.dotLayer);

    this.splitLetters();

    // -25% bottom margin: the headline has to be properly in view, since the
    // animation only ever runs once.
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.observer?.disconnect();
          const begin = () => {
            // Fonts change glyph metrics, and every dot position is measured
            // from them — starting early animates against the fallback face.
            if (document.fonts?.ready) document.fonts.ready.then(() => void this.play());
            else void this.play();
          };
          if (this.startDelay > 0) this.startTimer = window.setTimeout(begin, this.startDelay);
          else begin();
        }
      },
      { threshold: 0, rootMargin: '0px 0px -25% 0px' },
    );
    this.observer.observe(root);

    this.reducedMotion.addEventListener('change', this.onMotionChange);
  }

  /**
   * Rewrites the headline's text nodes into per-word / per-letter spans,
   * preserving nested inline elements. The original text is preserved on
   * `aria-label` and the generated spans are hidden from assistive tech, so the
   * headline still reads as one sentence.
   */
  private splitLetters(): void {
    const label = (this.root.textContent ?? '').trim().replace(/\s+/g, ' ');
    this.root.setAttribute('aria-label', label);

    let index = 0;
    const walk = (node: Node): void => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child);
          continue;
        }
        if (child.nodeType !== Node.TEXT_NODE) continue;
        const text = child.textContent ?? '';
        if (!text.trim()) continue;

        const fragment = document.createDocumentFragment();
        for (const chunk of text.split(/(\s+)/)) {
          if (!chunk) continue;
          if (/^\s+$/.test(chunk)) {
            // Collapse runs of whitespace to a single breakable space.
            fragment.append(document.createTextNode(' '));
            continue;
          }
          const word = document.createElement('span');
          word.className = 'letter-trail__word';
          word.setAttribute('aria-hidden', 'true');
          for (const grapheme of graphemes(chunk)) {
            const letter = document.createElement('span');
            letter.className = 'letter-trail__letter';
            letter.dataset.letterIndex = String(index++);
            letter.textContent = grapheme;
            word.append(letter);
          }
          fragment.append(word);
        }
        child.replaceWith(fragment);
      }
    };

    walk(this.root);
    this.root.classList.add('letter-trail');
  }

  private letters(): HTMLElement[] {
    return Array.from(this.root.querySelectorAll<HTMLElement>('.letter-trail__letter'));
  }

  /** Groups letters into visual lines by their measured top edge. */
  private lines(): Array<{ top: number; letters: HTMLElement[] }> {
    const lines: Array<{ top: number; letters: HTMLElement[] }> = [];
    for (const letter of this.letters()) {
      const box = letter.getBoundingClientRect();
      // 2px tolerance absorbs sub-pixel baseline differences.
      let line = lines.find(({ top }) => Math.abs(top - box.top) < 2);
      if (!line) {
        line = { top: box.top, letters: [] };
        lines.push(line);
      }
      line.letters.push(letter);
    }
    return lines;
  }

  /** Dot-layer-relative target point for a letter, plus its particle scale. */
  private pointFor(letter: HTMLElement): TrailPoint {
    const box = letter.getBoundingClientRect();
    const layer = this.dotLayer.getBoundingClientRect();
    const layerFontSize = parseFloat(getComputedStyle(this.dotLayer).fontSize);
    const letterFontSize = parseFloat(getComputedStyle(letter).fontSize);
    const glyphHeight = letterFontSize * 0.8;
    // Particle has to cover the glyph's diagonal plus a little padding.
    const minParticleSize =
      (Math.hypot(box.width, glyphHeight) + Math.max(6, letterFontSize * 0.25)) /
      (layerFontSize * 0.8);

    return this.keepInsideViewport({
      x: box.left + box.width / 2 - layer.left,
      // 0.53 rather than 0.5: optically centred on lowercase glyphs.
      y: box.top + box.height * 0.53 - layer.top,
      minParticleSize,
    });
  }

  /** On phones, clamps x so a big particle can't cause horizontal overflow. */
  private keepInsideViewport(point: TrailPoint): TrailPoint {
    if (window.innerWidth > 768) return point;
    const layer = this.dotLayer.getBoundingClientRect();
    const layerFontSize = parseFloat(getComputedStyle(this.dotLayer).fontSize);
    const inset =
      16 + (layerFontSize * Math.max(1.04, point.minParticleSize || 0) * 1.22) / 2;
    return {
      ...point,
      x: Math.max(
        inset - layer.left,
        Math.min(document.documentElement.clientWidth - inset - layer.left, point.x),
      ),
    };
  }

  private static transformFor(point: TrailPoint): string {
    return `translate3d(${point.x}px, ${point.y}px, 0)`;
  }

  /**
   * Animates the dot to `to`, resolving false if a newer run superseded us.
   * The final transform is written inline and the animation cancelled, so the
   * dot keeps its position without holding a forwards-fill animation per letter.
   */
  private async animateTo(
    dot: HTMLElement,
    cursor: { point: TrailPoint },
    to: TrailPoint,
    options: KeyframeAnimationOptions,
    run: number,
    path?: TrailPoint[],
  ): Promise<boolean> {
    if (run !== this.run) return false;
    const frames = path ?? [cursor.point, to];
    const animation = dot.animate(
      frames.map((point) => ({ transform: LetterTrail.transformFor(point) })),
      { fill: 'forwards', ...options },
    );
    try {
      await animation.finished;
    } catch {
      return false;
    }
    if (run !== this.run) return false;
    cursor.point = to;
    dot.style.transform = LetterTrail.transformFor(to);
    animation.cancel();
    return true;
  }

  /** Emits one short-lived coloured particle at a letter's position. */
  private spawnParticle(point: TrailPoint, ordinal: number, run: number): void {
    if (run !== this.run) return;

    const holder = document.createElement('span');
    const particle = document.createElement('i');
    // Slight size cycling keeps consecutive particles from looking stamped.
    const size = Math.max(0.92 + ((ordinal % 4) * 0.04), point.minParticleSize || 0);
    const colorStops = PARTICLE_COLORS.map((color, i) => ({
      backgroundColor: color,
      offset: 0.18 + i * (0.72 / (PARTICLE_COLORS.length - 1)),
    }));

    holder.className = 'trail-particle-position';
    particle.className = 'trail-particle';
    holder.style.transform = LetterTrail.transformFor(point);
    particle.style.setProperty('--particle-size', String(size));
    holder.append(particle);
    // Insert before the dot train so the train always renders on top.
    this.dotLayer.insertBefore(holder, this.dotLayer.querySelector('.dot-train'));

    particle
      .animate(
        [
          { transform: 'scale(0)', backgroundColor: PARTICLE_COLORS.at(-1), opacity: 0 },
          { transform: 'scale(0.55)', opacity: 1, offset: 0.12 },
          ...colorStops.map((stop, i) => ({
            ...stop,
            // Sine-driven pulse across the colour sweep.
            transform: `scale(${0.65 + Math.sin((i / 7) * Math.PI) * 0.57})`,
            opacity: 1,
          })),
          { transform: 'scale(0)', backgroundColor: PARTICLE_COLORS.at(-1), opacity: 0 },
        ],
        { duration: scaled(PARTICLE_MS), easing: 'linear', fill: 'forwards' },
      )
      .finished.catch(() => {})
      .finally(() => holder.remove());
  }

  private async waitForPause(ms: number, run: number): Promise<boolean> {
    if (!ms) return true;
    await new Promise((resolve) => window.setTimeout(resolve, ms));
    return run === this.run;
  }

  /** Curved hop from the end of one line to the start of the next. */
  private async moveBetweenLines(
    dot: HTMLElement,
    cursor: { point: TrailPoint },
    from: TrailPoint,
    to: TrailPoint,
    run: number,
  ): Promise<boolean> {
    const drop = Math.max(34, to.y - from.y);
    return this.animateTo(
      dot,
      cursor,
      to,
      { duration: scaled(LINE_MOVE_MS), easing: 'cubic-bezier(0.55, 0, 0.2, 1)' },
      run,
      [
        from,
        this.keepInsideViewport({ x: from.x + 28, y: from.y + drop * 0.72 }),
        this.keepInsideViewport({ x: to.x - 46, y: to.y + 18 }),
        to,
      ],
    );
  }

  /** Runs (or re-runs) the crawl. Safe to call again; supersedes any live run. */
  async play(): Promise<void> {
    const run = ++this.run;
    this.dotLayer.replaceChildren();

    if (!this.started) {
      this.started = true;
      this.onStart?.();
    }

    const letters = this.letters();
    for (const letter of letters) letter.classList.remove('is-visible');

    // Reduced motion: skip the crawl, just show the finished headline.
    if (this.reducedMotion.matches) {
      for (const letter of letters) letter.classList.add('is-visible');
      this.root.classList.add('is-filled');
      this.complete();
      return;
    }

    const lines = this.lines();
    if (!lines.length) return;

    const dot = document.createElement('div');
    dot.className = 'dot-train';
    this.dotLayer.append(dot);

    const first = this.pointFor(lines[0].letters[0]);
    const cursor = { point: first };
    let ordinal = 0;
    dot.style.transform = LetterTrail.transformFor(first);

    const perLetter = scaled(Number(this.root.dataset.letterDelay) || LETTER_DELAY_MS);

    for (let i = 0; i < lines.length; i += 1) {
      for (const letter of lines[i].letters) {
        if (run !== this.run) return;
        const point = this.pointFor(letter);
        if (!(await this.animateTo(dot, cursor, point, { duration: perLetter, easing: 'linear' }, run))) {
          return;
        }
        this.spawnParticle(point, ordinal++, run);
        window.setTimeout(() => {
          if (run === this.run) letter.classList.add('is-visible');
        }, scaled(LETTER_REVEAL_MS));

        const pause = PUNCTUATION_PAUSES[letter.textContent ?? ''] || 0;
        if (!(await this.waitForPause(scaled(pause), run))) return;
      }

      const next = lines[i + 1];
      if (!next) break;
      const target = this.pointFor(next.letters[0]);
      if (!(await this.moveBetweenLines(dot, cursor, cursor.point, target, run))) return;
    }

    if (run === this.run) {
      dot.remove();
      this.root.classList.add('is-filled');
      this.complete();
    }
  }

  private complete(): void {
    if (this.completed) return;
    this.completed = true;
    this.onComplete?.();
  }

  destroy(): void {
    // Invalidates every pending animation/timeout via the run guard.
    this.run += 1;
    if (this.startTimer) window.clearTimeout(this.startTimer);
    this.observer?.disconnect();
    this.reducedMotion.removeEventListener('change', this.onMotionChange);
    this.dotLayer.remove();
    if (this.wrapper?.parentNode) this.wrapper.replaceWith(this.root);
  }
}

/**
 * Attaches the trail to every `.reveal-headline` that isn't already handled.
 *
 * The hero module claims `#intro .reveal-headline` first (it needs the
 * start/complete hooks to sequence against the propeller clip), and marks it by
 * wrapping it in `.caterpillar` — which is exactly what we skip on here, so the
 * two effects can't double-wrap the same headline.
 */
export function initIntuitLetterTrails(root: ParentNode = document): Teardown | void {
  const headlines = Array.from(root.querySelectorAll<HTMLElement>('.reveal-headline')).filter(
    (headline) => !headline.closest('.caterpillar'),
  );
  if (!headlines.length) return;

  const trails = headlines.map((headline) => new LetterTrail(headline));
  return () => {
    for (const trail of trails) trail.destroy();
  };
}
