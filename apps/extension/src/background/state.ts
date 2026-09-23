/**
 * chrome.storage.local (durable) and chrome.storage.session (per-tab, cleared on browser close)
 * helpers, plus settings defaults. Reads are migration-safe: missing keys fall back to defaults
 * rather than throwing, so an older install upgrading to a newer extension version never crashes.
 *
 * BYOK: there is no backend and no account. Settings, including the user's own provider API keys,
 * live ONLY in chrome.storage.local (never chrome.storage.sync, which syncs to Google's servers).
 * The per-chunk result cache and the daily usage counters also live here, under their own keys.
 */
import type { ChunkResult, DetectMode, DetectionResult, JevErrorCode, JevProvider } from '@slop-alarm/core';
import { normalizeHost } from '../shared/hosts.js';

// ---------- Settings ----------

export const AUTO_SCAN_DAILY_LIMIT_OPTIONS: Array<number | null> = [25, 50, 100, 250, 500, null];

export interface Settings {
  provider: JevProvider;
  /** Both providers' keys are kept, so switching providers never loses the other one's key. */
  apiKeys: Record<JevProvider, string>;
  autoScan: boolean;
  alwaysShowPill: boolean;
  highlight: boolean;
  excludedHosts: string[];
  /** Auto-scan checks per local day before auto-scan quietly pauses until tomorrow. `null` = no limit.
   * Manual (on-demand) checks are never limited. */
  autoScanDailyLimit: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'typesafe',
  apiKeys: { typesafe: '', openrouter: '' },
  autoScan: false,
  alwaysShowPill: false,
  highlight: false,
  excludedHosts: [],
  autoScanDailyLimit: 100,
};

/** Settings with the per-provider API keys stripped. This is the ONLY shape a content script may
 * ever receive (see background/index.ts's `content/getSettings` handler). A content script runs in
 * the page's world and a malicious/compromised page can reach anything it touches, so the key must
 * never cross that boundary. */
export type PublicSettings = Omit<Settings, 'apiKeys'>;

export function toPublicSettings(settings: Settings): PublicSettings {
  const { apiKeys: _apiKeys, ...rest } = settings;
  return rest;
}

export function hasApiKey(settings: Pick<Settings, 'provider' | 'apiKeys'>): boolean {
  return !!settings.apiKeys[settings.provider]?.trim();
}

// ---------- Result cache ----------
// A single chrome.storage.local key holds a hash -> {result, at} map. The key is a SHA-256 of the
// scoring version + model + text (see @slop-alarm/core's cacheKey); the text itself is never
// stored, only the score. Capped at CACHE_CAP entries (oldest `at` evicted first) with a 7-day
// expiry on read.

export interface CacheEntry {
  result: ChunkResult;
  at: number;
}
export type CacheMap = Record<string, CacheEntry>;

const CACHE_CAP = 300;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResultCache {
  get(key: string): Promise<ChunkResult | undefined>;
  set(key: string, value: ChunkResult): Promise<void>;
}

async function readCacheMap(): Promise<CacheMap> {
  const { cache } = await getLocal('cache');
  return cache ?? {};
}

async function writeCacheMap(map: CacheMap): Promise<void> {
  await setLocal({ cache: map });
}

/** `now` is injectable so eviction/expiry are deterministic in tests. */
export function createResultCache(now: () => number = Date.now): ResultCache {
  return {
    async get(key) {
      const map = await readCacheMap();
      const entry = map[key];
      if (!entry) return undefined;
      if (now() - entry.at > CACHE_TTL_MS) return undefined;
      return entry.result;
    },
    async set(key, value) {
      const map = await readCacheMap();
      map[key] = { result: value, at: now() };
      const keys = Object.keys(map);
      if (keys.length > CACHE_CAP) {
        const toEvict = keys.sort((a, b) => (map[a]?.at ?? 0) - (map[b]?.at ?? 0)).slice(0, keys.length - CACHE_CAP);
        for (const k of toEvict) delete map[k];
      }
      await writeCacheMap(map);
    },
  };
}

export async function clearResultCache(): Promise<void> {
  await chrome.storage.local.remove('cache');
}

// ---------- Daily usage (auto-scan spending guard) ----------

export interface UsageDay {
  date: string;
  autoScanChecks: number;
  totalChecks: number;
  inputTokens: number;
}

function emptyUsage(date: string): UsageDay {
  return { date, autoScanChecks: 0, totalChecks: 0, inputTokens: 0 };
}

/** The user's local calendar day, e.g. "2026-09-20". Deliberately local, not UTC: "today" should
 * match what the user sees on their own clock. */
export function localDateKey(now: number = Date.now()): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function getUsageToday(now: number = Date.now()): Promise<UsageDay> {
  const key = localDateKey(now);
  const { usage } = await getLocal('usage');
  if (!usage || usage.date !== key) return emptyUsage(key);
  return usage;
}

export async function recordCheck(opts: { isAuto: boolean; inputTokens: number }, now: number = Date.now()): Promise<UsageDay> {
  const current = await getUsageToday(now);
  const next: UsageDay = {
    ...current,
    totalChecks: current.totalChecks + 1,
    autoScanChecks: current.autoScanChecks + (opts.isAuto ? 1 : 0),
    inputTokens: current.inputTokens + Math.max(0, opts.inputTokens),
  };
  await setLocal({ usage: next });
  return next;
}

/** `null` limit means no limit. Auto-scan pauses (quietly) once today's auto-scan count reaches
 * the limit; it resumes automatically at local midnight, since `getUsageToday` resets on a new day. */
export async function autoScanLimitReached(limit: number | null, now: number = Date.now()): Promise<boolean> {
  if (limit === null) return false;
  const usage = await getUsageToday(now);
  return usage.autoScanChecks >= limit;
}

// ---------- chrome.storage.local ----------

export interface LocalState {
  settings: Settings;
  cache: CacheMap;
  usage: UsageDay;
}

type LocalKey = keyof LocalState;

export async function getLocal<K extends LocalKey>(...keys: K[]): Promise<Partial<Pick<LocalState, K>>> {
  const result = (await chrome.storage.local.get(keys)) as Partial<LocalState>;
  return result as Partial<Pick<LocalState, K>>;
}

export async function setLocal(patch: Partial<LocalState>): Promise<void> {
  await chrome.storage.local.set(patch);
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await getLocal('settings');
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...settings?.apiKeys },
    excludedHosts: settings?.excludedHosts ?? [],
  };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = { ...current, ...patch };
  await setLocal({ settings: next });
  return next;
}

/** Stores the host in its normalized form (lowercase, no scheme/path/port, no leading "www."). Used
 * by both the options page and the on-page "Don't show on this site" button, so entries added
 * either way compare the same way. */
export async function excludeHost(host: string): Promise<Settings> {
  const current = await getSettings();
  const normalized = normalizeHost(host);
  if (!normalized || current.excludedHosts.includes(normalized)) return current;
  return updateSettings({ excludedHosts: [...current.excludedHosts, normalized] });
}

// ---------- Per-tab session state ----------

export type TabStatus =
  | 'idle'
  | 'checking'
  | 'result'
  | 'too_short'
  | 'restricted'
  | 'missing_key'
  | 'key_error'
  | 'retryable_error';

export interface TabDetect {
  result: DetectionResult;
  /** Chunks that failed to check (e.g. one rate-limited request among several). */
  failedChunks: number;
}

export interface TabResult {
  status: TabStatus;
  mode?: DetectMode;
  detect?: TabDetect;
  errorCode?: JevErrorCode;
  errorMessage?: string;
  fetchedAt: number;
}

function tabKey(tabId: number): string {
  return `tab:${tabId}`;
}

export async function getTabResult(tabId: number): Promise<TabResult | undefined> {
  const key = tabKey(tabId);
  const result = (await chrome.storage.session.get(key)) as Record<string, TabResult | undefined>;
  return result[key];
}

export async function setTabResult(tabId: number, value: TabResult): Promise<void> {
  await chrome.storage.session.set({ [tabKey(tabId)]: value });
}

export async function clearTabResult(tabId: number): Promise<void> {
  await chrome.storage.session.remove(tabKey(tabId));
}

/** Wipes every per-tab result, not just one tab's. Used by "Clear local data" in options. */
export async function clearAllTabResults(): Promise<void> {
  await chrome.storage.session.clear();
}
