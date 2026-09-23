import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveProvider } from '../src/run.js';

// resolveProvider must never crash a keyless run: with no key at all it warns once and falls back
// to provider "typesafe" with an empty key, so the eval harness can still proceed entirely off the
// cached answers (see src/cache.ts). Any chunk that isn't cached fails later with askJev's own
// "missing_key" error, same as it always did.
describe('resolveProvider', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('prefers TYPESAFE_API_KEY when set', () => {
    process.env.TYPESAFE_API_KEY = 'ts-key';
    expect(resolveProvider(undefined)).toEqual({ provider: 'typesafe', apiKey: 'ts-key' });
  });

  it('falls back to OPENROUTER_API_KEY when TYPESAFE is unset', () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    expect(resolveProvider(undefined)).toEqual({ provider: 'openrouter', apiKey: 'or-key' });
  });

  it('respects an explicit --provider when its key is set', () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    expect(resolveProvider('openrouter')).toEqual({ provider: 'openrouter', apiKey: 'or-key' });
  });

  it('throws when an explicit --provider has no matching key', () => {
    expect(() => resolveProvider('typesafe')).toThrow(/TYPESAFE_API_KEY is not set/);
  });

  it('warns and returns a keyless typesafe config when neither key is set', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveProvider(undefined)).toEqual({ provider: 'typesafe', apiKey: '' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/using cached responses only/);
  });
});
