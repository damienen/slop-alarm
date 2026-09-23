/**
 * Text extraction (docs/ARCHITECTURE.md section 5). Pure functions that take a Document, so they
 * are testable under jsdom. Keeps light markdown (bold, headings, list items) so the formatting
 * question has something to see, and returns each block alongside the element it came from so the
 * caller can build a block-index → Element map for highlighting.
 */

const BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, dd, figcaption';
const SKIP_SELECTOR =
  'nav, aside, footer, header, form, [aria-hidden="true"], [contenteditable], [contenteditable=""], pre, code, script, style, noscript';
const NOISE_HINT = /comment|cookie|consent|newsletter|subscribe|advert|promo|sidebar|related|share|social/i;

export interface ExtractedBlock {
  text: string;
  element: Element;
}

function classAndId(el: Element): string {
  const cls = typeof el.className === 'string' ? el.className : '';
  return `${el.id || ''} ${cls}`;
}

function isNoiseContainer(el: Element): boolean {
  let node: Element | null = el;
  while (node) {
    if (NOISE_HINT.test(classAndId(node))) return true;
    node = node.parentElement;
  }
  return false;
}

export function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const win = el.ownerDocument.defaultView;
  if (!win) return true; // no layout engine (e.g. detached doc): assume visible
  const style = win.getComputedStyle(el);
  if (!style) return true;
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;
  return true;
}

/** Picks the main container: `article`, then `main`/`[role=main]`, then the element with the most paragraph text. */
export function findMainContainer(doc: Document): Element {
  const article = doc.querySelector('article');
  if (article && !article.closest(SKIP_SELECTOR)) return article;

  const main = doc.querySelector('main, [role="main"]');
  if (main) return main;

  let best: Element = doc.body;
  let bestLength = 0;
  doc.querySelectorAll('div, section').forEach((el) => {
    if (el.closest(SKIP_SELECTOR) || isNoiseContainer(el)) return;
    const text = Array.from(el.querySelectorAll('p'))
      .map((p) => p.textContent ?? '')
      .join(' ');
    if (text.length > bestLength) {
      bestLength = text.length;
      best = el;
    }
  });
  return best;
}

function hasBlockAncestor(el: Element, container: Element): boolean {
  let node = el.parentElement;
  while (node && node !== container) {
    if (node.matches(BLOCK_SELECTOR)) return true;
    node = node.parentElement;
  }
  return false;
}

function toMarkdown(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('strong, b').forEach((n) => {
    n.replaceWith(`**${(n.textContent ?? '').trim()}**`);
  });
  const text = (clone.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
  if (!text) return '';
  const tag = el.tagName.toLowerCase();
  if (/^h[1-4]$/.test(tag)) return `## ${text}`;
  if (tag === 'li') return `- ${text}`;
  return text;
}

/** Collects visible block text (with light markdown) from the main container, skipping noise. */
export function extractBlocks(doc: Document): ExtractedBlock[] {
  const container = findMainContainer(doc);
  const nodes = Array.from(container.querySelectorAll(BLOCK_SELECTOR));
  const blocks: ExtractedBlock[] = [];
  for (const el of nodes) {
    if (el.closest(SKIP_SELECTOR)) continue;
    if (isNoiseContainer(el)) continue;
    if (hasBlockAncestor(el, container)) continue;
    if (!isVisible(el)) continue;
    const text = toMarkdown(el);
    if (!text) continue;
    blocks.push({ text, element: el });
  }
  return blocks;
}
