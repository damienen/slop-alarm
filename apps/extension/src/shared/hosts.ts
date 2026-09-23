/**
 * Canonical form for a user-supplied "excluded host" entry, shared by the eligibility check
 * (content/eligibility.ts) and by wherever an entry gets added (background/state.ts, reached from
 * both the options page and the on-page "Don't show on this site" button). Lowercase, no scheme,
 * path, query, port, or leading "www.". A bare hostname (e.g. from `location.hostname`) round-trips
 * unchanged apart from case and a leading "www.".
 */
export function normalizeHost(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let hostname: string;
  try {
    hostname = new URL(withScheme).hostname.toLowerCase();
  } catch {
    // Fall back to manual stripping for whatever the URL constructor rejected.
    hostname = (
      raw
        .toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
        .split(/[/?#]/)[0] ?? ''
    ).replace(/:\d+$/, '');
  }
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

/** True when `entry` (already or not yet normalized) covers `hostname`: an exact match, or
 * `hostname` is a subdomain of `entry`. Covering is one-directional: "cooking.nytimes.com" does
 * not cover "nytimes.com". */
export function hostCoveredByEntry(hostname: string, entry: string): boolean {
  const h = normalizeHost(hostname);
  const e = normalizeHost(entry);
  if (!h || !e) return false;
  return h === e || h.endsWith(`.${e}`);
}
