/**
 * A pill-styled switch control, shared by the popup and options page (fix #4: bare checkboxes
 * read as unfinished). Markup only; the visual styling lives in src/ui/tokens.css (`.switch*`
 * rules) so both surfaces render an identical component. The underlying element is still a real
 * `<input type="checkbox" role="switch">`, so it stays keyboard-operable and gets a visible focus
 * ring for free from the shared CSS.
 */
export function switchControlHtml(action: string, checked: boolean, ariaLabel?: string): string {
  const label = ariaLabel ? ` aria-label="${ariaLabel.replace(/"/g, '&quot;')}"` : '';
  return `<span class="switch">
    <input type="checkbox" role="switch" class="switch-input" data-action="${action}"${label} ${checked ? 'checked' : ''} />
    <span class="switch-track"><span class="switch-thumb"></span></span>
  </span>`;
}

/** The control plus a clickable label, for a standalone toggle row (no separate description). */
export function switchRowHtml(action: string, checked: boolean, label: string): string {
  return `<label class="switch-row">
    <span>${label}</span>
    ${switchControlHtml(action, checked)}
  </label>`;
}
