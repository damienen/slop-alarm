import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  hasEnoughVisibleText,
  hasVisibleSensitiveInput,
  isBuiltinExcludedHost,
  isEligibleForAutoScan,
  isExcludedHost,
  isLocalOrIntranetHost,
} from '../src/content/eligibility.js';

function makeDoc(html = '<body></body>'): Document {
  return new JSDOM(html).window.document;
}

describe('hasEnoughVisibleText', () => {
  it('requires at least 250 words spread across blocks of 25+ words', () => {
    const bigBlock = 'word '.repeat(260).trim();
    expect(hasEnoughVisibleText([bigBlock])).toBe(true);
  });

  it('ignores blocks under the 25-word floor', () => {
    const tinyBlocks = Array.from({ length: 20 }, () => 'too short');
    expect(hasEnoughVisibleText(tinyBlocks)).toBe(false);
  });

  it('rejects a page with too little qualifying text', () => {
    expect(hasEnoughVisibleText(['just a short paragraph of a dozen words or so here'])).toBe(false);
  });
});

describe('host rules', () => {
  it('flags built-in webmail/docs/banking-style hosts', () => {
    expect(isBuiltinExcludedHost('mail.google.com')).toBe(true);
    expect(isBuiltinExcludedHost('docs.google.com')).toBe(true);
    expect(isBuiltinExcludedHost('secure.example.com')).toBe(true);
    expect(isBuiltinExcludedHost('login.example.com')).toBe(true);
    expect(isBuiltinExcludedHost('bank.example.com')).toBe(true);
    expect(isBuiltinExcludedHost('news.example.com')).toBe(false);
  });

  it('respects the user exclusion list', () => {
    expect(isExcludedHost('blog.example.com', ['blog.example.com'])).toBe(true);
    expect(isExcludedHost('blog.example.com', [])).toBe(false);
  });

  it('a user-excluded bare domain also covers its www and other subdomains', () => {
    expect(isExcludedHost('www.nytimes.com', ['nytimes.com'])).toBe(true);
    expect(isExcludedHost('cooking.nytimes.com', ['nytimes.com'])).toBe(true);
  });

  it('a user-excluded subdomain does not cover its parent domain', () => {
    expect(isExcludedHost('nytimes.com', ['cooking.nytimes.com'])).toBe(false);
  });

  it('user exclusion matching is case-insensitive', () => {
    expect(isExcludedHost('WWW.Example.com', ['example.com'])).toBe(true);
  });

  it('flags localhost, IP literals and single-label intranet hosts', () => {
    expect(isLocalOrIntranetHost('localhost')).toBe(true);
    expect(isLocalOrIntranetHost('127.0.0.1')).toBe(true);
    expect(isLocalOrIntranetHost('192.168.1.20')).toBe(true);
    expect(isLocalOrIntranetHost('printer')).toBe(true);
    expect(isLocalOrIntranetHost('news.example.com')).toBe(false);
  });
});

describe('hasVisibleSensitiveInput', () => {
  it('detects a visible password field', () => {
    const doc = makeDoc('<body><input type="password" /></body>');
    expect(hasVisibleSensitiveInput(doc, () => true)).toBe(true);
  });

  it('detects a credit-card-like field by autocomplete', () => {
    const doc = makeDoc('<body><input type="text" autocomplete="cc-number" /></body>');
    expect(hasVisibleSensitiveInput(doc, () => true)).toBe(true);
  });

  it('ignores sensitive fields that are not visible', () => {
    const doc = makeDoc('<body><input type="password" /></body>');
    expect(hasVisibleSensitiveInput(doc, () => false)).toBe(false);
  });

  it('ignores ordinary text fields', () => {
    const doc = makeDoc('<body><input type="text" name="search" /></body>');
    expect(hasVisibleSensitiveInput(doc, () => true)).toBe(false);
  });
});

describe('isEligibleForAutoScan', () => {
  const bigText = 'word '.repeat(260).trim();

  it('requires the top frame', () => {
    const doc = makeDoc();
    expect(
      isEligibleForAutoScan({
        isTopFrame: false,
        protocol: 'https:',
        hostname: 'news.example.com',
        blockTexts: [bigText],
        excludedHosts: [],
        doc,
      }),
    ).toBe(false);
  });

  it('requires http(s)', () => {
    const doc = makeDoc();
    expect(
      isEligibleForAutoScan({
        isTopFrame: true,
        protocol: 'file:',
        hostname: 'news.example.com',
        blockTexts: [bigText],
        excludedHosts: [],
        doc,
      }),
    ).toBe(false);
  });

  it('rejects localhost/IP/intranet hosts', () => {
    const doc = makeDoc();
    expect(
      isEligibleForAutoScan({
        isTopFrame: true,
        protocol: 'http:',
        hostname: 'localhost',
        blockTexts: [bigText],
        excludedHosts: [],
        doc,
      }),
    ).toBe(false);
  });

  it('rejects excluded hosts (built-in or user)', () => {
    const doc = makeDoc();
    expect(
      isEligibleForAutoScan({
        isTopFrame: true,
        protocol: 'https:',
        hostname: 'mail.google.com',
        blockTexts: [bigText],
        excludedHosts: [],
        doc,
      }),
    ).toBe(false);
    expect(
      isEligibleForAutoScan({
        isTopFrame: true,
        protocol: 'https:',
        hostname: 'blog.example.com',
        blockTexts: [bigText],
        excludedHosts: ['blog.example.com'],
        doc,
      }),
    ).toBe(false);
  });

  it('rejects pages with too little text', () => {
    const doc = makeDoc();
    expect(
      isEligibleForAutoScan({
        isTopFrame: true,
        protocol: 'https:',
        hostname: 'news.example.com',
        blockTexts: ['too short'],
        excludedHosts: [],
        doc,
      }),
    ).toBe(false);
  });

  it('rejects pages with a visible password field even if the text is long enough', () => {
    const doc = makeDoc('<body><input type="password" /></body>');
    expect(
      isEligibleForAutoScan({
        isTopFrame: true,
        protocol: 'https:',
        hostname: 'news.example.com',
        blockTexts: [bigText],
        excludedHosts: [],
        doc,
        isVisible: () => true,
      }),
    ).toBe(false);
  });

  it('accepts an eligible, ordinary article page', () => {
    const doc = makeDoc();
    expect(
      isEligibleForAutoScan({
        isTopFrame: true,
        protocol: 'https:',
        hostname: 'news.example.com',
        blockTexts: [bigText],
        excludedHosts: [],
        doc,
        isVisible: () => false,
      }),
    ).toBe(true);
  });
});
