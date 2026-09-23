import { describe, expect, it } from 'vitest';
import { clearRequestToken, isLatestRequestToken, nextRequestToken } from '../src/background/requestTracker.js';

describe('requestTracker', () => {
  it('the first token issued for a tab is the latest', () => {
    const tabId = 101;
    const token = nextRequestToken(tabId);
    expect(isLatestRequestToken(tabId, token)).toBe(true);
  });

  it('a newer token invalidates an older one for the same tab (overlapping checks)', () => {
    const tabId = 102;
    const first = nextRequestToken(tabId);
    const second = nextRequestToken(tabId);
    expect(first).not.toBe(second);
    expect(isLatestRequestToken(tabId, first)).toBe(false);
    expect(isLatestRequestToken(tabId, second)).toBe(true);
  });

  it('tokens are tracked independently per tab', () => {
    const tabA = 201;
    const tabB = 202;
    nextRequestToken(tabA); // tabA's stale first token (value 1)
    const latestA = nextRequestToken(tabA); // tabA's latest (value 2)
    const latestB = nextRequestToken(tabB); // tabB's latest (value 1) — same numeric value as tabA's stale one
    expect(isLatestRequestToken(tabA, latestA)).toBe(true);
    expect(isLatestRequestToken(tabB, latestB)).toBe(true);
    // A token value that is current for tabB (1) must never be mistaken for a current token on
    // tabA, even though tabA once issued that same numeric value itself (as a now-stale token).
    expect(isLatestRequestToken(tabA, latestB)).toBe(false);
  });

  it('a tab with no tracked token is never "latest" for any token', () => {
    expect(isLatestRequestToken(9999, 1)).toBe(false);
  });

  it('clearRequestToken removes tracking, so any later token check for it is false', () => {
    const tabId = 301;
    const token = nextRequestToken(tabId);
    expect(isLatestRequestToken(tabId, token)).toBe(true);
    clearRequestToken(tabId);
    expect(isLatestRequestToken(tabId, token)).toBe(false);
  });
});
