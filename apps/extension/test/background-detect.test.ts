/**
 * Background detect flow (background/index.ts's `popup/check` handler), exercised end to end
 * against the real @slop-alarm/core detectChunks pipeline with a fake `fetch`: one provider
 * request per chunk, a cache hit on the second run of the same text, JevError codes mapped onto
 * the TabResult UI states, and a missing key making zero network requests at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChromeMock } from './helpers/chrome-mock.js';

let chromeMock: ReturnType<typeof createChromeMock>;

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  chromeMock = createChromeMock();
  vi.stubGlobal('chrome', chromeMock);
});

async function flushPromises(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function getMessageListener() {
  await import('../src/background/index.js');
  const calls = chromeMock.runtime.onMessage.addListener.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0]![0] as (message: unknown, sender: unknown, sendResponse: (res: unknown) => void) => boolean;
}

function sendMessage(
  listener: (message: unknown, sender: unknown, sendResponse: (res: unknown) => void) => boolean,
  message: unknown,
  sender: unknown = {},
): Promise<unknown> {
  return new Promise((resolve) => {
    listener(message, sender, resolve);
  });
}

function longText(seed: string, words = 45): string {
  return Array.from({ length: words }, (_, i) => `${seed}${i}`).join(' ');
}

function fakeAnswers(overrides: Record<string, unknown> = {}) {
  return {
    ai_written: { type: 'noul', noul: 0.9 },
    tells: { type: 'score', score: 3, confidence: 0.9 },
    staging: { type: 'noul', noul: 0.9 },
    rhythm: { type: 'noul', noul: 0.1 },
    inflation: { type: 'noul', noul: 0.1 },
    formatting: { type: 'noul', noul: 0.1 },
    chat_residue: { type: 'noul', noul: 0.0 },
    specifics: { type: 'noul', noul: 0.0 },
    ...overrides,
  };
}

async function seedSettings(apiKey = 'test-key'): Promise<void> {
  await chromeMock.storage.local.set({
    settings: {
      provider: 'typesafe',
      apiKeys: { typesafe: apiKey, openrouter: '' },
      autoScan: false,
      alwaysShowPill: false,
      highlight: false,
      excludedHosts: [],
      autoScanDailyLimit: 100,
    },
  });
}

function mockTabPlumbing(chunks: Array<{ id: string; text: string }>): void {
  chromeMock.tabs.get.mockResolvedValue({ id: 5, url: 'https://example.com/article' } as never);
  chromeMock.tabs.sendMessage.mockImplementation(async (_tabId?: number, message?: unknown) => {
    if ((message as { type?: string } | undefined)?.type === 'extract') return { ok: true, chunks };
    return undefined;
  });
}

describe('popup/check: provider requests', () => {
  it('sends one provider request per chunk, and a second identical check is served entirely from cache', async () => {
    await seedSettings();
    const chunks = [
      { id: 'c0', text: longText('alpha') },
      { id: 'c1', text: longText('beta') },
    ];
    mockTabPlumbing(chunks);

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ model: 'jev-1.13.0', answers: fakeAnswers(), usage: { input_tokens: 42 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const listener = await getMessageListener();

    const first = await sendMessage(listener, { type: 'popup/check', tabId: 5 });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((first as { status: string }).status).toBe('result');

    const second = await sendMessage(listener, { type: 'popup/check', tabId: 5 });
    await flushPromises();
    // Still 2: the second run's chunks hash to the same cache keys and are served from cache.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((second as { status: string }).status).toBe('result');
  });

  it('missing key: zero network requests, and the result status is missing_key', async () => {
    await seedSettings(''); // no key saved
    mockTabPlumbing([{ id: 'c0', text: longText('gamma') }]);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const listener = await getMessageListener();
    const result = await sendMessage(listener, { type: 'popup/check', tabId: 5 });
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'missing_key', errorCode: 'missing_key' });
  });

  it('an invalid key (401) maps to the key_error UI state', async () => {
    await seedSettings();
    mockTabPlumbing([{ id: 'c0', text: longText('delta') }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, headers: { get: () => null }, json: async () => ({}) })),
    );

    const listener = await getMessageListener();
    const result = await sendMessage(listener, { type: 'popup/check', tabId: 5 });
    await flushPromises();

    expect(result).toMatchObject({ status: 'key_error', errorCode: 'invalid_key' });
  });

  it('an unrecognized 4xx (bad_request) maps to the retryable_error UI state', async () => {
    await seedSettings();
    mockTabPlumbing([{ id: 'c0', text: longText('epsilon') }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 418, headers: { get: () => null }, json: async () => ({}) })),
    );

    const listener = await getMessageListener();
    const result = await sendMessage(listener, { type: 'popup/check', tabId: 5 });
    await flushPromises();

    expect(result).toMatchObject({ status: 'retryable_error', errorCode: 'bad_request' });
  });

  it('records daily usage (totalChecks, inputTokens) after a successful manual check', async () => {
    await seedSettings();
    mockTabPlumbing([{ id: 'c0', text: longText('zeta') }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ model: 'jev-1.13.0', answers: fakeAnswers(), usage: { input_tokens: 77 } }),
      })),
    );

    const listener = await getMessageListener();
    await sendMessage(listener, { type: 'popup/check', tabId: 5 });
    await flushPromises();

    const { usage } = (await chromeMock.storage.local.get('usage')) as { usage: { totalChecks: number; autoScanChecks: number; inputTokens: number } };
    expect(usage.totalChecks).toBe(1);
    expect(usage.autoScanChecks).toBe(0); // manual check, never counted against the auto-scan limit
    expect(usage.inputTokens).toBe(77);
  });
});
