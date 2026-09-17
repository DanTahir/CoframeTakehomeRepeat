// Throwaway probe (scrape/ is gitignored): decide captureMode on DOM-level
// evidence rather than codegen's element/asset ratio line.
// Usage: node scrape/probe-capture-source.mjs
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const files = {
  static: 'scrape/raw/index.static.html',
  rendered: 'scrape/raw/index.html',
  scrolled: 'scrape/raw/index.scrolled.html',
};

const TAGS = ['video', 'source', 'iframe', 'svg', 'img', 'canvas', 'picture', 'script', 'style'];

const SELECTORS = [
  // reveal carriers named by analyze
  '.intro__point',
  '.features__card',
  '.tabbed-banner',
  '.video-player',
  '.letter-trail',
  '.letter-trail__letter',
  '.is-visible',
  '.is-revealed',
  '.is-inview',
  // runtime-looking nodes
  '.app-cursor',
  '.dot-train',
  '.trail-particle',
  '.hero__propeller-video',
  '.hero__propeller-still',
  // structure / widgets
  '#__next',
  '#onetrust-consent-sdk',
  'next-route-announcer',
  '[role="tab"]',
  '[role="tabpanel"]',
  '[aria-expanded]',
  '[aria-controls]',
  'button',
  'form',
  'video[autoplay]',
  'source[src=""]',
  'img[src=""]',
];

// containers whose *children* count reveals client-side injection
const CHILD_CHECKS = ['#__next', '.intro', '.features', '.letter-trail', 'body'];

const docs = {};
for (const [k, p] of Object.entries(files)) {
  try {
    docs[k] = new JSDOM(readFileSync(p, 'utf8')).window.document;
  } catch (err) {
    console.log(`(skip ${k}: ${err.message})`);
  }
}

const keys = Object.keys(docs);
const count = (doc, sel) => {
  try {
    return doc.querySelectorAll(sel).length;
  } catch {
    return 'ERR';
  }
};

const row = (label, vals) =>
  `${label.padEnd(34)} ${vals.map((v) => String(v).padStart(9)).join('')}`;

console.log(row('', keys));
console.log('--- total elements ---');
console.log(row('*', keys.map((k) => count(docs[k], '*'))));

console.log('--- tags ---');
for (const t of TAGS) console.log(row(t, keys.map((k) => count(docs[k], t))));

console.log('--- selectors ---');
for (const s of SELECTORS) console.log(row(s, keys.map((k) => count(docs[k], s))));

console.log('--- direct children ---');
for (const s of CHILD_CHECKS) {
  console.log(
    row(
      `${s} > *`,
      keys.map((k) => {
        const el = docs[k].querySelector(s);
        return el ? el.children.length : 'none';
      }),
    ),
  );
}

console.log('--- video sources (static vs rendered) ---');
for (const k of keys) {
  const vids = [...docs[k].querySelectorAll('video')];
  console.log(
    `${k}: ${vids.length} video(s) ` +
      JSON.stringify(
        vids.map((v) => ({
          src: (v.getAttribute('src') || '').slice(-42),
          srcs: [...v.querySelectorAll('source')].map((s) =>
            (s.getAttribute('src') || '').slice(-42),
          ),
          autoplay: v.hasAttribute('autoplay'),
          loop: v.hasAttribute('loop'),
          muted: v.hasAttribute('muted'),
        })),
      ),
  );
}

console.log('--- text presence (distinctive body copy) ---');
const PHRASES = ['Intuit Intelligence', 'agentic', 'done for you'];
for (const k of keys) {
  const txt = docs[k].body?.textContent || '';
  console.log(row(k, PHRASES.map((p) => (txt.includes(p) ? 'yes' : 'NO'))));
}
console.log(row('phrases', PHRASES));
