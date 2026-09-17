/**
 * Letter-trail ("caterpillar") headline reveal.
 *
 * Ported 1:1 from the live page's own bundle: scrape/raw/js/intelligence.a7cda79c.js
 * (minified class `p`). Every constant below is the value read out of that file, so the
 * choreography matches the original frame-for-frame:
 *
 *   - the headline is split into per-word / per-letter spans,
 *   - a "dot train" walks letter by letter, revealing each letter 110ms after it arrives,
 *   - a coloured particle is spawned at every letter,
 *   - punctuation introduces an extra pause,
 *   - when the last letter is reached the root gains `is-filled`, which is what switches
 *     `.reveal-headline__gradient` from flat #0d0031 to the animated gradient.
 */

const TIME_SCALE = 1; // `ue` — original divides every duration by this
const LETTER_REVEAL_DELAY = 110; // `me`
const LETTER_STEP_MS = 20; // `fe` — overridable per element via data-letter-delay
const LINE_MOVE_MS = 110; // `pe`
const PARTICLE_MS = 430; // `ye`

/** `ve` — extra dwell time after specific characters. */
const PUNCTUATION_PAUSE: Record<string, number> = {
  '.': 520,
  '!': 620,
  '?': 620,
  ',': 240,
  ':': 320,
  ';': 340,
  '\u2014': 300, // em dash
  '\u2013': 300, // en dash
};

/** `_` — the particle colour ramp. */
const COLORS = [
  '#D6E8F8',
  '#C9FF98',
  '#F6EA00',
  '#FFB238',
  '#FF4D40',
  '#A30D0D',
  '#FF2AF8',
  '#236CFF',
];

const scale = (ms: number) => ms / TIME_SCALE;

type Point = { x: number; y: number; minParticleSize?: number };
type DotState = { point: Point };

/** `we` — grapheme-aware split so emoji/combining marks stay intact. */
function splitGraphemes(value: string): string[] {
  const intl = Intl as unknown as {
    Segmenter?: new (
      locale?: string | string[],
      options?: { granularity?: string },
    ) => { segment(input: string): Iterable<{ segment: string }> };
  };
  if (intl.Segmenter) {
    const segmenter = new intl.Segmenter(undefined, { granularity: 'grapheme' });
    return [...segmenter.segment(value)].map(({ segment }) => segment);
  }
  return Array.from(value);
}

export type LetterTrailOptions = {
  onStart?: () => void;
  onComplete?: () => void;
  /** `startDelay` — the #intro headline is given 500ms in the original. */
  startDelay?: number;
};

export class LetterTrail {
  private readonly root: HTMLElement;
  private readonly onStart?: () => void;
  private readonly onComplete?: () => void;
  private readonly startDelay: number;

  private readonly reducedMotion: MediaQueryList;
  private readonly onMotionChange: () => void;
  private readonly observer: IntersectionObserver | null = null;

  private wrapper: HTMLElement | null = null;
  private dotLayer: HTMLElement | null = null;
  private startTimer: number | null = null;

  /** Incremented on every (re)play so stale async loops bail out. */
  private run = 0;
  private started = false;
  private completed = false;

  constructor(root: HTMLElement, options: LetterTrailOptions = {}) {
    this.root = root;
    this.onStart = options.onStart;
    this.onComplete = options.onComplete;
    this.startDelay = options.startDelay ?? 0;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.onMotionChange = () => void this.play();

    // Idempotency guard: React can mount effects twice in development.
    if (root.classList.contains('letter-trail') || root.closest('.caterpillar')) {
      this.reducedMotion.addEventListener('change', this.onMotionChange);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'caterpillar';
    root.replaceWith(wrapper);
    wrapper.append(root);
    this.wrapper = wrapper;

    const dotLayer = document.createElement('div');
    dotLayer.className = 'dot-layer';
    dotLayer.setAttribute('aria-hidden', 'true');
    wrapper.append(dotLayer);
    this.dotLayer = dotLayer;

    this.splitLetters();

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.observer?.disconnect();
          const begin = () => {
            if (document.fonts?.ready) {
              document.fonts.ready.then(() => void this.play(), () => void this.play());
            } else {
              void this.play();
            }
          };
          if (this.startDelay > 0) {
            this.startTimer = window.setTimeout(begin, this.startDelay);
          } else {
            begin();
          }
        }
      },
      { threshold: 0, rootMargin: '0px 0px -25% 0px' },
    );
    this.observer.observe(root);
    this.reducedMotion.addEventListener('change', this.onMotionChange);
  }

  /** Wraps every word in `.letter-trail__word` and every grapheme in `.letter-trail__letter`. */
  private splitLetters(): void {
    const label = (this.root.textContent ?? '').trim().replace(/\s+/g, ' ');
    this.root.setAttribute('aria-label', label);
    let index = 0;

    const walk = (node: Element): void => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child as Element);
          continue;
        }
        if (child.nodeType !== Node.TEXT_NODE) continue;
        const text = child.textContent ?? '';
        if (!text.trim()) continue;

        const fragment = document.createDocumentFragment();
        for (const chunk of text.split(/(\s+)/)) {
          if (!chunk) continue;
          if (/^\s+$/.test(chunk)) {
            fragment.append(document.createTextNode(' '));
            continue;
          }
          const word = document.createElement('span');
          word.className = 'letter-trail__word';
          word.setAttribute('aria-hidden', 'true');
          for (const grapheme of splitGraphemes(chunk)) {
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
    return [...this.root.querySelectorAll<HTMLElement>('.letter-trail__letter')];
  }

  /** Groups letters into visual lines by comparing their top edges (2px tolerance). */
  private lines(): { top: number; letters: HTMLElement[] }[] {
    const lines: { top: number; letters: HTMLElement[] }[] = [];
    for (const letter of this.letters()) {
      const rect = letter.getBoundingClientRect();
      let line = lines.find(({ top }) => Math.abs(top - rect.top) < 2);
      if (!line) {
        line = { top: rect.top, letters: [] };
        lines.push(line);
      }
      line.letters.push(letter);
    }
    return lines;
  }

  private pointFor(letter: HTMLElement): Point {
    const dotLayer = this.dotLayer!;
    const rect = letter.getBoundingClientRect();
    const layerRect = dotLayer.getBoundingClientRect();
    const layerFont = parseFloat(getComputedStyle(dotLayer).fontSize);
    const letterFont = parseFloat(getComputedStyle(letter).fontSize);
    const height = letterFont * 0.8;
    const minParticleSize =
      (Math.hypot(rect.width, height) + Math.max(6, letterFont * 0.25)) / (layerFont * 0.8);
    return this.keepInsideViewport({
      x: rect.left + rect.width / 2 - layerRect.left,
      y: rect.top + rect.height * 0.53 - layerRect.top,
      minParticleSize,
    });
  }

  /** Below 768px the train is clamped so particles never overflow the viewport. */
  private keepInsideViewport(point: Point): Point {
    if (window.innerWidth > 768) return point;
    const dotLayer = this.dotLayer!;
    const layerRect = dotLayer.getBoundingClientRect();
    const inset =
      16 +
      (parseFloat(getComputedStyle(dotLayer).fontSize) *
        Math.max(1.04, point.minParticleSize || 0) *
        1.22) /
        2;
    return {
      ...point,
      x: Math.max(
        inset - layerRect.left,
        Math.min(document.documentElement.clientWidth - inset - layerRect.left, point.x),
      ),
    };
  }

  private static transformFor(point: Point): string {
    return `translate3d(${point.x}px, ${point.y}px, 0)`;
  }

  private async animateTo(
    element: HTMLElement,
    state: DotState,
    target: Point,
    options: KeyframeAnimationOptions,
    run: number,
    path?: Point[],
  ): Promise<boolean> {
    if (run !== this.run) return false;
    const points = path || [state.point, target];
    const animation = element.animate(
      points.map((point) => ({ transform: LetterTrail.transformFor(point) })),
      { fill: 'forwards', ...options },
    );
    try {
      await animation.finished;
    } catch {
      return false;
    }
    if (run !== this.run) return false;
    state.point = target;
    element.style.transform = LetterTrail.transformFor(target);
    animation.cancel();
    return true;
  }

  private spawnParticle(point: Point, index: number, run: number): void {
    if (run !== this.run) return;
    const dotLayer = this.dotLayer!;
    const position = document.createElement('span');
    const particle = document.createElement('i');
    const size = Math.max(0.92 + (index % 4) * 0.04, point.minParticleSize || 0);
    const colorStops = COLORS.map((backgroundColor, i) => ({
      backgroundColor,
      offset: 0.18 + i * (0.72 / (COLORS.length - 1)),
    }));

    position.className = 'trail-particle-position';
    particle.className = 'trail-particle';
    position.style.transform = LetterTrail.transformFor(point);
    particle.style.setProperty('--particle-size', String(size));
    position.append(particle);
    dotLayer.insertBefore(position, dotLayer.querySelector('.dot-train'));

    particle
      .animate(
        [
          { transform: 'scale(0)', backgroundColor: COLORS[COLORS.length - 1], opacity: 0 },
          { transform: 'scale(0.55)', opacity: 1, offset: 0.12 },
          ...colorStops.map((stop, i) => ({
            ...stop,
            transform: `scale(${0.65 + Math.sin((i / 7) * Math.PI) * 0.57})`,
            opacity: 1,
          })),
          { transform: 'scale(0)', backgroundColor: COLORS[COLORS.length - 1], opacity: 0 },
        ] as Keyframe[],
        { duration: scale(PARTICLE_MS), easing: 'linear', fill: 'forwards' },
      )
      .finished.finally(() => position.remove())
      .catch(() => position.remove());
  }

  private async waitForPause(ms: number, run: number): Promise<boolean> {
    if (!ms) return true;
    await new Promise((resolve) => window.setTimeout(resolve, ms));
    return run === this.run;
  }

  /** The swooping 4-point path the train follows when wrapping to the next line. */
  private async moveBetweenLines(
    element: HTMLElement,
    state: DotState,
    from: Point,
    to: Point,
    run: number,
  ): Promise<boolean> {
    const drop = Math.max(34, to.y - from.y);
    return this.animateTo(
      element,
      state,
      to,
      { duration: scale(LINE_MOVE_MS), easing: 'cubic-bezier(0.55, 0, 0.2, 1)' },
      run,
      [
        from,
        this.keepInsideViewport({ x: from.x + 28, y: from.y + drop * 0.72 }),
        this.keepInsideViewport({ x: to.x - 46, y: to.y + 18 }),
        to,
      ],
    );
  }

  async play(): Promise<void> {
    if (!this.dotLayer) return;
    const run = ++this.run;
    this.dotLayer.replaceChildren();
    if (!this.started) {
      this.started = true;
      this.onStart?.();
    }

    const letters = this.letters();
    for (const letter of letters) letter.classList.remove('is-visible');

    if (this.reducedMotion.matches) {
      for (const letter of letters) letter.classList.add('is-visible');
      this.root.classList.add('is-filled');
      this.complete();
      return;
    }

    const lines = this.lines();
    if (!lines.length) return;

    const train = document.createElement('div');
    train.className = 'dot-train';
    this.dotLayer.append(train);

    const first = this.pointFor(lines[0].letters[0]);
    const state: DotState = { point: first };
    let particleIndex = 0;
    train.style.transform = LetterTrail.transformFor(first);

    const step = scale(Number(this.root.dataset.letterDelay) || LETTER_STEP_MS);

    for (let i = 0; i < lines.length; i += 1) {
      for (const letter of lines[i].letters) {
        if (run !== this.run) return;
        const point = this.pointFor(letter);
        if (!(await this.animateTo(train, state, point, { duration: step, easing: 'linear' }, run)))
          return;
        this.spawnParticle(point, particleIndex++, run);
        window.setTimeout(() => {
          if (run === this.run) letter.classList.add('is-visible');
        }, scale(LETTER_REVEAL_DELAY));
        const pause = PUNCTUATION_PAUSE[letter.textContent ?? ''] || 0;
        if (!(await this.waitForPause(scale(pause), run))) return;
      }
      const nextLine = lines[i + 1];
      if (!nextLine) break;
      const target = this.pointFor(nextLine.letters[0]);
      if (!(await this.moveBetweenLines(train, state, state.point, target, run))) return;
    }

    if (run === this.run) {
      train.remove();
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
    this.run += 1;
    if (this.startTimer !== null) window.clearTimeout(this.startTimer);
    this.observer?.disconnect();
    this.reducedMotion.removeEventListener('change', this.onMotionChange);
    this.dotLayer?.remove();
    if (this.wrapper?.parentNode) this.wrapper.replaceWith(this.root);
  }
}

/**
 * Attaches a letter trail to every `.reveal-headline`, optionally skipping ones already
 * owned by another controller (the hero orchestrator owns `#intro .reveal-headline`).
 */
export function initLetterTrails(
  scope: ParentNode = document,
  skip: Element[] = [],
): () => void {
  const roots = [...scope.querySelectorAll<HTMLElement>('.reveal-headline')].filter(
    (root) => !skip.includes(root),
  );
  const trails = roots.map((root) => new LetterTrail(root));
  return () => {
    for (const trail of trails) trail.destroy();
  };
}
