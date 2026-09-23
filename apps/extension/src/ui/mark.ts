/**
 * Shared inline brand mark (siren dome + three rays), used by the popup, options, onboarding and
 * the on-page pill/card so the mark never drifts between surfaces. Kept bold and simple so it
 * still reads clearly at 16px: a flat-bottomed dome on a short base bar, three thick rays with
 * clear gaps between them and the dome.
 */
export const MARK_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M6 17A6 6 0 0 1 18 17Z" fill="#F0541E"/>
  <rect x="4.5" y="16" width="15" height="2.6" rx="1.3" fill="#F0541E"/>
  <g stroke="#F0541E" stroke-width="2" stroke-linecap="round">
    <line x1="12" y1="7" x2="12" y2="3"/>
    <line x1="6.5" y1="9" x2="3.5" y2="5"/>
    <line x1="17.5" y1="9" x2="20.5" y2="5"/>
  </g>
</svg>`;
