/**
 * Popup: check button, result for the current tab, auto-scan and per-site toggles, a quiet footer
 * (provider name + today's check count) in place of the old plan banner.
 */
import { CONFIDENCE_COPY, DISCLAIMER, JEV_ERROR_COPY, TELL_COPY, VERDICT_COPY, percent } from '@slop-alarm/core';
import type { TellHit } from '@slop-alarm/core';
import type { ToBackground } from '../background/messages.js';
import type { Settings, TabDetect, TabResult, UsageDay } from '../background/state.js';
import { DEFAULT_SETTINGS, hasApiKey } from '../background/state.js';
import { MARK_SVG } from '../ui/mark.js';
import { tellStrengthLabel } from '../ui/tells.js';
import { switchRowHtml } from '../ui/switch.js';

const app = document.getElementById('app') as HTMLDivElement;

let tabId: number | undefined;
let tabResult: TabResult | undefined;
let settings: Settings = DEFAULT_SETTINGS;
let usageToday: UsageDay = { date: '', autoScanChecks: 0, totalChecks: 0, inputTokens: 0 };
let autoScanPausedToday = false;
let restricted = false;
let hostname = '';
let busy = false;
let autoScanHint = '';

function send<T = unknown>(msg: ToBackground): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

async function resolveTargetTab(): Promise<chrome.tabs.Tab | undefined> {
  // Support ?tabId=<n> so e2e tests (and other automation) can point the popup at a specific tab
  // without relying on window-activation state, which headless/automated Chrome does not always
  // set the way a real user click does. Real popup opens never carry this query param.
  const override = new URLSearchParams(location.search).get('tabId');
  if (override) {
    const id = Number(override);
    if (Number.isFinite(id)) return chrome.tabs.get(id).catch(() => undefined);
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

type PopupStateResponse = {
  tab: TabResult | undefined;
  settings: Settings;
  restricted: boolean;
  usageToday: UsageDay;
  autoScanPausedToday: boolean;
};

async function init(): Promise<void> {
  const tab = await resolveTargetTab();
  tabId = tab?.id;
  try {
    hostname = tab?.url ? new URL(tab.url).hostname : '';
  } catch {
    hostname = '';
  }
  if (tabId === undefined) {
    render();
    return;
  }
  const state = await send<PopupStateResponse>({ type: 'popup/getState', tabId });
  applyState(state);
  render();
}

function applyState(state: PopupStateResponse): void {
  tabResult = state.tab;
  settings = state.settings;
  restricted = state.restricted;
  usageToday = state.usageToday;
  autoScanPausedToday = state.autoScanPausedToday;
}

async function refreshState(): Promise<void> {
  if (tabId === undefined) return;
  const state = await send<PopupStateResponse>({ type: 'popup/getState', tabId }).catch(() => undefined);
  if (state) {
    // Keep the just-returned check result if there is one; only usage/pause status needs a refresh.
    usageToday = state.usageToday;
    autoScanPausedToday = state.autoScanPausedToday;
    render();
  }
}

async function runCheck(): Promise<void> {
  if (tabId === undefined || busy || !hasApiKey(settings)) return;
  busy = true;
  tabResult = { status: 'checking', mode: 'page', fetchedAt: Date.now() };
  render();
  const result = await send<TabResult>({ type: 'popup/check', tabId });
  tabResult = result;
  busy = false;
  render();
  void refreshState();
}

async function updateSettings(patch: Partial<Settings>): Promise<void> {
  settings = await send<Settings>({ type: 'popup/updateSettings', patch });
  render();
}

async function onToggleAutoScan(enabled: boolean): Promise<void> {
  if (enabled) {
    if (!hasApiKey(settings)) {
      autoScanHint = 'Add an API key first, in Settings.';
      render();
      return;
    }
    // Must be requested directly inside this click handler (user gesture), not after a round
    // trip to the background.
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
    } catch {
      granted = false;
    }
    if (!granted) {
      render();
      return;
    }
  }
  autoScanHint = '';
  await updateSettings({ autoScan: enabled });
  await send({ type: 'popup/syncAutoScanPermission' });
}

async function excludeThisSite(): Promise<void> {
  if (!hostname) return;
  settings = await send<Settings>({ type: 'popup/excludeHost', host: hostname });
  render();
}

function providerLabel(provider: Settings['provider']): string {
  return provider === 'typesafe' ? 'TypeSafe' : 'OpenRouter';
}

function footerHtml(): string {
  const count = usageToday.totalChecks;
  return `
    <div class="footer">
      <button class="link-btn" data-action="open-options" style="background:none;border:none;color:var(--muted);text-decoration:underline;cursor:pointer;">Settings</button>
      <span>${escapeHtml(providerLabel(settings.provider))} &middot; ${count} check${count === 1 ? '' : 's'} today</span>
    </div>
    <p class="disclaimer">${escapeHtml(DISCLAIMER)}</p>
  `;
}

function header(): string {
  return `<div class="brand"><span class="mark">${MARK_SVG}</span> Slop Alarm</div>`;
}

function renderNoKey(): void {
  app.innerHTML = `
    ${header()}
    <div class="state-message">
      <p>Slop Alarm needs your own API key from TypeSafe or OpenRouter to check text. It is free: you only pay
      your provider, a fraction of a cent per check.</p>
      <button class="btn btn-primary" data-action="open-options">Add API key</button>
    </div>
  `;
}

function renderIdle(): void {
  app.innerHTML = `
    ${header()}
    <div class="state-idle">
      <button class="btn btn-primary big-btn" data-action="check">Check this page</button>
      <span class="shortcut-hint">Shortcut: Alt+Shift+S</span>
    </div>
    ${autoScanToggleHtml()}
    ${footerHtml()}
  `;
}

function renderRestricted(): void {
  app.innerHTML = `
    ${header()}
    <div class="state-message">
      <p>Chrome does not allow extensions to read this page.</p>
    </div>
    ${footerHtml()}
  `;
}

function renderChecking(): void {
  app.innerHTML = `
    ${header()}
    <div class="state-checking">
      <div class="spinner" role="status" aria-live="polite" aria-label="Checking"></div>
      <span>Checking this page…</span>
    </div>
    ${footerHtml()}
  `;
}

function tellRow(t: TellHit): string {
  const copy = TELL_COPY[t.family];
  return `<li>
    <div class="tell-head"><span>${escapeHtml(copy.label)}</span><span>${tellStrengthLabel(t.strength)}</span></div>
    <div class="tell-bar"><span style="width:${Math.round(t.strength * 100)}%"></span></div>
    <div class="tell-detail">${escapeHtml(copy.detail)}</div>
  </li>`;
}

function renderResult(detect: TabDetect): void {
  const { result } = detect;
  const copy = VERDICT_COPY[result.verdict];
  const pct = result.probability ?? 0;
  const tellsHtml = result.tells.length ? `<ul class="tells">${result.tells.map(tellRow).join('')}</ul>` : '';
  const mixedHtml = result.mixed
    ? `<p class="mixed-note">Different parts of this text read differently. Some look human, some look AI.</p>`
    : '';
  const partialHtml = detect.failedChunks > 0 ? `<p class="partial-note">Part of the page could not be checked.</p>` : '';
  app.innerHTML = `
    ${header()}
    <div>
      <div class="result-head">
        <h2 aria-live="polite">${escapeHtml(copy.label)}</h2>
        <span class="pct-big">${escapeHtml(percent(result.probability))}</span>
      </div>
      <p class="pct-caption">AI likelihood (estimate)</p>
      <p class="detail">${escapeHtml(copy.detail)}</p>
      <div class="gauge" role="img" aria-label="AI probability ${escapeHtml(percent(result.probability))}">
        <span class="marker" style="left:${Math.round(pct * 100)}%"></span>
      </div>
      <p class="confidence">${escapeHtml(CONFIDENCE_COPY[result.confidence])}</p>
      ${mixedHtml}
      ${partialHtml}
      ${tellsHtml}
      ${switchRowHtml('toggle-highlight', settings.highlight, 'Highlight passages on the page')}
      <div class="actions-row">
        <button class="btn" data-action="recheck">Re-check</button>
        <button class="btn" data-action="exclude-site">Don't show on this site</button>
      </div>
    </div>
    ${autoScanToggleHtml()}
    ${footerHtml()}
  `;
}

function renderTooShort(): void {
  app.innerHTML = `
    ${header()}
    <div class="state-message">
      <p>${escapeHtml(VERDICT_COPY.too_short.detail)}</p>
      <button class="btn" data-action="recheck">Try again</button>
    </div>
    ${footerHtml()}
  `;
}

function renderKeyState(title: string, detail: string, action: 'settings' | 'retry'): void {
  const btn =
    action === 'settings'
      ? `<button class="btn btn-primary" data-action="open-options">Open settings</button>`
      : `<button class="btn" data-action="recheck">Retry</button>`;
  app.innerHTML = `
    ${header()}
    <div class="state-message">
      <h2 aria-live="polite">${escapeHtml(title)}</h2>
      <p>${escapeHtml(detail)}</p>
      ${btn}
    </div>
    ${footerHtml()}
  `;
}

function autoScanToggleHtml(): string {
  const pausedNote =
    settings.autoScan && autoScanPausedToday
      ? `<p class="autoscan-note">Auto-scan paused for today (limit reached)</p>`
      : '';
  const hintNote = autoScanHint ? `<p class="autoscan-note">${escapeHtml(autoScanHint)}</p>` : '';
  return `${switchRowHtml('toggle-autoscan', settings.autoScan, 'Auto-scan articles')}${pausedNote}${hintNote}`;
}

function render(): void {
  if (restricted) return renderRestricted();
  if (!hasApiKey(settings)) return renderNoKey();
  if (!tabResult || tabResult.status === 'idle') return renderIdle();
  switch (tabResult.status) {
    case 'checking':
      return renderChecking();
    case 'result':
      return tabResult.detect ? renderResult(tabResult.detect) : renderIdle();
    case 'too_short':
      return renderTooShort();
    case 'missing_key':
      return renderKeyState('Add your API key', JEV_ERROR_COPY.missing_key, 'settings');
    case 'key_error':
      return renderKeyState('Key problem', tabResult.errorMessage ?? JEV_ERROR_COPY[tabResult.errorCode ?? 'invalid_key'], 'settings');
    case 'retryable_error':
      return renderKeyState('Could not check', tabResult.errorMessage ?? JEV_ERROR_COPY[tabResult.errorCode ?? 'network'], 'retry');
    case 'restricted':
      return renderRestricted();
    default:
      return renderKeyState('Something went wrong', 'Please try again.', 'retry');
  }
}

app.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target) return;
  const action = target.dataset['action'];
  switch (action) {
    case 'check':
      void runCheck();
      break;
    case 'recheck':
      void runCheck();
      break;
    case 'exclude-site':
      void excludeThisSite();
      break;
    case 'open-options':
      chrome.runtime.openOptionsPage();
      break;
    default:
      break;
  }
});

app.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  const action = target.dataset['action'];
  if (action === 'toggle-autoscan') void onToggleAutoScan(target.checked);
  if (action === 'toggle-highlight') void updateSettings({ highlight: target.checked });
});

void init();
