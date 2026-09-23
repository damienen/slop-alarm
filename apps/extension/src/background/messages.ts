/**
 * One discriminated-union message protocol shared by background, content and popup/options/
 * onboarding pages. `ToBackground` messages are sent with chrome.runtime.sendMessage and answered
 * with a response. `ToContent` messages are sent with chrome.tabs.sendMessage; `extract` expects a
 * response, the others are fire-and-forget notifications.
 *
 * Privacy: `content/getSettings` and the `settingsUpdated` broadcast both carry `PublicSettings`
 * (no `apiKeys`), never `Settings`. A content script runs inside the page's world, so its key must
 * never be reachable there.
 */
import type { DetectChunk, DetectMode, JevProvider } from '@slop-alarm/core';
import type { PublicSettings, Settings, TabResult, UsageDay } from './state.js';

export type ToBackground =
  | { type: 'popup/getState'; tabId: number }
  | { type: 'popup/check'; tabId: number }
  | { type: 'popup/recheck'; tabId: number }
  | { type: 'popup/updateSettings'; patch: Partial<Settings> }
  | { type: 'popup/excludeHost'; host: string }
  | { type: 'popup/syncAutoScanPermission' }
  | { type: 'content/autoResult'; chunks: DetectChunk[]; url: string }
  | { type: 'content/excludeSite'; host: string }
  | { type: 'content/getSettings' }
  | { type: 'content/openOptions' }
  | { type: 'content/retryCheck' }
  | { type: 'options/getSettings' }
  | { type: 'options/testKey'; provider: JevProvider; apiKey: string }
  | { type: 'options/clearLocalData' };

export type ExtractResponse = { ok: true; chunks: DetectChunk[] } | { ok: false; reason: 'too_short' | 'excluded' };

export type ToContent =
  | { type: 'extract'; mode: Extract<DetectMode, 'page'> }
  | { type: 'showResult'; state: TabResult; isAuto: boolean }
  | { type: 'settingsUpdated'; settings: PublicSettings };

export interface PopupState {
  tab: TabResult | undefined;
  settings: Settings;
  restricted: boolean;
  usageToday: UsageDay;
  autoScanPausedToday: boolean;
}

export interface OptionsState {
  settings: Settings;
  usageToday: UsageDay;
}

export type TestKeyResult = { ok: true; model: string | null } | { ok: false; code: string; message: string };
