/**
 * Static copy checks that don't need a rendered DOM. Slop Alarm is free, BYOK, no account: nothing
 * in the extension may mention a trial, a paid plan, a subscription, or an upgrade path, since none
 * of those exist anymore. Separately, the project's house style avoids em dashes and en dashes in
 * UI strings (verified here across the whole of src/ and build.mjs, which today also contain none
 * in comments).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.join(testDir, '..');
const srcDir = path.join(extensionRoot, 'src');

function collectFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full, exts));
    else if (exts.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const sourceFiles = [...collectFiles(srcDir, ['.ts', '.html']), path.join(extensionRoot, 'build.mjs')];

describe('extension copy hygiene', () => {
  it('never mentions a trial, Pro plan, subscription, or upgrade anywhere in the extension', () => {
    const banned = /\b(trial|pro plan|subscription|upgrade)\b/i;
    const offenders = sourceFiles
      .filter((f) => banned.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(extensionRoot, f));
    expect(offenders).toEqual([]);
  });

  it('never claims "unlimited" checks anywhere in the extension', () => {
    const offenders = sourceFiles
      .filter((f) => /unlimited/i.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(extensionRoot, f));
    expect(offenders).toEqual([]);
  });

  it('contains no em dashes (—) or en dashes (–)', () => {
    const emDash = '—';
    const enDash = '–';
    const dashPattern = new RegExp(`[${emDash}${enDash}]`);
    const offenders = sourceFiles
      .filter((f) => dashPattern.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(extensionRoot, f));
    expect(offenders).toEqual([]);
  });
});
