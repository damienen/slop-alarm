#!/usr/bin/env node
/**
 * Full-stack check: the REAL built extension against the REAL TypeSafe provider. No stub, no mock,
 * no backend (there is none anymore). Takes screenshots of onboarding, options, popup states and
 * the on-page card into SHOT_DIR.
 *
 * Requires REAL_JEV=1 and TYPESAFE_API_KEY set directly in the environment by the caller. This
 * script never reads a key from any file (not apps/.env, not tools/eval/.env).
 *
 * Usage:
 *   REAL_JEV=1 TYPESAFE_API_KEY=sk-... SHOT_DIR=./shots node e2e/fullstack.mjs
 *   SLOP_E2E_BROWSER="C:/.../msedge.exe" REAL_JEV=1 TYPESAFE_API_KEY=sk-... node e2e/fullstack.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(here, '..');
const dist = path.join(extRoot, 'dist');
const shots = path.resolve(process.env.SHOT_DIR || path.join(extRoot, '.e2e-shots'));
fs.mkdirSync(shots, { recursive: true });
const log = (...a) => console.log('[fullstack]', ...a);
const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERT: ' + msg);
  log('ok:', msg);
};

if (process.env.REAL_JEV !== '1') {
  console.error('[fullstack] Set REAL_JEV=1 to run this script. It always exercises the real TypeSafe provider (no stub, no mock).');
  process.exit(1);
}
const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) {
  console.error('[fullstack] TYPESAFE_API_KEY is not set. Pass the real key directly in the environment; this script never reads it from a file.');
  process.exit(1);
}

// One local origin serves the fixture pages AND forwards provider calls, untouched, to the real TypeSafe
// API. Pointing SLOP_E2E_PROVIDER_URL at it gives the fixture pages host permission in this dev build
// (a popup opened by URL never gets the activeTab grant a real toolbar click provides). The extension
// still sends the real key and the real text, and real Jev answers.
const REAL_PROVIDER = 'https://api.typesafe.ai/v1/systemone';
let forwarded = 0;
const fixtures = http.createServer(async (req, res) => {
  if (req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    forwarded++;
    try {
      const upstream = await fetch(REAL_PROVIDER, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: req.headers.authorization ?? '' },
        body: Buffer.concat(chunks),
      });
      res.writeHead(upstream.status, { 'content-type': 'application/json' });
      return res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      res.writeHead(502);
      return res.end('{}');
    }
  }
  const file = path.join(here, 'fixtures', path.basename(req.url.split('?')[0]) || 'ai.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    return res.end('nope');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => fixtures.listen(0, '127.0.0.1', r));
const FIX = `http://127.0.0.1:${fixtures.address().port}`;

log('building dev extension that reaches the real provider through the local forwarder...');
execFileSync(process.execPath, ['build.mjs'], { cwd: extRoot, stdio: 'ignore', env: { ...process.env, SLOP_E2E_PROVIDER_URL: `${FIX}/v1/systemone` } });

const profile = path.join(extRoot, '.e2e-profile');
fs.rmSync(profile, { recursive: true, force: true });
let context;
let failed = false;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.SLOP_E2E_BROWSER || chromium.executablePath(),
    headless: true,
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--no-sandbox'],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  log('extension id', id);

  // Onboarding should have opened on install.
  await new Promise((r) => setTimeout(r, 1500));
  const onboarding = context.pages().find((p) => p.url().includes('onboarding.html'));
  assert(!!onboarding, 'onboarding page opened on install');
  await onboarding.screenshot({ path: path.join(shots, '1-onboarding.png'), fullPage: true });

  // Save the real key right there in onboarding, and confirm Test key works against the real provider.
  await onboarding.locator('#api-key').fill(apiKey);
  await onboarding.getByRole('button', { name: 'Test key' }).click();
  await onboarding.waitForFunction(() => /key works/i.test(document.querySelector('.key-status')?.textContent || ''), null, { timeout: 20000 });
  await onboarding.getByRole('button', { name: 'Save', exact: true }).click();
  await onboarding.waitForFunction(() => document.querySelector('.save-status')?.textContent?.includes('Saved'), null, { timeout: 5000 });
  await onboarding.screenshot({ path: path.join(shots, '1b-onboarding-key-saved.png'), fullPage: true });

  for (const [name, expectAi] of [
    ['ai.html', true],
    ['human.html', false],
  ]) {
    const page = await context.newPage();
    await page.goto(`${FIX}/${name}`);
    await page.bringToFront();
    await page.waitForTimeout(400);
    // Not filtered by url: see run.mjs for why.
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
    assert(typeof tabId === 'number', `${name} tab id resolved`);
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 380, height: 640 });
    await popup.goto(`chrome-extension://${id}/popup.html?tabId=${tabId}`);
    await popup.screenshot({ path: path.join(shots, `2-popup-idle-${name}.png`) });
    await popup.getByRole('button', { name: /check this page/i }).click();
    await popup.waitForFunction(() => /likely/i.test(document.body.innerText), null, { timeout: 30000 });
    const text = await popup.evaluate(() => document.body.innerText);
    log(name, '->', text.split('\n').filter(Boolean).slice(0, 6).join(' | '));
    assert(expectAi ? /likely ai/i.test(text) : /likely human/i.test(text), `${name} verdict matches expectation`);
    await popup.screenshot({ path: path.join(shots, `3-popup-result-${name}.png`), fullPage: true });

    // Show the on-page card exactly as the keyboard shortcut path does.
    await sw.evaluate(async (tid) => {
      const state = (await chrome.storage.session.get(`tab:${tid}`))[`tab:${tid}`];
      await chrome.tabs.sendMessage(tid, { type: 'showResult', state, isAuto: false });
    }, tabId);
    await page.bringToFront();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(shots, `4-page-card-${name}.png`) });
    const badge = await sw.evaluate(async (tid) => chrome.action.getBadgeText({ tabId: tid }), tabId);
    assert(badge === (expectAi ? 'AI' : 'OK'), `${name} toolbar badge is "${badge}"`);
    await popup.close();
    await page.close();
  }

  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForTimeout(800);
  await options.screenshot({ path: path.join(shots, '5-options.png'), fullPage: true });
  const optText = await options.evaluate(() => document.body.innerText);
  assert(/provider and api key/i.test(optText), 'options page shows the provider and API key section');
  assert(/today:/i.test(optText), "options page shows today's usage");

  log('ALL PASSED. Screenshots in', shots);
} catch (e) {
  failed = true;
  console.error('[fullstack] FAILED:', e.message);
} finally {
  await context?.close();
  // The profile's extension storage holds the real key after this run. Never leave it on disk.
  fs.rmSync(profile, { recursive: true, force: true });
  fixtures.close();
  process.exit(failed ? 1 : 0);
}
