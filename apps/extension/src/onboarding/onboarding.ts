/**
 * Onboarding page, opened once on install (chrome.runtime.onInstalled, reason "install").
 * BYOK: this is where a new user picks a provider, pastes their key, and tests it, right in the
 * flow that explains why (free, no server, pennies per check).
 */
import type { JevProvider } from '@slop-alarm/core';
import type { OptionsState, TestKeyResult, ToBackground } from '../background/messages.js';
import { DEFAULT_SETTINGS } from '../background/state.js';
import type { Settings } from '../background/state.js';
import { MARK_SVG } from '../ui/mark.js';

const app = document.getElementById('app') as HTMLDivElement;

let settings: Settings = DEFAULT_SETTINGS;
let selectedMode: 'demand' | 'auto' = 'demand';
let autoScanConfirmation: 'granted' | 'denied' | null = null;
let keyVisible = false;
let saveStatus = '';
let testStatus: { state: 'idle' | 'busy' | 'ok' | 'error'; message?: string; model?: string } = { state: 'idle' };

function send<T = unknown>(msg: ToBackground): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

async function init(): Promise<void> {
  const state = await send<OptionsState>({ type: 'options/getSettings' });
  settings = state.settings;
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

async function testCurrentKey(): Promise<void> {
  const apiKey = currentKeyField()?.value.trim() ?? '';
  testStatus = { state: 'busy' };
  render();
  const res = await send<TestKeyResult>({ type: 'options/testKey', provider: settings.provider, apiKey });
  testStatus = res.ok ? { state: 'ok', model: res.model ?? 'unknown' } : { state: 'error', message: res.message };
  render();
}

async function chooseMode(mode: 'demand' | 'auto'): Promise<void> {
  selectedMode = mode;
  if (mode === 'auto') {
    // Requested directly inside this click handler (a real user gesture), not after a message
    // round trip to the background.
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
    } catch {
      granted = false;
    }
    if (!granted) {
      selectedMode = 'demand';
      autoScanConfirmation = 'denied';
      render();
      return;
    }
    autoScanConfirmation = 'granted';
    settings = await send<Settings>({ type: 'popup/updateSettings', patch: { autoScan: true } });
    await send({ type: 'popup/syncAutoScanPermission' });
  } else {
    autoScanConfirmation = null;
    settings = await send<Settings>({ type: 'popup/updateSettings', patch: { autoScan: false } });
  }
  render();
}

function autoScanConfirmHtml(): string {
  if (autoScanConfirmation === 'granted') {
    return `<p class="mode-confirm success">Auto-scan is on. You can turn it off any time in the popup.</p>`;
  }
  if (autoScanConfirmation === 'denied') {
    return `<p class="mode-confirm">No problem. Auto-scan stays off. You can enable it later in settings.</p>`;
  }
  return '';
}

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

function render(): void {
  const liveField = currentKeyField();
  if (resetDraft) {
    draftKey = null;
    resetDraft = false;
  } else if (liveField) {
    draftKey = liveField.value;
  }
  const currentKey = draftKey ?? settings.apiKeys[settings.provider] ?? '';
  app.innerHTML = `
    <div class="brand"><span class="mark">${MARK_SVG}</span> Slop Alarm</div>
    <p class="tagline">Tells you whether the text in front of you was likely written by AI. Plain estimate, not proof.</p>

    <section>
      <h2>What it does</h2>
      <p>Select some text, or open the toolbar icon, and Slop Alarm scores the writing on a scale from human to AI,
      and explains why: staged emphasis, rhythm-by-rule, inflated language, decorative formatting, or chatbot
      leftovers.</p>
    </section>

    <section>
      <h2>Bring your own key</h2>
      <p>Slop Alarm is free and has no server of its own. Instead of an account, you paste in your own API key from
      a provider, and the extension talks to that provider directly. Each check costs a fraction of a cent, billed
      to your own account there, not to us.</p>
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
          <button class="btn" type="button" data-action="test-key" ${testStatus.state === 'busy' ? 'disabled' : ''}>${
            testStatus.state === 'busy' ? 'Testing…' : 'Test key'
          }</button>
          <button class="btn btn-primary" type="button" data-action="save-key">Save</button>
        </div>
        <p class="key-status" role="status" aria-live="polite">${keyStatusHtml()}</p>
        <p class="save-status" role="status" aria-live="polite">${escapeHtml(saveStatus)}</p>
      </div>
    </section>

    <section>
      <h2>Exactly what gets sent</h2>
      <p>Only the text you check is ever sent, and only to the provider you chose above.</p>
      <ul class="privacy-list">
        <li>Never the page URL or title</li>
        <li>Never cookies or your browsing history</li>
        <li>Nothing to us, because there is no "us" server</li>
      </ul>
    </section>

    <section>
      <h2>Choose a mode</h2>
      <div class="mode-cards">
        <button class="mode-card ${selectedMode === 'demand' ? 'selected' : ''}" data-mode="demand" type="button">
          <h3>On demand (recommended to start)</h3>
          <p>Check a page or a selection whenever you want, from the toolbar, right-click menu, or Alt+Shift+S.</p>
        </button>
        <button class="mode-card ${selectedMode === 'auto' ? 'selected' : ''}" data-mode="auto" type="button">
          <h3>Auto-scan articles</h3>
          <p>Automatically checks eligible article pages and shows a quiet pill only when the result looks AI-written.
          Needs permission to read pages you visit, and has a daily check limit you can adjust in settings.</p>
        </button>
      </div>
      ${autoScanConfirmHtml()}
    </section>

    <div class="pin-hint">
      Tip: click the puzzle-piece icon in Chrome's toolbar and pin Slop Alarm so it is always one click away.
    </div>

    <div class="cta-row">
      <a class="btn btn-primary" href="sample.html" target="_blank" rel="noopener">Try it on a sample page</a>
    </div>
  `;
}

app.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-mode], [data-action]');
  if (!target) return;
  const mode = target.dataset['mode'];
  if (mode === 'demand' || mode === 'auto') {
    void chooseMode(mode);
    return;
  }
  const action = target.dataset['action'];
  switch (action) {
    case 'toggle-key-visible':
      toggleKeyVisible();
      break;
    case 'save-key':
      void saveKey();
      break;
    case 'test-key':
      void testCurrentKey();
      break;
    default:
      break;
  }
});

app.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.dataset['action'] === 'select-provider') void selectProvider(target.value as JevProvider);
});

void init();
