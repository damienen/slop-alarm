/**
 * Options page: the "Provider and API key" section. Covers selecting a provider, saving a key,
 * testing a key (success and the mapped error), and removing a key.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/background/state.js';

async function flushPromises(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    provider: 'typesafe',
    apiKeys: { typesafe: '', openrouter: '' },
    autoScan: false,
    alwaysShowPill: false,
    highlight: false,
    excludedHosts: [],
    autoScanDailyLimit: 100,
    ...overrides,
  };
}

function stubChrome(initial: Settings) {
  let settings = initial;
  const sendMessage = vi.fn(async (msg: { type: string; patch?: Partial<Settings>; provider?: string; apiKey?: string }) => {
    if (msg.type === 'options/getSettings') {
      return { settings, usageToday: { date: '2026-01-01', autoScanChecks: 0, totalChecks: 3, inputTokens: 900 } };
    }
    if (msg.type === 'popup/updateSettings') {
      settings = { ...settings, ...msg.patch, apiKeys: { ...settings.apiKeys, ...msg.patch?.apiKeys } };
      return settings;
    }
    if (msg.type === 'options/testKey') {
      if (msg.apiKey === 'good-key') return { ok: true, model: 'jev-1.13.0' };
      return { ok: false, code: 'invalid_key', message: 'The provider rejected your API key. Check it in settings.' };
    }
    if (msg.type === 'options/clearLocalData') return { ok: true };
    return undefined;
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  return { sendMessage, getSettings: () => settings };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
});

describe('options page: provider and API key', () => {
  it('shows TypeSafe selected by default with an empty key field', async () => {
    stubChrome(baseSettings());
    await import('../src/options/options.js');
    await flushPromises();

    const typesafeRadio = document.querySelector<HTMLInputElement>('input[name="provider"][value="typesafe"]');
    expect(typesafeRadio?.checked).toBe(true);
    const keyInput = document.getElementById('api-key') as HTMLInputElement;
    expect(keyInput.value).toBe('');
    expect(keyInput.type).toBe('password');
  });

  it('Show/Hide toggles the key input between password and text', async () => {
    stubChrome(baseSettings());
    await import('../src/options/options.js');
    await flushPromises();

    document.querySelector<HTMLButtonElement>('[data-action="toggle-key-visible"]')?.click();
    await flushPromises();
    expect((document.getElementById('api-key') as HTMLInputElement).type).toBe('text');

    document.querySelector<HTMLButtonElement>('[data-action="toggle-key-visible"]')?.click();
    await flushPromises();
    expect((document.getElementById('api-key') as HTMLInputElement).type).toBe('password');
  });

  it('Save persists the typed key via popup/updateSettings', async () => {
    const { sendMessage } = stubChrome(baseSettings());
    await import('../src/options/options.js');
    await flushPromises();

    const input = document.getElementById('api-key') as HTMLInputElement;
    input.value = 'my-new-key';
    document.querySelector<HTMLButtonElement>('[data-action="save-key"]')?.click();
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'popup/updateSettings', patch: { apiKeys: { typesafe: 'my-new-key', openrouter: '' } } }),
    );
    expect(document.querySelector('.save-status')?.textContent).toBe('Saved.');
  });

  it('Test key shows success with the model name for a valid key', async () => {
    stubChrome(baseSettings());
    await import('../src/options/options.js');
    await flushPromises();

    const input = document.getElementById('api-key') as HTMLInputElement;
    input.value = 'good-key';
    document.querySelector<HTMLButtonElement>('[data-action="test-key"]')?.click();
    await flushPromises();

    expect(document.querySelector('.key-status')?.textContent).toContain('Key works');
    expect(document.querySelector('.key-status')?.textContent).toContain('jev-1.13.0');
  });

  it('Test key shows the mapped error for an invalid key', async () => {
    stubChrome(baseSettings());
    await import('../src/options/options.js');
    await flushPromises();

    const input = document.getElementById('api-key') as HTMLInputElement;
    input.value = 'bad-key';
    document.querySelector<HTMLButtonElement>('[data-action="test-key"]')?.click();
    await flushPromises();

    expect(document.querySelector('.key-status')?.textContent).toContain('rejected your API key');
  });

  it('Remove key clears the stored key for the current provider', async () => {
    const { sendMessage } = stubChrome(baseSettings({ apiKeys: { typesafe: 'existing-key', openrouter: '' } }));
    await import('../src/options/options.js');
    await flushPromises();

    document.querySelector<HTMLButtonElement>('[data-action="remove-key"]')?.click();
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'popup/updateSettings', patch: { apiKeys: { typesafe: '', openrouter: '' } } }),
    );
    const input = document.getElementById('api-key') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('selecting OpenRouter switches the key field to OpenRouter\'s own (separately kept) key', async () => {
    stubChrome(baseSettings({ apiKeys: { typesafe: 'typesafe-key', openrouter: 'openrouter-key' } }));
    await import('../src/options/options.js');
    await flushPromises();

    const openrouterRadio = document.querySelector<HTMLInputElement>('input[name="provider"][value="openrouter"]');
    openrouterRadio!.checked = true;
    openrouterRadio!.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    const input = document.getElementById('api-key') as HTMLInputElement;
    expect(input.value).toBe('openrouter-key');
  });

  it('shows the day\'s usage total and an estimated cost', async () => {
    stubChrome(baseSettings());
    await import('../src/options/options.js');
    await flushPromises();

    const text = document.getElementById('app')?.textContent ?? '';
    expect(text).toMatch(/Today: 3 checks/);
  });

  it('Clear local data sends options/clearLocalData and shows a confirmation', async () => {
    const { sendMessage } = stubChrome(baseSettings());
    await import('../src/options/options.js');
    await flushPromises();

    document.querySelector<HTMLButtonElement>('[data-action="clear-data"]')?.click();
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'options/clearLocalData' }));
    expect(document.querySelector('.clear-status')?.textContent).toBe('Local data cleared.');
  });

  // Regression: every render() rebuilds the form, which used to wipe the typed key. Pressing
  // "Test key" (or "Show") and then "Save" stored an EMPTY key while reporting "Saved".
  it('keeps the typed key through Test key and Show, and saves that key', async () => {
    const { getSettings } = stubChrome(baseSettings());
    await import('../src/options/options.js');
    await flushPromises();
    const field = () => document.querySelector<HTMLInputElement>('#api-key')!;
    const click = (action: string) => document.querySelector<HTMLElement>(`[data-action="${action}"]`)!.click();

    field().value = 'good-key';
    click('test-key');
    await flushPromises();
    expect(document.body.textContent).toContain('Key works');
    expect(field().value).toBe('good-key');

    click('toggle-key-visible');
    await flushPromises();
    expect(field().value).toBe('good-key');

    click('save-key');
    await flushPromises();
    expect(getSettings().apiKeys.typesafe).toBe('good-key');
  });

  it('refuses to save an empty key instead of reporting success', async () => {
    const { getSettings } = stubChrome(baseSettings({ apiKeys: { typesafe: 'existing', openrouter: '' } }));
    await import('../src/options/options.js');
    await flushPromises();
    document.querySelector<HTMLInputElement>('#api-key')!.value = '   ';
    document.querySelector<HTMLElement>('[data-action="save-key"]')!.click();
    await flushPromises();
    expect(getSettings().apiKeys.typesafe).toBe('existing');
    expect(document.body.textContent).toContain('Paste a key first');
  });
});
