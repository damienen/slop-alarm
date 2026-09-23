/**
 * Auto-scan eligibility rules (docs/ARCHITECTURE.md section 5). Pure functions that take plain
 * data (hostname, protocol, block texts) or a Document, so they can be unit tested under jsdom
 * without a real browser.
 */
import { countWords } from '@slop-alarm/core';
import { hostCoveredByEntry } from '../shared/hosts.js';

export const BUILTIN_EXCLUDED_HOSTS = new Set([
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'docs.google.com',
  'drive.google.com',
  'calendar.google.com',
  'web.whatsapp.com',
  'messenger.com',
  'paypal.com',
  'accounts.google.com',
]);

const BUILTIN_EXCLUDED_PREFIXES = ['bank.', 'secure.', 'login.', 'account.', 'signin.'];

export function isBuiltinExcludedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (BUILTIN_EXCLUDED_HOSTS.has(h)) return true;
  return BUILTIN_EXCLUDED_PREFIXES.some((p) => h.startsWith(p));
}

/**
 * Built-in exclusions keep their current, exact behaviour (isBuiltinExcludedHost, unchanged).
 * User-added exclusions are normalized (lowercase, no "www.") and cover their own subdomains: an
 * entry of "nytimes.com" excludes "www.nytimes.com" and "cooking.nytimes.com", but an entry of
 * "cooking.nytimes.com" does not exclude "nytimes.com" itself.
 */
export function isExcludedHost(hostname: string, userExcluded: string[]): boolean {
  const h = hostname.toLowerCase();
  if (isBuiltinExcludedHost(h)) return true;
  return userExcluded.some((entry) => hostCoveredByEntry(h, entry));
}

/** localhost, bare IPv4/IPv6 literals, and single-label intranet names (e.g. "printer"). */
export function isLocalOrIntranetHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h.includes(':')) return true; // IPv6 literal
  if (!h.includes('.')) return true; // single-label host, e.g. an intranet name
  return false;
}

/** At least LIMITS-worthy content: 250+ words spread across blocks that are each 25+ words. */
export function hasEnoughVisibleText(blockTexts: string[], minTotalWords = 250, minBlockWords = 25): boolean {
  const total = blockTexts
    .filter((text) => countWords(text) >= minBlockWords)
    .reduce((sum, text) => sum + countWords(text), 0);
  return total >= minTotalWords;
}

const CARD_AUTOCOMPLETE = new Set(['cc-number', 'cc-exp', 'cc-csc', 'cc-name']);
const CARD_HINT = /card[-_ ]?(number|num)|cvv|cvc|cc[-_]?num/i;

function looksLikeCreditCardInput(input: Element): boolean {
  const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
  if (CARD_AUTOCOMPLETE.has(autocomplete)) return true;
  const hints = [input.getAttribute('name'), input.getAttribute('id'), input.getAttribute('placeholder')]
    .filter((v): v is string => !!v)
    .join(' ');
  return CARD_HINT.test(hints);
}

/** True when an input the user would actually see (password or credit-card) is visible. */
export function hasVisibleSensitiveInput(doc: Document, isVisible: (el: Element) => boolean = defaultIsVisible): boolean {
  const inputs = Array.from(doc.querySelectorAll('input'));
  return inputs.some((input) => {
    const type = (input.getAttribute('type') || 'text').toLowerCase();
    const sensitive = type === 'password' || looksLikeCreditCardInput(input);
    return sensitive && isVisible(input);
  });
}

function defaultIsVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const win = el.ownerDocument.defaultView;
  if (!win) return true;
  const style = win.getComputedStyle(el);
  if (!style) return true;
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;
  return true;
}

export interface EligibilityInput {
  isTopFrame: boolean;
  protocol: string;
  hostname: string;
  blockTexts: string[];
  excludedHosts: string[];
  doc: Document;
  isVisible?: (el: Element) => boolean;
}

export function isEligibleForAutoScan(input: EligibilityInput): boolean {
  if (!input.isTopFrame) return false;
  if (input.protocol !== 'http:' && input.protocol !== 'https:') return false;
  if (isLocalOrIntranetHost(input.hostname)) return false;
  if (isExcludedHost(input.hostname, input.excludedHosts)) return false;
  if (!hasEnoughVisibleText(input.blockTexts)) return false;
  if (hasVisibleSensitiveInput(input.doc, input.isVisible)) return false;
  return true;
}
