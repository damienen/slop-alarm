/**
 * Popup surfaces: the "no key" first state, the quiet provider/count footer that replaced the old
 * plan banner, auto-scan being refused (with a hint, no permission prompt) when no key is saved,
 * the "paused for today" note, and the "part of the page could not be checked" partial note.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings, TabResult, UsageDay } from '../src/background/state.js';

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

function baseUsage(overrides: Partial<UsageDay> = {}): UsageDay {
  return { date: '2026-01-01', autoScanChecks: 0, totalChecks: 0, inputTokens: 0, ...overrides };
}

interface StubOptions {
  settings: Settings;
  tab?: TabResult;
  usageToday?: UsageDay;
  autoScanPausedToday?: boolean;
  permissionGranted?: boolean;
}

function stubChrome(opts: StubOptions) {
  const sendMessage = vi.fn(async (msg: { type: string; patch?: Partial<Settings> }) => {
    if (msg.type === 'popup/getState') {
      return {
        tab: opts.tab,
        settings: opts.settings,
        restricted: false,
        usageToday: opts.usageToday ?? baseUsage(),
        autoScanPausedToday: opts.autoScanPausedToday ?? false,
      };
    }
    if (msg.type === 'popup/updateSettings') {
      opts.settings = { ...opts.settings, ...msg.patch };
      return opts.settings;
    }
    if (msg.type === 'popup/syncAutoScanPermission') return { ok: true };
    return undefined;
  });
  const permissionsRequest = vi.fn(async () => opts.permissionGranted ?? true);
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn(async () => [{ id: 5, url: 'https://example.com' }]),
      get: vi.fn(async () => ({ id: 5, url: 'https://example.com' })),
    },
    runtime: { sendMessage, openOptionsPage: vi.fn() },
    permissions: { request: permissionsRequest },
  });
  return { sendMessage, permissionsRequest };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.innerHTML = '<div id="app" role="main"></div>';
});

describe('popup: no key saved', () => {
  it('shows the "add API key" state instead of the check button', async () => {
    stubChrome({ settings: baseSettings() });
    await import('../src/popup/popup.js');
    await flushPromises();

    const html = document.getElementById('app')?.innerHTML ?? '';
    expect(html).toContain('Add API key');
    expect(html).not.toContain('Check this page');
  });

  it('"Add API key" opens the options page', async () => {
    stubChrome({ settings: baseSettings() });
    await import('../src/popup/popup.js');
    await flushPromises();

    const openOptionsPage = (chrome.runtime as unknown as { openOptionsPage: ReturnType<typeof vi.fn> }).openOptionsPage;
    document.querySelector<HTMLButtonElement>('[data-action="open-options"]')?.click();
    expect(openOptionsPage).toHaveBeenCalled();
  });
});

describe('popup: footer', () => {
  it('shows the provider name and today\'s check count once a key is saved', async () => {
    stubChrome({
      settings: baseSettings({ apiKeys: { typesafe: 'key', openrouter: '' } }),
      usageToday: baseUsage({ totalChecks: 4 }),
    });
    await import('../src/popup/popup.js');
    await flushPromises();

    const footer = document.querySelector('.footer')?.textContent ?? '';
    expect(footer).toContain('TypeSafe');
    expect(footer).toContain('4 checks today');
  });
});

describe('popup: auto-scan gating', () => {
  it('does not even render the auto-scan switch when no key is saved (so it cannot be turned on)', async () => {
    const { permissionsRequest } = stubChrome({ settings: baseSettings() });
    await import('../src/popup/popup.js');
    await flushPromises();

    expect(document.querySelector('[data-action="toggle-autoscan"]')).toBeNull();
    expect(permissionsRequest).not.toHaveBeenCalled();
  });

  it('turning the switch on with a key saved requests the <all_urls> permission from the click', async () => {
    const { permissionsRequest, sendMessage } = stubChrome({
      settings: baseSettings({ apiKeys: { typesafe: 'key', openrouter: '' } }),
    });
    await import('../src/popup/popup.js');
    await flushPromises();

    const toggle = document.querySelector<HTMLInputElement>('[data-action="toggle-autoscan"]');
    expect(toggle).not.toBeNull();
    toggle!.checked = true;
    toggle!.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    expect(permissionsRequest).toHaveBeenCalledWith({ origins: ['<all_urls>'] });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'popup/updateSettings', patch: { autoScan: true } }));
  });

  it('shows "Auto-scan paused for today" when the daily limit has been reached', async () => {
    stubChrome({
      settings: baseSettings({ apiKeys: { typesafe: 'key', openrouter: '' }, autoScan: true }),
      autoScanPausedToday: true,
    });
    await import('../src/popup/popup.js');
    await flushPromises();

    expect(document.getElementById('app')?.textContent).toContain('Auto-scan paused for today');
  });
});

describe('popup: result partial note', () => {
  it('shows "Part of the page could not be checked" when failedChunks > 0', async () => {
    stubChrome({
      settings: baseSettings({ apiKeys: { typesafe: 'key', openrouter: '' } }),
      tab: {
        status: 'result',
        mode: 'page',
        fetchedAt: Date.now(),
        detect: {
          result: { probability: 0.2, verdict: 'likely_human', confidence: 'medium', mixed: false, words: 300, chunks: [], tells: [] },
          failedChunks: 1,
        },
      },
    });
    await import('../src/popup/popup.js');
    await flushPromises();

    expect(document.getElementById('app')?.textContent).toContain('Part of the page could not be checked.');
  });
});

describe('popup: key error / retryable error states', () => {
  it('a key_error result shows "Open settings"', async () => {
    stubChrome({
      settings: baseSettings({ apiKeys: { typesafe: 'key', openrouter: '' } }),
      tab: { status: 'key_error', mode: 'page', fetchedAt: Date.now(), errorCode: 'invalid_key', errorMessage: 'bad key' },
    });
    await import('../src/popup/popup.js');
    await flushPromises();

    expect(document.querySelector('[data-action="open-options"]')?.textContent).toBe('Open settings');
  });

  it('a retryable_error result shows "Retry"', async () => {
    stubChrome({
      settings: baseSettings({ apiKeys: { typesafe: 'key', openrouter: '' } }),
      tab: { status: 'retryable_error', mode: 'page', fetchedAt: Date.now(), errorCode: 'network', errorMessage: 'offline' },
    });
    await import('../src/popup/popup.js');
    await flushPromises();

    expect(document.querySelector('[data-action="recheck"]')?.textContent).toBe('Retry');
  });
});
