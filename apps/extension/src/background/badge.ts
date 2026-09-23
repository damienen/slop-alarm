/**
 * Per-tab toolbar badge. Maps a verdict onto the palette from docs/ARCHITECTURE.md section 6.
 */
import type { Verdict } from '@slop-alarm/core';

const BADGE_BG: Partial<Record<Verdict, string>> = {
  very_likely_ai: '#F0541E',
  likely_ai: '#F0541E',
  unclear: '#D99A00',
  likely_human: '#2F9E6A',
};

const BADGE_TEXT: Partial<Record<Verdict, string>> = {
  very_likely_ai: 'AI',
  likely_ai: 'AI',
  unclear: '?',
  likely_human: 'OK',
};

export async function setBadgeChecking(tabId: number): Promise<void> {
  try {
    await chrome.action.setBadgeText({ tabId, text: '…' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#6B645B' });
  } catch {
    // tab may have closed already
  }
}

export async function setBadgeVerdict(tabId: number, verdict: Verdict): Promise<void> {
  const text = BADGE_TEXT[verdict];
  try {
    if (!text) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_BG[verdict] ?? '#6B645B' });
  } catch {
    // tab may have closed already
  }
}

export async function clearBadge(tabId: number): Promise<void> {
  try {
    await chrome.action.setBadgeText({ tabId, text: '' });
  } catch {
    // tab may have closed already
  }
}
