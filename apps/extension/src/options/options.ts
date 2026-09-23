/**
 * Options page: provider and API key (top), checking preferences, excluded sites, auto-scan daily
 * spending guard, privacy, and a "Clear local data" button. No accounts, no backend: everything
 * here is local to this browser.
 */
import type { JevProvider } from '@slop-alarm/core';
import type { OptionsState, TestKeyResult, ToBackground } from '../background/messages.js';
import { AUTO_SCAN_DAILY_LIMIT_OPTIONS, DEFAULT_SETTINGS } from '../background/state.js';
import type { Settings, UsageDay } from '../background/state.js';
import { MARK_SVG } from '../ui/mark.js';
import { switchControlHtml } from '../ui/switch.js';

const app = document.getElementById('app') as HTMLDivElement;

let settings: Settings = DEFAULT_SETTINGS;
let usageToday: UsageDay = { date: '', autoScanChecks: 0, totalChecks: 0, inputTokens: 0 };
let keyVisible = false;
let saveStatus = '';
let testStatus: { state: 'idle' | 'busy' | 'ok' | 'error'; message?: string; model?: string } = { state: 'idle' };
let clearBusy = false;
let clearStatus = '';

function send<T = unknown>(msg: ToBackground): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

async function init(): Promise<void> {
  const state = await send<OptionsState>({ type: 'options/getSettings' });
  settings = state.settings;
  usageToday = state.usageToday;
  render();
}

/**
 * What the user has typed into the key field but not saved yet. Every render() rebuilds the form
 * from a template string, so without this, pressing "Test key" or "Show" wiped the typed key and
 * "Save" then stored an empty one while reporting success.
 */
let draftKey: string | null = null;
/** Set before a render that must show the saved key instead (provider switched, key removed). */
let resetDraft = false;

function currentKeyField(): HTMLInputElement | null {
  return app.querySelector<HTMLInputElement>('[data-field="api-key"]');
}

async function selectProvider(provider: JevProvider): Promise<void> {
  settings = await send<Settings>({ type: 'popup/updateSettings', patch: { provider } });
  resetDraft = true;
  testStatus = { state: 'idle' };
  saveStatus = '';
  render();
}

function toggleKeyVisible(): void {
  keyVisible = !keyVisible;
  render();
}

async function saveKey(): Promise<void> {
  const value = currentKeyField()?.value.trim() ?? '';
  if (!value) {
    saveStatus = 'Paste a key first.';
    render();
    return;
  }
  settings = await send<Settings>({
    type: 'popup/updateSettings',
    patch: { apiKeys: { ...settings.apiKeys, [settings.provider]: value } },
  });
  saveStatus = 'Saved.';
  render();
  window.setTimeout(() => {
    saveStatus = '';
    render();
  }, 3000);
}

async function removeKey(): Promise<void> {
  resetDraft = true;
  settings = await send<Settings>({
    type: 'popup/updateSettings',
    patch: { apiKeys: { ...settings.apiKeys, [settings.provider]: '' } },
  });
  testStatus = { state: 'idle' };
  saveStatus = '';
  render();
}

async function testCurrentKey(): Promise<void> {
  const apiKey = currentKeyField()?.value.trim() ?? '';
  testStatus = { state: 'busy' };
  render();
  const res = await send<TestKeyResult>({ type: 'options/testKey', provider: settings.provider, apiKey });
  testStatus = res.ok ? { state: 'ok', model: res.model ?? 'unknown' } : { state: 'error', message: res.message };
  render();
  app.querySelector<HTMLButtonElement>('[data-action="test-key"]')?.focus();
}

async function updateSettings(patch: Partial<Settings>): Promise<void> {
  settings = await send<Settings>({ type: 'popup/updateSettings', patch });
  render();
}

async function onToggleAutoScan(enabled: boolean): Promise<void> {
  if (enabled) {
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
  await updateSettings({ autoScan: enabled });
  await send({ type: 'popup/syncAutoScanPermission' });
}

async function addExcludedHost(host: string): Promise<void> {
  // Normalization (scheme/path/port/"www." stripped, lowercased) happens centrally in
  // background/state.ts's excludeHost, so a pasted URL or a bare host both work here.
  if (!host.trim()) return;
  settings = await send<Settings>({ type: 'popup/excludeHost', host });
  render();
}

async function removeExcludedHost(host: string): Promise<void> {
  await updateSettings({ excludedHosts: settings.excludedHosts.filter((h) => h !== host) });
}

async function clearLocalData(): Promise<void> {
  clearBusy = true;
  clearStatus = '';
  render();
  await send({ type: 'options/clearLocalData' });
  clearBusy = false;
  clearStatus = 'Local data cleared.';
  render();
  window.setTimeout(() => {
    clearStatus = '';
    render();
  }, 3000);
}

// ---------- Rendering ----------

function providerCardHtml(id: JevProvider, name: string, blurb: string, linkHref: string, linkLabel: string): string {
  const checked = settings.provider === id;
  return `
    <label class="provider-card ${checked ? 'selected' : ''}">
      <input type="radio" name="provider" value="${id}" data-action="select-provider" ${checked ? 'checked' : ''} />
      <div>
        <div class="provider-name">${escapeHtml(name)}</div>
        <div class="desc">${escapeHtml(blurb)} <a href="${escapeHtml(linkHref)}" target="_blank" rel="noopener">${escapeHtml(linkLabel)}</a></div>
      </div>
    </label>
  `;
}

function keyStatusHtml(): string {
  if (testStatus.state === 'ok') return `Key works. Model: ${escapeHtml(testStatus.model ?? 'unknown')}`;
  if (testStatus.state === 'error') return escapeHtml(testStatus.message ?? '');
  return '';
}

function providerSectionHtml(): string {
  const liveField = currentKeyField();
  if (resetDraft) {
    draftKey = null;
    resetDraft = false;
  } else if (liveField) {
    draftKey = liveField.value;
  }
  const currentKey = draftKey ?? settings.apiKeys[settings.provider] ?? '';
  return `
    <section class="card">
      <h2>Provider and API key</h2>
      <div class="provider-cards" role="radiogroup" aria-label="Provider">
        ${providerCardHtml('typesafe', 'TypeSafe', 'Direct from the makers of Jev.', 'https://console.typesafe.ai/keys', 'Get a key at console.typesafe.ai/keys')}
        ${providerCardHtml('openrouter', 'OpenRouter', 'Use your existing OpenRouter credit.', 'https://openrouter.ai/keys', 'Get a key at openrouter.ai/keys')}
      </div>
      <div class="key-row">
        <label for="api-key">API key</label>
        <div class="key-field">
          <input id="api-key" type="${keyVisible ? 'text' : 'password'}" autocomplete="off" spellcheck="false"
            placeholder="Paste your key" value="${escapeHtml(currentKey)}" data-field="api-key" />
          <button class="btn" type="button" data-action="toggle-key-visible" aria-pressed="${keyVisible}">${keyVisible ? 'Hide' : 'Show'}</button>
        </div>
        <div class="key-actions">
          <button class="btn btn-primary" type="button" data-action="save-key">Save</button>
          <button class="btn" type="button" data-action="test-key" ${testStatus.state === 'busy' ? 'disabled' : ''}>${
            testStatus.state === 'busy' ? 'Testing…' : 'Test key'
          }</button>
          <button class="btn" type="button" data-action="remove-key">Remove key</button>
        </div>
        <p class="key-status ${testStatus.state === 'error' ? 'error-text' : testStatus.state === 'ok' ? 'success-text' : ''}" role="status" aria-live="polite">${keyStatusHtml()}</p>
        <p class="save-status success-text" role="status" aria-live="polite">${escapeHtml(saveStatus)}</p>
      </div>
      <p class="muted key-note">Your key is stored only in this browser. It is sent only to the provider you chose.
      Checks are billed to your provider account: about $0.00008 per 250 words, so roughly a hundred page checks
      cost one cent.</p>
    </section>
  `;
}

function autoScanLimitOptionHtml(value: number | null): string {
  const label = value === null ? 'No limit' : String(value);
  const optionValue = value === null ? 'none' : String(value);
  const selected = settings.autoScanDailyLimit === value ? 'selected' : '';
  return `<option value="${optionValue}" ${selected}>${escapeHtml(label)}</option>`;
}

function formatCost(inputTokens: number): string {
  const cost = (inputTokens / 1_000_000) * 0.042;
  return cost < 0.01 ? 'less than $0.01' : `about $${cost.toFixed(2)}`;
}

function usageTodayHtml(): string {
  const tokens = Math.round(usageToday.inputTokens);
  return `<p class="muted usage-today">Today: ${usageToday.totalChecks} check${usageToday.totalChecks === 1 ? '' : 's'}, about ${tokens.toLocaleString()} tokens (${formatCost(usageToday.inputTokens)}).</p>`;
}

function hostListHtml(): string {
  if (settings.excludedHosts.length === 0) return '<p class="muted" style="font-size:12px">No sites excluded.</p>';
  return `<ul class="host-list">${settings.excludedHosts
    .map((h) => `<li><span>${escapeHtml(h)}</span><button data-action="remove-host" data-host="${escapeHtml(h)}" aria-label="Remove ${escapeHtml(h)}">&times;</button></li>`)
    .join('')}</ul>`;
}

function render(): void {
  app.innerHTML = `
    <div class="brand"><span class="mark">${MARK_SVG}</span> Slop Alarm settings</div>

    ${providerSectionHtml()}

    <section class="card">
      <h2>Checking</h2>
      <div class="field-row">
        <div>
          <div>Auto-scan articles</div>
          <div class="desc">Automatically checks eligible article pages and shows a quiet pill when the result looks AI-written.</div>
        </div>
        ${switchControlHtml('toggle-autoscan', settings.autoScan, 'Auto-scan articles')}
      </div>
      <div class="field-row">
        <div>
          <div>Auto-scan daily limit</div>
          <div class="desc">Auto-scan pauses for the rest of the day once this many checks have run. Manual checks are never limited.</div>
        </div>
        <select data-field="autoscan-limit" aria-label="Auto-scan daily limit">${AUTO_SCAN_DAILY_LIMIT_OPTIONS.map(autoScanLimitOptionHtml).join('')}</select>
      </div>
      <div class="field-row">
        <div>
          <div>Always show the result</div>
          <div class="desc">Show the pill on every auto-scanned page, not only when it looks AI-written.</div>
        </div>
        ${switchControlHtml('toggle-always-pill', settings.alwaysShowPill, 'Always show the result')}
      </div>
      <div class="field-row">
        <div>
          <div>Highlight passages</div>
          <div class="desc">Outline the specific parts of a page that read as AI-written.</div>
        </div>
        ${switchControlHtml('toggle-highlight', settings.highlight, 'Highlight passages')}
      </div>
      ${usageTodayHtml()}
    </section>

    <section class="card">
      <h2>Excluded sites</h2>
      <p class="desc">Slop Alarm will not auto-scan these sites.</p>
      ${hostListHtml()}
      <div class="add-host-row">
        <input type="text" placeholder="example.com" data-field="new-host" />
        <button class="btn" data-action="add-host">Add</button>
      </div>
    </section>

    <section class="card privacy">
      <h2>Privacy</h2>
      <p>Text you check goes directly from your browser to the provider you chose. Slop Alarm has no server and
      collects nothing.</p>
      <div class="clear-data-row">
        <button class="btn" type="button" data-action="clear-data" ${clearBusy ? 'disabled' : ''}>${clearBusy ? 'Clearing…' : 'Clear local data'}</button>
        <p class="desc">Wipes the cached results and per-tab results stored on this device. Does not remove your API key or settings.</p>
        <p class="clear-status success-text" role="status" aria-live="polite">${escapeHtml(clearStatus)}</p>
      </div>
    </section>
  `;
}

app.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target) return;
  const action = target.dataset['action'];
  switch (action) {
    case 'toggle-key-visible':
      toggleKeyVisible();
      break;
    case 'save-key':
      void saveKey();
      break;
    case 'remove-key':
      void removeKey();
      break;
    case 'test-key':
      void testCurrentKey();
      break;
    case 'clear-data':
      void clearLocalData();
      break;
    case 'remove-host': {
      const host = target.dataset['host'];
      if (host) void removeExcludedHost(host);
      break;
    }
    case 'add-host': {
      const input = app.querySelector<HTMLInputElement>('[data-field="new-host"]');
      if (input?.value) {
        void addExcludedHost(input.value);
        input.value = '';
      }
      break;
    }
    default:
      break;
  }
});

app.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  const action = target.dataset['action'];
  const field = target.dataset['field'];
  if (action === 'toggle-autoscan') void onToggleAutoScan(target.checked);
  if (action === 'toggle-always-pill') void updateSettings({ alwaysShowPill: target.checked });
  if (action === 'toggle-highlight') void updateSettings({ highlight: target.checked });
  if (action === 'select-provider') void selectProvider(target.value as JevProvider);
  if (field === 'autoscan-limit') {
    const raw = target.value;
    void updateSettings({ autoScanDailyLimit: raw === 'none' ? null : Number(raw) });
  }
});

void init();
