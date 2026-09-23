/**
 * Outlines the blocks belonging to chunks whose probability reaches the "likely AI" band (SCORING.bands.ai,
 * see packages/core/src/scoring.ts SCORING.bands.ai). The highlight style has to live in the main
 * document (light DOM), since it targets the page's own elements rather than our shadow-DOM UI.
 */
const HIGHLIGHT_CLASS = 'slop-alarm-highlight';
const STYLE_ID = 'slop-alarm-highlight-style';

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `.${HIGHLIGHT_CLASS} {
    outline: 2px solid #F0541E !important;
    outline-offset: 2px;
    background: rgba(240, 84, 30, 0.08) !important;
    border-radius: 4px;
    transition: outline-color 0.15s ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .${HIGHLIGHT_CLASS} { transition: none; }
  }`;
  doc.head?.appendChild(style);
}

export function applyHighlight(elements: Element[]): void {
  if (elements.length === 0) return;
  const doc = elements[0]?.ownerDocument;
  if (doc) ensureStyle(doc);
  for (const el of elements) el.classList.add(HIGHLIGHT_CLASS);
}

export function clearHighlight(doc: Document = document): void {
  doc.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
}
