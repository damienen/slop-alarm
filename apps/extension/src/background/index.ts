/**
 * MV3 service worker entry point. All listeners are registered synchronously at the top level, as
 * required for MV3 event pages: the worker can be killed and woken up at any time, and a listener
 * added inside an async callback would simply never fire on a cold wake-up.
 *
 * BYOK, no backend: a check calls `detectChunks` from @slop-alarm/core directly against the
 * provider the user chose, using the user's own API key. There is no install/token/entitlement,
 * so there is nothing to register, refresh on an alarm, or erase server-side.
 */
import { JEV_ERROR_COPY, JevError, chunkBlocks, countWords, detectChunks, sampleChunks, testKey, truncateChars, LIMITS } from '@slop-alarm/core';
import type { DetectChunk, DetectMode, JevErrorCode, JevProvider, ProviderConfig, Verdict } from '@slop-alarm/core';
import {
  autoScanLimitReached,
  clearAllTabResults,
  clearResultCache,
  clearTabResult,
  createResultCache,
  excludeHost as excludeHostSetting,
  getSettings,
  getTabResult,
  getUsageToday,
  hasApiKey,
  recordCheck,
  setTabResult,
  toPublicSettings,
  updateSettings,
} from './state.js';
import type { Settings, TabResult, TabStatus } from './state.js';
import { clearBadge, setBadgeChecking, setBadgeVerdict } from './badge.js';
import { removeAutoScanPermission, syncAutoScan, unregisterAutoScanScript } from './autoscan.js';
import { createContextMenu, SELECTION_MENU_ID } from './menus.js';
import { clearRequestToken, isLatestRequestToken, nextRequestToken } from './requestTracker.js';
import type { ExtractResponse, OptionsState, PopupState, TestKeyResult, ToBackground, ToContent } from './messages.js';

/** Only set (and only honoured) in a non-production build: see build.mjs. Redirects every provider
 * request to a fixture server, so e2e tests never need a real API key. */
declare const __E2E_PROVIDER_URL__: string;
const E2E_PROVIDER_URL: string = typeof __E2E_PROVIDER_URL__ === 'string' ? __E2E_PROVIDER_URL__ : '';

const resultCache = createResultCache();

// ---------- Listeners (registered synchronously, top level) ----------

chrome.runtime.onInstalled.addListener((details) => {
  void handleInstalled(details);
});

chrome.runtime.onStartup.addListener(() => {
  void syncAutoScan();
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'check-page' && tab?.id !== undefined) {
    void runPageCheck(tab.id, { showCard: true });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === SELECTION_MENU_ID && tab?.id !== undefined) {
    void runSelectionCheck(tab.id, info.selectionText ?? '');
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabResult(tabId);
  clearRequestToken(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url !== undefined) {
    // Navigated: previous result no longer applies.
    void clearBadge(tabId);
    void clearTabResult(tabId);
  }
});

chrome.runtime.onMessage.addListener((message: ToBackground, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err: unknown) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
  return true; // keep the message channel open for the async response
});

// ---------- Install / lifecycle ----------

async function handleInstalled(details: chrome.runtime.InstalledDetails): Promise<void> {
  createContextMenu();
  await syncAutoScan();
  if (details.reason === 'install') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
}

// ---------- Message router ----------

async function handleMessage(message: ToBackground, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case 'popup/getState':
      return getPopupState(message.tabId);
    case 'popup/check':
      return runPageCheck(message.tabId, { showCard: false });
    case 'popup/recheck':
      return runPageCheck(message.tabId, { showCard: false });
    case 'popup/updateSettings':
      return onSettingsChanged(message.patch);
    case 'popup/excludeHost':
      return excludeHostSetting(message.host).then(broadcastSettings);
    case 'popup/syncAutoScanPermission':
      await syncAutoScan();
      return { ok: true };
    case 'content/autoResult':
      return handleAutoResult(sender.tab?.id, message.chunks);
    case 'content/excludeSite':
      return excludeHostSetting(message.host).then(broadcastSettings);
    case 'content/getSettings':
      return toPublicSettings(await getSettings());
    case 'content/openOptions':
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    case 'content/retryCheck': {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return { ok: false };
      void runPageCheck(tabId, { showCard: true });
      return { ok: true };
    }
    case 'options/getSettings':
      return getOptionsState();
    case 'options/testKey':
      return runTestKey(message.provider, message.apiKey);
    case 'options/clearLocalData':
      await clearResultCache();
      await clearAllTabResults();
      return { ok: true };
    default:
      return undefined;
  }
}

async function onSettingsChanged(patch: Partial<Settings>): Promise<Settings> {
  const next = await updateSettings(patch);
  if (patch.autoScan !== undefined) {
    if (!patch.autoScan) await unregisterAutoScanScript();
    else await syncAutoScan();
  }
  await broadcastSettings(next);
  return next;
}

/** Only ever broadcasts PublicSettings to tabs: content scripts must never receive an API key. */
async function broadcastSettings(settings: Settings): Promise<Settings> {
  const tabs = await chrome.tabs.query({});
  const msg: ToContent = { type: 'settingsUpdated', settings: toPublicSettings(settings) };
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    chrome.tabs.sendMessage(tab.id, msg).catch(() => undefined);
  }
  return settings;
}

// ---------- Popup / options state ----------

async function getPopupState(tabId: number): Promise<PopupState> {
  const [tab, settings] = await Promise.all([getTabResult(tabId), getSettings()]);
  const chromeTab = await chrome.tabs.get(tabId).catch(() => undefined);
  const restricted = chromeTab?.url !== undefined && isRestrictedUrl(chromeTab.url);
  const [usageToday, autoScanPausedToday] = await Promise.all([getUsageToday(), autoScanLimitReached(settings.autoScanDailyLimit)]);
  return { tab, settings, restricted, usageToday, autoScanPausedToday };
}

async function getOptionsState(): Promise<OptionsState> {
  const [settings, usageToday] = await Promise.all([getSettings(), getUsageToday()]);
  return { settings, usageToday };
}

function isRestrictedUrl(url: string): boolean {
  return (
    !/^https?:\/\//.test(url) ||
    url.startsWith('https://chrome.google.com/webstore') ||
    url.startsWith('https://chromewebstore.google.com')
  );
}

// ---------- Provider plumbing ----------

/** In a non-production build with SLOP_E2E_PROVIDER_URL set, every provider request is redirected
 * there instead of the real provider, regardless of which provider is selected. Never true in a
 * --prod build: build.mjs refuses to build if the variable is set. */
function providerFetch(): typeof fetch {
  if (!E2E_PROVIDER_URL) return fetch;
  return ((_url: RequestInfo | URL, init?: RequestInit) => fetch(E2E_PROVIDER_URL, init)) as typeof fetch;
}

function providerConfigFor(settings: Settings): ProviderConfig {
  return { provider: settings.provider, apiKey: settings.apiKeys[settings.provider] ?? '' };
}

async function runTestKey(provider: JevProvider, apiKey: string): Promise<TestKeyResult> {
  try {
    const { model } = await testKey({ provider, apiKey }, { fetch: providerFetch() });
    return { ok: true, model };
  } catch (err) {
    const code = err instanceof JevError ? err.code : 'network';
    return { ok: false, code, message: JEV_ERROR_COPY[code] };
  }
}

function statusForErrorCode(code: JevErrorCode): TabStatus {
  if (code === 'missing_key') return 'missing_key';
  if (code === 'invalid_key' || code === 'no_credits') return 'key_error';
  return 'retryable_error';
}

// ---------- On-demand checks ----------

async function injectContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  } catch {
    return false;
  }
}

async function getTabUrl(tabId: number): Promise<string | undefined> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  return tab?.url;
}

/**
 * True when it is still safe to write `result` for this tab: no newer check has started for it
 * (request token) and the tab has not navigated to a different URL since the check started. Never
 * sends the URL anywhere; it is only compared locally.
 */
async function shouldCommit(tabId: number, token: number, startUrl: string | undefined): Promise<boolean> {
  if (!isLatestRequestToken(tabId, token)) return false;
  const currentUrl = await getTabUrl(tabId);
  if (startUrl !== undefined && currentUrl !== undefined && currentUrl !== startUrl) return false;
  return true;
}

/** Writes `result` for a tab, but only if it is still the freshest in-flight check for that tab
 * (see `shouldCommit`). A dropped (stale) result leaves whatever the newer check already wrote. */
async function commitResult(
  tabId: number,
  token: number,
  startUrl: string | undefined,
  result: TabResult,
  opts: { notify: boolean; isAuto: boolean; verdict?: Verdict },
): Promise<boolean> {
  if (!(await shouldCommit(tabId, token, startUrl))) return false;
  await setTabResult(tabId, result);
  if (opts.verdict) await setBadgeVerdict(tabId, opts.verdict);
  else await clearBadge(tabId);
  if (opts.notify) {
    chrome.tabs
      .sendMessage(tabId, { type: 'showResult', state: result, isAuto: opts.isAuto } satisfies ToContent)
      .catch(() => undefined);
  }
  return true;
}

async function runPageCheck(tabId: number, opts: { showCard: boolean }): Promise<TabResult> {
  const token = nextRequestToken(tabId);
  const startUrl = await getTabUrl(tabId);

  await setBadgeChecking(tabId);
  const checking: TabResult = { status: 'checking', mode: 'page', fetchedAt: Date.now() };
  await setTabResult(tabId, checking);

  const injected = await injectContentScript(tabId);
  if (!injected) {
    const result: TabResult = { status: 'restricted', fetchedAt: Date.now() };
    await commitResult(tabId, token, startUrl, result, { notify: false, isAuto: false });
    return result;
  }

  let extracted: ExtractResponse;
  try {
    extracted = (await chrome.tabs.sendMessage(tabId, { type: 'extract', mode: 'page' } satisfies ToContent)) as ExtractResponse;
  } catch {
    const result: TabResult = { status: 'restricted', fetchedAt: Date.now() };
    await commitResult(tabId, token, startUrl, result, { notify: false, isAuto: false });
    return result;
  }

  if (!extracted.ok) {
    const result: TabResult = { status: 'too_short', mode: 'page', fetchedAt: Date.now() };
    await commitResult(tabId, token, startUrl, result, { notify: opts.showCard, isAuto: false });
    return result;
  }

  return finishCheck(tabId, 'page', extracted.chunks, opts.showCard, token, startUrl, false);
}

async function runSelectionCheck(tabId: number, selectionText: string): Promise<TabResult> {
  const token = nextRequestToken(tabId);
  const startUrl = await getTabUrl(tabId);

  await setBadgeChecking(tabId);
  await setTabResult(tabId, { status: 'checking', mode: 'selection', fetchedAt: Date.now() });

  const blocks = selectionText
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  const words = countWords(selectionText);
  if (blocks.length === 0 || words < LIMITS.minWords) {
    const result: TabResult = { status: 'too_short', mode: 'selection', fetchedAt: Date.now() };
    const injected = await injectContentScript(tabId);
    await commitResult(tabId, token, startUrl, result, { notify: injected, isAuto: false });
    return result;
  }

  const chunks = sampleChunks(chunkBlocks(blocks), LIMITS.maxChunks.selection).map((c) => ({
    id: c.id,
    text: truncateChars(c.text),
  }));

  await injectContentScript(tabId);
  return finishCheck(tabId, 'selection', chunks, true, token, startUrl, false);
}

async function finishCheck(
  tabId: number,
  mode: DetectMode,
  chunks: DetectChunk[],
  showCard: boolean,
  token: number,
  startUrl: string | undefined,
  isAuto: boolean,
): Promise<TabResult> {
  const settings = await getSettings();
  let result: TabResult;
  let verdict: Verdict | undefined;

  if (!hasApiKey(settings)) {
    result = { status: 'missing_key', mode, errorCode: 'missing_key', fetchedAt: Date.now() };
  } else {
    try {
      const config = providerConfigFor(settings);
      const outcome = await detectChunks(config, chunks, { cache: resultCache, fetch: providerFetch() });
      verdict = outcome.result.verdict;
      result = { status: 'result', mode, detect: { result: outcome.result, failedChunks: outcome.failedChunks }, fetchedAt: Date.now() };
      await recordCheck({ isAuto, inputTokens: outcome.inputTokens });
    } catch (err) {
      const jevError = err instanceof JevError ? err : new JevError('network', 'Unexpected failure');
      result = { status: statusForErrorCode(jevError.code), mode, errorCode: jevError.code, errorMessage: JEV_ERROR_COPY[jevError.code], fetchedAt: Date.now() };
    }
  }

  await commitResult(tabId, token, startUrl, result, { notify: showCard, isAuto, verdict });
  return result;
}

// ---------- Auto-scan ----------

async function handleAutoResult(tabId: number | undefined, chunks: DetectChunk[]): Promise<TabResult | undefined> {
  if (tabId === undefined) return undefined;
  const settings = await getSettings();
  if (!settings.autoScan) return undefined;
  if (await autoScanLimitReached(settings.autoScanDailyLimit)) return undefined; // quiet: paused for today

  const token = nextRequestToken(tabId);
  const startUrl = await getTabUrl(tabId);
  await setTabResult(tabId, { status: 'checking', mode: 'auto', fetchedAt: Date.now() });

  if (!hasApiKey(settings)) {
    // Auto-scan with no key: stay quiet rather than spamming a card on every navigation.
    if (await shouldCommit(tabId, token, startUrl)) {
      await clearTabResult(tabId);
      await clearBadge(tabId);
    }
    return undefined;
  }

  try {
    const config = providerConfigFor(settings);
    const outcome = await detectChunks(config, chunks, { cache: resultCache, fetch: providerFetch() });
    await recordCheck({ isAuto: true, inputTokens: outcome.inputTokens });
    const result: TabResult = { status: 'result', mode: 'auto', detect: { result: outcome.result, failedChunks: outcome.failedChunks }, fetchedAt: Date.now() };
    const committed = await commitResult(tabId, token, startUrl, result, { notify: true, isAuto: true, verdict: outcome.result.verdict });
    return committed ? result : undefined;
  } catch {
    // Auto-scan stays quiet on any failure (missing key handled above, otherwise rate limit,
    // network, etc.): no card, no badge noise.
    if (await shouldCommit(tabId, token, startUrl)) {
      await clearTabResult(tabId);
      await clearBadge(tabId);
    }
    return undefined;
  }
}
