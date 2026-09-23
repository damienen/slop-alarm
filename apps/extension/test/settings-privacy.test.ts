/**
 * The API key must never reach a content script. Content scripts execute inside the page's own
 * world, so anything they can read, a compromised or malicious page can read too. This asserts it
 * at the message-protocol boundary (`content/getSettings`, and the `settingsUpdated` broadcast that
 * follows a settings change), not just at the `toPublicSettings` helper's type.
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

async function flushPromises(times = 8): Promise<void> {
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
  return new Promise((resolve) => listener(message, sender, resolve));
}

async function seedSecretKey(): Promise<void> {
  await chromeMock.storage.local.set({
    settings: {
      provider: 'typesafe',
      apiKeys: { typesafe: 'super-secret-typesafe-key', openrouter: 'super-secret-openrouter-key' },
      autoScan: false,
      alwaysShowPill: false,
      highlight: false,
      excludedHosts: [],
      autoScanDailyLimit: 100,
    },
  });
}

describe('content/getSettings never leaks the API key', () => {
  it('the response has no apiKeys field and no secret substring anywhere in it', async () => {
    await seedSecretKey();
    const listener = await getMessageListener();
    const res = await sendMessage(listener, { type: 'content/getSettings' });
    await flushPromises();

    expect(res).not.toHaveProperty('apiKeys');
    expect(JSON.stringify(res)).not.toContain('secret');
    // The rest of settings is still there for the content script to use.
    expect(res).toMatchObject({ provider: 'typesafe', autoScan: false });
  });

  it('a settingsUpdated broadcast to tabs also carries no apiKeys field', async () => {
    await seedSecretKey();
    chromeMock.tabs.query.mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
    const listener = await getMessageListener();

    await sendMessage(listener, { type: 'popup/updateSettings', patch: { highlight: true } });
    await flushPromises();

    const calls = chromeMock.tabs.sendMessage.mock.calls as unknown as Array<[number, { type: string; settings?: object }]>;
    const broadcasts = calls.filter(([, msg]) => msg?.type === 'settingsUpdated');
    expect(broadcasts.length).toBeGreaterThan(0);
    for (const [, msg] of broadcasts) {
      expect(msg.settings).not.toHaveProperty('apiKeys');
      expect(JSON.stringify(msg)).not.toContain('secret');
    }
  });

  it('options/getSettings (a trusted extension page, not a content script) DOES receive the keys', async () => {
    await seedSecretKey();
    const listener = await getMessageListener();
    const res = await sendMessage(listener, { type: 'options/getSettings' });
    await flushPromises();

    expect((res as { settings: { apiKeys: Record<string, string> } }).settings.apiKeys.typesafe).toBe('super-secret-typesafe-key');
  });
});
