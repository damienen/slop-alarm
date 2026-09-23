import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChromeMock } from './helpers/chrome-mock.js';

let chromeMock: ReturnType<typeof createChromeMock>;

beforeEach(() => {
  vi.unstubAllGlobals();
  chromeMock = createChromeMock();
  vi.stubGlobal('chrome', chromeMock);
});

import {
  DEFAULT_SETTINGS,
  autoScanLimitReached,
  createResultCache,
  excludeHost,
  getSettings,
  getTabResult,
  getUsageToday,
  hasApiKey,
  localDateKey,
  recordCheck,
  setTabResult,
  toPublicSettings,
  updateSettings,
} from '../src/background/state.js';

describe('settings', () => {
  it('returns defaults when nothing has ever been stored', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults to the typesafe provider with both keys blank', () => {
    expect(DEFAULT_SETTINGS.provider).toBe('typesafe');
    expect(DEFAULT_SETTINGS.apiKeys).toEqual({ typesafe: '', openrouter: '' });
  });

  it('defaults the auto-scan daily limit to 100', () => {
    expect(DEFAULT_SETTINGS.autoScanDailyLimit).toBe(100);
  });

  it('is migration-safe: merges a partial/legacy settings object with current defaults', async () => {
    // Simulate an older install version that only ever wrote `autoScan`.
    await chromeMock.storage.local.set({ settings: { autoScan: true } });
    const settings = await getSettings();
    expect(settings.autoScan).toBe(true);
    expect(settings.alwaysShowPill).toBe(false);
    expect(settings.highlight).toBe(false);
    expect(settings.excludedHosts).toEqual([]);
    expect(settings.apiKeys).toEqual({ typesafe: '', openrouter: '' });
    expect(settings.provider).toBe('typesafe');
  });

  it('keeps one provider key when only the other is written', async () => {
    await updateSettings({ apiKeys: { typesafe: 'tk-1', openrouter: '' } });
    await updateSettings({ apiKeys: { typesafe: 'tk-1', openrouter: 'or-1' } });
    const settings = await getSettings();
    expect(settings.apiKeys).toEqual({ typesafe: 'tk-1', openrouter: 'or-1' });
  });

  it('updateSettings persists a merged patch without clobbering other fields', async () => {
    await updateSettings({ highlight: true });
    await updateSettings({ autoScan: true });
    const settings = await getSettings();
    expect(settings.highlight).toBe(true);
    expect(settings.autoScan).toBe(true);
  });

  it('excludeHost appends a host without duplicating it', async () => {
    await excludeHost('example.com');
    await excludeHost('example.com');
    const settings = await getSettings();
    expect(settings.excludedHosts).toEqual(['example.com']);
  });

  it('excludeHost normalizes a pasted URL and a bare "www." host to the same entry', async () => {
    await excludeHost('https://www.nytimes.com/section/cooking');
    await excludeHost('NYTimes.com');
    const settings = await getSettings();
    expect(settings.excludedHosts).toEqual(['nytimes.com']);
  });
});

describe('hasApiKey', () => {
  it('is false when the selected provider has no key', () => {
    expect(hasApiKey({ provider: 'typesafe', apiKeys: { typesafe: '', openrouter: 'x' } })).toBe(false);
  });

  it('is false for a whitespace-only key', () => {
    expect(hasApiKey({ provider: 'typesafe', apiKeys: { typesafe: '   ', openrouter: '' } })).toBe(false);
  });

  it('is true when the selected provider has a key', () => {
    expect(hasApiKey({ provider: 'openrouter', apiKeys: { typesafe: '', openrouter: 'or-key' } })).toBe(true);
  });
});

describe('toPublicSettings', () => {
  it('strips apiKeys and keeps everything else', () => {
    const full = { ...DEFAULT_SETTINGS, apiKeys: { typesafe: 'secret-key', openrouter: 'another-secret' }, autoScan: true };
    const pub = toPublicSettings(full);
    expect(pub).not.toHaveProperty('apiKeys');
    expect(JSON.stringify(pub)).not.toContain('secret');
    expect(pub.autoScan).toBe(true);
    expect(pub.provider).toBe('typesafe');
  });
});

describe('per-tab session result', () => {
  it('round-trips through storage.session, keyed by tab id', async () => {
    expect(await getTabResult(7)).toBeUndefined();
    await setTabResult(7, { status: 'idle', fetchedAt: 123 });
    expect(await getTabResult(7)).toEqual({ status: 'idle', fetchedAt: 123 });
    expect(await getTabResult(8)).toBeUndefined();
  });
});

describe('result cache', () => {
  function fakeResult(id: string) {
    return { id, words: 100, probability: 0.5, verdict: 'unclear' as const, confidence: 'low' as const, tells: [] };
  }

  it('a miss returns undefined', async () => {
    const cache = createResultCache(() => 1000);
    expect(await cache.get('nope')).toBeUndefined();
  });

  it('round-trips a value', async () => {
    const cache = createResultCache(() => 1000);
    await cache.set('a', fakeResult('c0'));
    expect(await cache.get('a')).toEqual(fakeResult('c0'));
  });

  it('expires an entry after 7 days', async () => {
    let now = 1_000_000;
    const cache = createResultCache(() => now);
    await cache.set('a', fakeResult('c0'));
    now += 7 * 24 * 60 * 60 * 1000 + 1;
    expect(await cache.get('a')).toBeUndefined();
  });

  it('does not expire an entry just under 7 days old', async () => {
    let now = 1_000_000;
    const cache = createResultCache(() => now);
    await cache.set('a', fakeResult('c0'));
    now += 7 * 24 * 60 * 60 * 1000 - 1000;
    expect(await cache.get('a')).toEqual(fakeResult('c0'));
  });

  it('evicts the oldest entries once the map exceeds 300, oldest-first', async () => {
    let now = 0;
    const cache = createResultCache(() => now);
    for (let i = 0; i < 300; i++) {
      now = i;
      await cache.set(`k${i}`, fakeResult(`c${i}`));
    }
    // One more push evicts the single oldest (k0).
    now = 300;
    await cache.set('k300', fakeResult('c300'));
    expect(await cache.get('k0')).toBeUndefined();
    expect(await cache.get('k1')).toEqual(fakeResult('c1'));
    expect(await cache.get('k300')).toEqual(fakeResult('c300'));

    const { cache: stored } = (await chromeMock.storage.local.get('cache')) as { cache: Record<string, unknown> };
    expect(Object.keys(stored)).toHaveLength(300);
  });

  it('never stores text, only the score object under a hash key', async () => {
    const cache = createResultCache(() => 1);
    await cache.set('deadbeef', fakeResult('c0'));
    const { cache: stored } = (await chromeMock.storage.local.get('cache')) as { cache: Record<string, { result: unknown }> };
    expect(Object.keys(stored)).toEqual(['deadbeef']);
    expect(JSON.stringify(stored)).not.toContain('text');
  });
});

describe('daily usage / auto-scan limit', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('localDateKey formats using local date parts', () => {
    const d = new Date(2026, 0, 5, 23, 59); // Jan 5 2026, local time
    expect(localDateKey(d.getTime())).toBe('2026-01-05');
  });

  it('getUsageToday starts at zero for a day with no recorded checks', async () => {
    const usage = await getUsageToday(1_000);
    expect(usage.autoScanChecks).toBe(0);
    expect(usage.totalChecks).toBe(0);
    expect(usage.inputTokens).toBe(0);
  });

  it('recordCheck accumulates totals and only counts auto-scan checks in autoScanChecks', async () => {
    const now = Date.parse('2026-05-01T12:00:00');
    await recordCheck({ isAuto: true, inputTokens: 100 }, now);
    await recordCheck({ isAuto: false, inputTokens: 50 }, now);
    const usage = await getUsageToday(now);
    expect(usage.totalChecks).toBe(2);
    expect(usage.autoScanChecks).toBe(1);
    expect(usage.inputTokens).toBe(150);
  });

  it('rolls over to a fresh day (injected clock) without carrying yesterday\'s count', async () => {
    const day1 = Date.parse('2026-05-01T12:00:00');
    const day2 = day1 + DAY_MS;
    await recordCheck({ isAuto: true, inputTokens: 10 }, day1);
    const usageDay1 = await getUsageToday(day1);
    expect(usageDay1.autoScanChecks).toBe(1);
    const usageDay2 = await getUsageToday(day2);
    expect(usageDay2.autoScanChecks).toBe(0);
    expect(usageDay2.totalChecks).toBe(0);
  });

  it('autoScanLimitReached is always false when the limit is null (no limit)', async () => {
    const now = Date.parse('2026-05-01T12:00:00');
    for (let i = 0; i < 10; i++) await recordCheck({ isAuto: true, inputTokens: 1 }, now);
    expect(await autoScanLimitReached(null, now)).toBe(false);
  });

  it('autoScanLimitReached flips true once the auto-scan count hits the limit', async () => {
    const now = Date.parse('2026-05-01T12:00:00');
    for (let i = 0; i < 4; i++) {
      expect(await autoScanLimitReached(5, now)).toBe(false);
      await recordCheck({ isAuto: true, inputTokens: 1 }, now);
    }
    // 4 recorded so far, limit 5: still not reached.
    expect(await autoScanLimitReached(5, now)).toBe(false);
    await recordCheck({ isAuto: true, inputTokens: 1 }, now);
    expect(await autoScanLimitReached(5, now)).toBe(true);
  });

  it('the limit resets automatically on the next local day', async () => {
    const day1 = Date.parse('2026-05-01T12:00:00');
    const day2 = day1 + DAY_MS;
    for (let i = 0; i < 5; i++) await recordCheck({ isAuto: true, inputTokens: 1 }, day1);
    expect(await autoScanLimitReached(5, day1)).toBe(true);
    expect(await autoScanLimitReached(5, day2)).toBe(false);
  });

  it('manual checks never count toward the auto-scan limit', async () => {
    const now = Date.parse('2026-05-01T12:00:00');
    for (let i = 0; i < 20; i++) await recordCheck({ isAuto: false, inputTokens: 1 }, now);
    expect(await autoScanLimitReached(5, now)).toBe(false);
  });
});
