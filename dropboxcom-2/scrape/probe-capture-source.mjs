/**
 * Throwaway probe (gitignored): is the PRE-JS static response a complete enough
 * source of truth for codegen, or does it silently omit whole categories of
 * content?
 *
 * Element-count ratios are a bad proxy (a page can have 97% of the elements and
 * 5/31 of the images), so this measures each category separately, plus the
 * childless-container census that catches grids whose members are injected
 * client-side after hydration.
 *
 * Run: node scrape/probe-capture-source.mjs
 */
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const files = {
  static: 'scrape/raw/index.static.html',
  rendered: 'scrape/raw/index.html',
};

const ASSET_TAGS = ['img', 'video', 'source', 'iframe', 'picture', 'svg', 'canvas'];

function census(doc) {
  const out = {
    elements: doc.querySelectorAll('*').length,
    text: doc.body ? doc.body.textContent.replace(/\s+/g, ' ').trim().length : 0,
  };
  for (const tag of ASSET_TAGS) out[tag] = doc.querySelectorAll(tag).length;
  return out;
}

/**
 * Containers that exist in both documents but hold children in only one of
 * them. Keyed by a stable-ish class signature so the two docs can be compared
 * without relying on DOM order.
 */
function containerChildren(doc) {
  const map = new Map();
  for (const el of doc.querySelectorAll('div, ul, section, figure')) {
    if (!el.className || typeof el.className !== 'string') continue;
    const sig = `${el.tagName.toLowerCase()}.${el.className.trim().split(/\s+/).join('.')}`;
    const prev = map.get(sig) ?? { n: 0, children: 0 };
    map.set(sig, { n: prev.n + 1, children: prev.children + el.children.length });
  }
  return map;
}

const docs = {};
for (const [name, file] of Object.entries(files)) {
  docs[name] = new JSDOM(await readFile(file, 'utf8')).window.document;
}

const s = census(docs.static);
const r = census(docs.rendered);

console.log('category            static   rendered   ratio');
for (const key of Object.keys(s)) {
  const ratio = r[key] === 0 ? 'n/a' : (s[key] / r[key]).toFixed(3);
  const flag = ratio !== 'n/a' && Number(ratio) < 0.9 ? '  <-- static is short' : '';
  console.log(
    `${key.padEnd(20)}${String(s[key]).padStart(6)}${String(r[key]).padStart(11)}${String(ratio).padStart(8)}${flag}`,
  );
}

const sc = containerChildren(docs.static);
const rc = containerChildren(docs.rendered);
const emptied = [];
for (const [sig, rv] of rc) {
  const sv = sc.get(sig);
  if (!sv) continue;
  if (rv.children > 0 && sv.children === 0) {
    emptied.push({ sig, staticChildren: 0, renderedChildren: rv.children });
  }
}
emptied.sort((a, b) => b.renderedChildren - a.renderedChildren);

console.log(
  `\ncontainers present in BOTH but childless in static: ${emptied.length}`,
);
for (const e of emptied.slice(0, 25)) {
  console.log(`  ${String(e.renderedChildren).padStart(4)} children in rendered, 0 in static  ${e.sig}`);
}
