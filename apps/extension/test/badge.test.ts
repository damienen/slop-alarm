import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChromeMock } from './helpers/chrome-mock.js';

let chromeMock: ReturnType<typeof createChromeMock>;

beforeEach(() => {
  vi.unstubAllGlobals();
  chromeMock = createChromeMock();
  vi.stubGlobal('chrome', chromeMock);
});

import { clearBadge, setBadgeChecking, setBadgeVerdict } from '../src/background/badge.js';

describe('badge', () => {
  it('shows an ellipsis on a muted background while checking', async () => {
    await setBadgeChecking(1);
    expect(chromeMock.action.setBadgeText).toHaveBeenCalledWith({ tabId: 1, text: '…' });
    expect(chromeMock.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 1, color: '#6B645B' });
  });

  it('maps very_likely_ai and likely_ai to AI on the alarm color', async () => {
    await setBadgeVerdict(1, 'very_likely_ai');
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 1, text: 'AI' });
    expect(chromeMock.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ tabId: 1, color: '#F0541E' });

    await setBadgeVerdict(1, 'likely_ai');
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 1, text: 'AI' });
    expect(chromeMock.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ tabId: 1, color: '#F0541E' });
  });

  it('maps unclear to ? on amber', async () => {
    await setBadgeVerdict(1, 'unclear');
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 1, text: '?' });
    expect(chromeMock.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ tabId: 1, color: '#D99A00' });
  });

  it('maps likely_human to OK on green', async () => {
    await setBadgeVerdict(1, 'likely_human');
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 1, text: 'OK' });
    expect(chromeMock.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ tabId: 1, color: '#2F9E6A' });
  });

  it('clears the badge for too_short', async () => {
    await setBadgeVerdict(1, 'too_short');
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 1, text: '' });
  });

  it('clearBadge empties the text', async () => {
    await clearBadge(2);
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 2, text: '' });
  });
});
