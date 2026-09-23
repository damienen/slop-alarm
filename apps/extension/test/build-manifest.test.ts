/**
 * build.mjs's manifest generation and production guards: the extension must ship with EXACTLY the
 * two provider hosts (no e2e fixture host, no wildcard) and no SLOP_E2E_* environment variable may
 * survive into a --prod build. Exercised against the pure, exported functions directly - no
 * esbuild invocation or filesystem writes.
 *
 * Forced to the "node" environment (vitest.config.ts otherwise defaults every test file to
 * jsdom): build.mjs imports esbuild at module scope, and esbuild's own startup self-check
 * ("new TextEncoder().encode('') instanceof Uint8Array") fails under jsdom's patched globals.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PROVIDER_HOSTS, buildManifest, findE2EEnvVars, resolveE2EProviderOrigin, validateProdEnv } from '../build.mjs';

describe('buildManifest', () => {
  it('is pure: same inputs, same output', () => {
    const a = buildManifest({ version: '1.2.3' });
    const b = buildManifest({ version: '1.2.3' });
    expect(a).toEqual(b);
  });

  it('puts exactly the two provider hosts in host_permissions by default', () => {
    const manifest = buildManifest({ version: '1.0.0' });
    expect(manifest.host_permissions).toEqual(['https://api.typesafe.ai/*', 'https://openrouter.ai/*']);
  });

  it('appends extra hosts only when explicitly passed (the e2e fixture origin)', () => {
    const manifest = buildManifest({ version: '1.0.0', extraHosts: ['http://x.test/*'] });
    expect(manifest.host_permissions).toEqual([...PROVIDER_HOSTS, 'http://x.test/*']);
  });

  it('keeps optional_host_permissions to <all_urls> only, never a static grant', () => {
    const manifest = buildManifest({ version: '1.0.0' });
    expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
  });

  it('never requests the alarms permission (nothing in the extension uses chrome.alarms anymore)', () => {
    const manifest = buildManifest({ version: '1.0.0' });
    expect(manifest.permissions).toEqual(['storage', 'activeTab', 'scripting', 'contextMenus']);
  });
});

describe('resolveE2EProviderOrigin', () => {
  it('returns nothing when unset', () => {
    expect(resolveE2EProviderOrigin(undefined)).toEqual([]);
    expect(resolveE2EProviderOrigin('')).toEqual([]);
  });

  it('turns a provider URL into its origin match pattern', () => {
    expect(resolveE2EProviderOrigin('http://127.0.0.1:4000/v1/systemone')).toEqual(['http://127.0.0.1:4000/*']);
  });

  it('throws on an unparseable URL', () => {
    expect(() => resolveE2EProviderOrigin('not a url')).toThrow();
  });
});

describe('findE2EEnvVars', () => {
  it('returns nothing when no SLOP_E2E_* variable is set', () => {
    expect(findE2EEnvVars({ PATH: '/usr/bin', SLOP_E2E_FOO: '' })).toEqual([]);
  });

  it('finds every truthy SLOP_E2E_* variable, sorted', () => {
    expect(findE2EEnvVars({ SLOP_E2E_PROVIDER_URL: 'http://x.test', SLOP_E2E_BROWSER: '/edge', OTHER: 'x' })).toEqual([
      'SLOP_E2E_BROWSER',
      'SLOP_E2E_PROVIDER_URL',
    ]);
  });
});

describe('validateProdEnv', () => {
  it('throws when SLOP_E2E_PROVIDER_URL is set', () => {
    expect(() => validateProdEnv({ SLOP_E2E_PROVIDER_URL: 'http://x.test' })).toThrow(/SLOP_E2E_PROVIDER_URL/);
  });

  it('throws when any other SLOP_E2E_* variable is set', () => {
    expect(() => validateProdEnv({ SLOP_E2E_BROWSER: '/edge' })).toThrow(/SLOP_E2E_BROWSER/);
  });

  it('passes when nothing SLOP_E2E_* is set', () => {
    expect(() => validateProdEnv({ PATH: '/usr/bin' })).not.toThrow();
  });
});
