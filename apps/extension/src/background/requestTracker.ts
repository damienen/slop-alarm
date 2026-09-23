/**
 * Per-tab monotonically increasing request token, so an overlapping check (a re-check fired while
 * an earlier one is still in flight, or auto-scan racing an on-demand check) can never have its
 * slower, older response overwrite a newer result (docs/ARCHITECTURE.md section 5).
 *
 * Deliberately in-memory only: a token only needs to live as long as its in-flight request, and on
 * a service-worker restart there is no in-flight request left to protect, so nothing here needs to
 * survive worker sleep (contrast with TabResult and settings, which do and so live in
 * chrome.storage).
 */
const latestTokenByTab = new Map<number, number>();

/** Starts a new, latest, request for this tab and returns its token. */
export function nextRequestToken(tabId: number): number {
  const next = (latestTokenByTab.get(tabId) ?? 0) + 1;
  latestTokenByTab.set(tabId, next);
  return next;
}

/** True when `token` is still the most recently issued token for this tab, i.e. no newer check
 * has started since. */
export function isLatestRequestToken(tabId: number, token: number): boolean {
  return latestTokenByTab.get(tabId) === token;
}

/** Drops tracking for a tab, e.g. when it closes. Purely hygienic: leaving a stale entry behind
 * causes no incorrect behaviour, it just wastes a few bytes. */
export function clearRequestToken(tabId: number): void {
  latestTokenByTab.delete(tabId);
}
