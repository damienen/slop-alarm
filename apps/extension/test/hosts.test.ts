import { describe, expect, it } from 'vitest';
import { hostCoveredByEntry, normalizeHost } from '../src/shared/hosts.js';

describe('normalizeHost', () => {
  it('lowercases', () => {
    expect(normalizeHost('Example.COM')).toBe('example.com');
  });

  it('strips a leading www.', () => {
    expect(normalizeHost('www.nytimes.com')).toBe('nytimes.com');
  });

  it('leaves a non-www subdomain alone', () => {
    expect(normalizeHost('cooking.nytimes.com')).toBe('cooking.nytimes.com');
  });

  it('strips a scheme, path, query and hash from a pasted URL', () => {
    expect(normalizeHost('https://www.nytimes.com/section/cooking?x=1#top')).toBe('nytimes.com');
  });

  it('strips a port', () => {
    expect(normalizeHost('example.com:8080')).toBe('example.com');
    expect(normalizeHost('https://example.com:8080/path')).toBe('example.com');
  });

  it('handles a bare host with no scheme and a trailing path', () => {
    expect(normalizeHost('example.com/some/path')).toBe('example.com');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeHost('   ')).toBe('');
  });
});

describe('hostCoveredByEntry', () => {
  it('an entry covers itself', () => {
    expect(hostCoveredByEntry('nytimes.com', 'nytimes.com')).toBe(true);
  });

  it('a bare-domain entry covers its www subdomain', () => {
    expect(hostCoveredByEntry('www.nytimes.com', 'nytimes.com')).toBe(true);
  });

  it('a bare-domain entry covers an arbitrary subdomain', () => {
    expect(hostCoveredByEntry('cooking.nytimes.com', 'nytimes.com')).toBe(true);
  });

  it('a subdomain entry does not cover its parent domain', () => {
    expect(hostCoveredByEntry('nytimes.com', 'cooking.nytimes.com')).toBe(false);
  });

  it('a subdomain entry does not cover an unrelated subdomain', () => {
    expect(hostCoveredByEntry('www.nytimes.com', 'cooking.nytimes.com')).toBe(false);
  });

  it('is case-insensitive and www-insensitive on both sides', () => {
    expect(hostCoveredByEntry('WWW.NYTimes.com', 'www.nytimes.com')).toBe(true);
  });

  it('rejects an unrelated host that merely shares a suffix string', () => {
    expect(hostCoveredByEntry('evilnytimes.com', 'nytimes.com')).toBe(false);
  });
});
