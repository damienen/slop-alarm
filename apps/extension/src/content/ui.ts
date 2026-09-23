/**
 * The on-page pill + card, rendered inside a closed Shadow DOM so the host page's CSS can never
 * reach in and the extension's CSS can never leak out. All styling lives inside the shadow root.
 */
import { CONFIDENCE_COPY, DISCLAIMER, JEV_ERROR_COPY, TELL_COPY, VERDICT_COPY, percent } from '@slop-alarm/core';
import type { TellHit } from '@slop-alarm/core';
import type { TabDetect, TabResult } from '../background/state.js';
import { MARK_SVG } from '../ui/mark.js';
import { tellStrengthLabel } from '../ui/tells.js';

export interface UICallbacks {
  onToggleHighlight: (enabled: boolean) => void;
  onExcludeSite: () => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onRetry: () => void;
}

const TONE_COLOR: Record<string, string> = {
  ok: 'var(--slop-green)',
  warn: 'var(--slop-amber)',
  alert: 'var(--slop-alarm)',
  muted: 'var(--slop-muted)',
};

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
.wrap {
  --slop-ink: #14110F; --slop-paper: #FBF7F0; --slop-line: #E6DFD3; --slop-muted: #6B645B;
  --slop-alarm: #F0541E; --slop-amber: #D99A00; --slop-green: #2F9E6A;
  --slop-surface: var(--slop-paper); --slop-text: var(--slop-ink); --slop-border: var(--slop-line);
  position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  color: var(--slop-text);
}
@media (prefers-color-scheme: dark) {
  .wrap { --slop-surface: #211D1A; --slop-text: #F3EEE6; --slop-border: #352F2A; }
}
.pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 999px;
  background: var(--slop-surface); border: 1px solid var(--slop-border); box-shadow: 0 2px 10px rgba(0,0,0,0.18);
  cursor: pointer; font-size: 13px; font-weight: 600; color: var(--slop-text);
}
.pill:focus-visible, .card button:focus-visible, .card input:focus-visible {
  outline: 2px solid var(--slop-alarm); outline-offset: 2px;
}
.pill .mark { width: 16px; height: 16px; border-radius: 4px; background: #14110F; display: flex; align-items: center; justify-content: center; flex: none; }
.pill .mark svg { width: 10px; height: 10px; }
.pill .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.pill .pct { font-variant-numeric: tabular-nums; opacity: 0.75; }
.card {
  width: 320px; max-width: calc(100vw - 32px); background: var(--slop-surface); border: 1px solid var(--slop-border);
  border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.22); padding: 14px; font-size: 13px; line-height: 1.45;
}
.card[hidden], .pill[hidden] { display: none; }
.card h2 { font-size: 14px; margin: 0 0 2px; display: flex; align-items: center; gap: 6px; }
.card .pct-big { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 20px; }
.card .pct-caption { color: var(--slop-muted); font-size: 11px; margin: 0 0 8px; }
.card .detail { color: var(--slop-muted); margin: 6px 0 10px; }
.gauge { height: 6px; border-radius: 3px; background: linear-gradient(90deg, var(--slop-green), var(--slop-amber), var(--slop-alarm)); position: relative; margin: 8px 0; }
.gauge .marker { position: absolute; top: -3px; width: 3px; height: 12px; background: var(--slop-text); border-radius: 2px; transform: translateX(-1px); }
.confidence { color: var(--slop-muted); font-size: 12px; margin-bottom: 8px; }
.mixed-note, .partial-note { font-size: 12px; color: var(--slop-amber); margin-bottom: 8px; }
.tells { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.tells li { display: flex; flex-direction: column; gap: 2px; }
.tell-head { display: flex; justify-content: space-between; font-weight: 600; font-size: 12px; }
.tell-bar { height: 4px; border-radius: 2px; background: var(--slop-border); overflow: hidden; }
.tell-bar > span { display: block; height: 100%; background: var(--slop-alarm); }
.tell-detail { color: var(--slop-muted); font-size: 11.5px; }
.row { display: flex; align-items: center; justify-content: space-between; margin: 10px 0; }
.toggle-label { display: flex; align-items: center; gap: 6px; font-size: 12px; }
button { font: inherit; }
.btn { background: transparent; border: 1px solid var(--slop-border); color: var(--slop-text); border-radius: 8px; padding: 6px 10px; cursor: pointer; }
.btn:hover { background: var(--slop-border); }
.link-btn { background: none; border: none; color: var(--slop-muted); cursor: pointer; padding: 0; font-size: 12px; text-decoration: underline; }
.close { position: absolute; top: 10px; right: 10px; background: none; border: none; cursor: pointer; color: var(--slop-muted); font-size: 16px; line-height: 1; padding: 2px; }
.card { position: relative; }
.disclaimer { font-size: 11px; color: var(--slop-muted); margin-top: 10px; border-top: 1px solid var(--slop-border); padding-top: 8px; }
.footer-row { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

export class SlopAlarmUI {
  private host = document.createElement('div');
  private shadow: ShadowRoot;
  private wrap: HTMLDivElement;
  private pillEl: HTMLButtonElement;
  private cardEl: HTMLDivElement;
  private expanded = false;
  /** Whether the pill should show once the card is collapsed again (auto mode is quiet by default). */
  private pillVisibleWhenCollapsed = true;
  private callbacks: UICallbacks;
  private highlightEnabled: boolean;

  constructor(callbacks: UICallbacks, highlightEnabled: boolean) {
    this.callbacks = callbacks;
    this.highlightEnabled = highlightEnabled;
    this.host.id = 'slop-alarm-host';
    this.host.style.position = 'fixed';
    this.host.style.inset = '0';
    this.host.style.pointerEvents = 'none';
    this.shadow = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLE;
    this.shadow.appendChild(style);

    this.wrap = document.createElement('div');
    this.wrap.className = 'wrap';
    this.wrap.style.pointerEvents = 'auto';
    this.shadow.appendChild(this.wrap);

    this.pillEl = document.createElement('button');
    this.pillEl.className = 'pill';
    this.pillEl.type = 'button';
    this.pillEl.setAttribute('aria-haspopup', 'dialog');
    this.pillEl.addEventListener('click', () => this.toggleExpanded());
    this.wrap.appendChild(this.pillEl);

    this.cardEl = document.createElement('div');
    this.cardEl.className = 'card';
    this.cardEl.setAttribute('role', 'dialog');
    this.cardEl.setAttribute('aria-label', 'Slop Alarm result');
    this.cardEl.hidden = true;
    this.wrap.appendChild(this.cardEl);

    // Escape closes the card from anywhere inside it (the close button, the highlight toggle, the
    // "Don't show on this site" link), matching standard dialog behaviour.
    this.wrap.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.expanded) {
        event.stopPropagation();
        this.closeCard();
      }
    });

    (document.documentElement ?? document.body).appendChild(this.host);
  }

  /** The pill only ever shows while the card is collapsed, so it never floats above and covers
   * the card (or the page content behind it) once the card is open. */
  private syncPillVisibility(): void {
    this.pillEl.hidden = this.expanded || !this.pillVisibleWhenCollapsed;
  }

  private toggleExpanded(): void {
    if (this.expanded) {
      this.closeCard();
      return;
    }
    this.expanded = true;
    this.cardEl.hidden = false;
    this.syncPillVisibility();
    this.focusIntoCard();
  }

  /** Moves focus to the first focusable control in the card (its close button). Called whenever
   * the card opens, whether from a pill click or from a keyboard-triggered check (Alt+Shift+S,
   * the context-menu selection check) that shows the card straight away. */
  private focusIntoCard(): void {
    const closeBtn = this.cardEl.querySelector<HTMLButtonElement>('.close');
    closeBtn?.focus();
  }

  /** Collapses the card and returns focus to the pill, mirroring how it opened. No-op if the pill
   * itself is hidden (e.g. a quiet auto-scan result the user never chose to reveal). */
  private closeCard(): void {
    this.expanded = false;
    this.cardEl.hidden = true;
    this.syncPillVisibility();
    if (!this.pillEl.hidden) this.pillEl.focus();
    this.callbacks.onClose();
  }

  showPill(): void {
    this.pillVisibleWhenCollapsed = true;
    this.syncPillVisibility();
  }

  hidePill(): void {
    this.pillVisibleWhenCollapsed = false;
    this.syncPillVisibility();
  }

  expandCard(): void {
    this.expanded = true;
    this.cardEl.hidden = false;
    this.syncPillVisibility();
    this.focusIntoCard();
  }

  destroy(): void {
    this.host.remove();
  }

  renderChecking(): void {
    this.pillVisibleWhenCollapsed = true;
    this.syncPillVisibility();
    this.pillEl.innerHTML = `<span class="mark">${MARK_SVG}</span><span>Checking…</span>`;
    this.cardEl.innerHTML = '<p>Checking this page for AI writing…</p>';
  }

  renderState(state: TabResult, opts: { auto: boolean; showPillAlways: boolean }): void {
    if (state.status === 'result' && state.detect) {
      this.renderResult(state.detect, opts);
      return;
    }
    if (state.status === 'too_short') {
      this.renderMessage(VERDICT_COPY.too_short.label, VERDICT_COPY.too_short.detail, 'muted');
      return;
    }
    if (state.status === 'missing_key') {
      this.renderActionState('Add your API key', JEV_ERROR_COPY.missing_key, 'warn', 'Add API key', () => this.callbacks.onOpenSettings());
      return;
    }
    if (state.status === 'key_error') {
      const detail = state.errorMessage ?? JEV_ERROR_COPY[state.errorCode ?? 'invalid_key'];
      this.renderActionState('Key problem', detail, 'alert', 'Open settings', () => this.callbacks.onOpenSettings());
      return;
    }
    if (state.status === 'retryable_error') {
      const detail = state.errorMessage ?? JEV_ERROR_COPY[state.errorCode ?? 'network'];
      this.renderActionState('Could not check', detail, 'muted', 'Retry', () => this.callbacks.onRetry());
      return;
    }
    this.renderMessage('Something went wrong', state.errorMessage ?? 'Please try again.', 'muted');
  }

  private renderMessage(title: string, detail: string, tone: string): void {
    this.pillVisibleWhenCollapsed = true;
    this.syncPillVisibility();
    this.pillEl.innerHTML = `<span class="mark">${MARK_SVG}</span><span>${escapeHtml(title)}</span>`;
    this.cardEl.innerHTML = `
      <button class="close" aria-label="Close" type="button">&times;</button>
      <h2 style="color:${TONE_COLOR[tone] ?? 'var(--slop-text)'}" aria-live="polite">${escapeHtml(title)}</h2>
      <p class="detail">${escapeHtml(detail)}</p>
      <p class="disclaimer">${escapeHtml(DISCLAIMER)}</p>
    `;
    this.bindClose();
  }

  private renderActionState(title: string, detail: string, tone: string, actionLabel: string, onAction: () => void): void {
    this.pillVisibleWhenCollapsed = true;
    this.syncPillVisibility();
    this.pillEl.innerHTML = `<span class="mark">${MARK_SVG}</span><span>${escapeHtml(title)}</span>`;
    this.cardEl.innerHTML = `
      <button class="close" aria-label="Close" type="button">&times;</button>
      <h2 style="color:${TONE_COLOR[tone] ?? 'var(--slop-text)'}" aria-live="polite">${escapeHtml(title)}</h2>
      <p class="detail">${escapeHtml(detail)}</p>
      <div class="row"><button class="btn" type="button" id="slop-action">${escapeHtml(actionLabel)}</button></div>
      <p class="disclaimer">${escapeHtml(DISCLAIMER)}</p>
    `;
    this.bindClose();
    this.cardEl.querySelector<HTMLButtonElement>('#slop-action')?.addEventListener('click', onAction);
  }

  private renderResult(detect: TabDetect, opts: { auto: boolean; showPillAlways: boolean }): void {
    const { result } = detect;
    const copy = VERDICT_COPY[result.verdict];
    const color = TONE_COLOR[copy.tone] ?? 'var(--slop-text)';
    const isAiish = result.verdict === 'likely_ai' || result.verdict === 'very_likely_ai';
    const shouldShowPill = !opts.auto || opts.showPillAlways || isAiish;

    this.pillVisibleWhenCollapsed = shouldShowPill;
    this.syncPillVisibility();
    this.pillEl.innerHTML = `
      <span class="mark">${MARK_SVG}</span>
      <span class="dot" style="background:${color}"></span>
      <span>${escapeHtml(copy.short)}</span>
      <span class="pct">${escapeHtml(percent(result.probability))}</span>
    `;

    const pct = result.probability ?? 0;
    const tellsHtml = result.tells.length
      ? `<ul class="tells">${result.tells.map((t) => tellRow(t)).join('')}</ul>`
      : '';
    const mixedHtml = result.mixed ? `<p class="mixed-note">Different parts of this text read differently. Some look human, some look AI.</p>` : '';
    const partialHtml = detect.failedChunks > 0 ? `<p class="partial-note">Part of the page could not be checked.</p>` : '';

    this.cardEl.innerHTML = `
      <button class="close" aria-label="Close" type="button">&times;</button>
      <h2 style="color:${color}" aria-live="polite">${escapeHtml(copy.label)}
        <span class="pct-big">${escapeHtml(percent(result.probability))}</span>
      </h2>
      <p class="pct-caption">AI likelihood (estimate)</p>
      <p class="detail">${escapeHtml(copy.detail)}</p>
      <div class="gauge" role="img" aria-label="AI probability ${escapeHtml(percent(result.probability))}">
        <span class="marker" style="left:${Math.round(pct * 100)}%"></span>
      </div>
      <p class="confidence">${escapeHtml(CONFIDENCE_COPY[result.confidence])}</p>
      ${mixedHtml}
      ${partialHtml}
      ${tellsHtml}
      <div class="row">
        <label class="toggle-label">
          <input type="checkbox" id="slop-highlight-toggle" ${this.highlightEnabled ? 'checked' : ''} />
          Highlight passages
        </label>
      </div>
      <div class="footer-row">
        <button class="link-btn" type="button" id="slop-exclude-site">Don't show on this site</button>
      </div>
      <p class="disclaimer">${escapeHtml(DISCLAIMER)}</p>
    `;
    this.bindClose();
    const highlightToggle = this.cardEl.querySelector<HTMLInputElement>('#slop-highlight-toggle');
    highlightToggle?.addEventListener('change', () => {
      this.highlightEnabled = !!highlightToggle.checked;
      this.callbacks.onToggleHighlight(this.highlightEnabled);
    });
    const excludeBtn = this.cardEl.querySelector<HTMLButtonElement>('#slop-exclude-site');
    excludeBtn?.addEventListener('click', () => this.callbacks.onExcludeSite());
  }

  private bindClose(): void {
    const btn = this.cardEl.querySelector<HTMLButtonElement>('.close');
    btn?.addEventListener('click', () => this.closeCard());
  }
}

function tellRow(t: TellHit): string {
  const copy = TELL_COPY[t.family];
  return `<li>
    <div class="tell-head"><span>${escapeHtml(copy.label)}</span><span>${tellStrengthLabel(t.strength)}</span></div>
    <div class="tell-bar"><span style="width:${Math.round(t.strength * 100)}%"></span></div>
    <div class="tell-detail">${escapeHtml(copy.detail)}</div>
  </li>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
