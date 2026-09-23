#!/usr/bin/env node
/**
 * End-to-end smoke test: loads the built extension in a real browser (via Playwright), serves the
 * fixture pages locally, and drives the actual UI: save an API key through the options page, then
 * check a human-leaning and an AI-leaning fixture from the popup.
 *
 * Starts a single built-in Node HTTP server that plays two roles on ONE origin: it serves the
 * fixture pages (GET /human.html, /ai.html) and stands in for the provider (POST /v1/systemone),
 * answering a contract-valid `{ model, answers, usage }` body when the bearer key is "test-key"
 * (AI-leaning answers when the checked text contains "delve" or "tapestry", human-leaning
 * otherwise) and 401ing any other key. Both roles share one origin on purpose: the extension is
 * built with SLOP_E2E_PROVIDER_URL pointing at it, which is also the ONLY extra host permission a
 * non-prod build grants, so chrome.scripting.executeScript / chrome.tabs.query against the fixture
 * tabs works too, without ever widening the extension's real (two-provider-host) permission set.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.join(__dirname, '..');
const distDir = path.join(extRoot, 'dist');
const fixturesDir = path.join(__dirname, 'fixtures');

function log(...args) {
  console.log('[e2e]', ...args);
}

// ---------- Combined fixture + stub provider server ----------

const AI_MARKERS = /\b(delve|delving|tapestry)\b/i;

function answersFor(text) {
  const aiLike = AI_MARKERS.test(text);
  return aiLike
    ? {
        // Tuned against packages/core/src/scoring.ts's fitted weights to land in [0.75, 0.9): "Likely AI", not "Very likely AI".
        ai_written: { type: 'noul', noul: 0.92 },
        tells: { type: 'score', score: 1, confidence: 0.8 },
        staging: { type: 'noul', noul: 0 },
        rhythm: { type: 'noul', noul: 0 },
        inflation: { type: 'noul', noul: 0 },
        formatting: { type: 'noul', noul: 0 },
        chat_residue: { type: 'noul', noul: 0 },
        specifics: { type: 'noul', noul: 0 },
      }
    : {
        // Tuned to land well under 0.3: "Likely human".
        ai_written: { type: 'noul', noul: 0.05 },
        tells: { type: 'score', score: 0, confidence: 0.8 },
        staging: { type: 'noul', noul: 0 },
        rhythm: { type: 'noul', noul: 0 },
        inflation: { type: 'noul', noul: 0 },
        formatting: { type: 'noul', noul: 0 },
        chat_residue: { type: 'noul', noul: 0 },
        specifics: { type: 'noul', noul: 0.9 },
      };
}

function handleProviderRequest(req, res) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const auth = req.headers['authorization'] ?? '';
    const key = auth.replace(/^Bearer\s+/i, '');
    if (key !== 'test-key') return send(401, { error: { code: 'unauthorized', message: 'bad key' } });
    let parsed;
    try {
      parsed = JSON.parse(body || '{}');
    } catch {
      return send(400, { error: { code: 'bad_request', message: 'invalid json' } });
    }
    const text = typeof parsed.state === 'string' ? parsed.state : '';
    send(200, { model: parsed.model ?? 'jev-1.13.0', answers: answersFor(text), usage: { input_tokens: Math.max(1, text.split(/\s+/).length) } });
  });
}

function handleFixtureRequest(req, res) {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
  const relative = urlPath === '/' ? 'human.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(fixturesDir, relative);
  if (!filePath.startsWith(fixturesDir) || !fs.existsSync(filePath)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  fs.createReadStream(filePath).pipe(res);
}

function startServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') return handleProviderRequest(req, res);
    if (req.method === 'GET') return handleFixtureRequest(req, res);
    res.writeHead(404).end('not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------- Build ----------

function runBuild(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(extRoot, 'build.mjs')], {
      cwd: extRoot,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build.mjs exited with ${code}`))));
  });
}

// ---------- Small page-driving helpers ----------

/**
 * Finds a fixture page's chrome tabId without ever filtering chrome.tabs.query by `url`: that
 * filter requires a host permission for the tab's origin. Bringing the page to the front and
 * asking for the active tab works with the permissions the extension already has.
 */
async function getActiveTabId(sw, page) {
  await page.bringToFront();
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
    if (id !== undefined) return id;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('could not find the active tab id');
}

async function saveKeyThroughOptions(context, extensionId, provider, apiKey) {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  if (provider === 'openrouter') {
    await options.locator('input[name="provider"][value="openrouter"]').check();
  }
  await options.locator('#api-key').fill(apiKey);
  await options.getByRole('button', { name: 'Save', exact: true }).click();
  await options.waitForFunction(() => document.querySelector('.save-status')?.textContent?.includes('Saved'), null, { timeout: 5000 });
  await options.close();
}

// ---------- Main ----------

async function main() {
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const providerUrl = `${origin}/v1/systemone`;
  log(`combined fixture + stub provider server running at ${origin}`);

  log('building extension for e2e...');
  await runBuild({ SLOP_E2E_PROVIDER_URL: providerUrl });

  if (!fs.existsSync(path.join(distDir, 'manifest.json'))) {
    throw new Error('dist/manifest.json missing after build');
  }

  const userDataDir = path.join(extRoot, '.e2e-profile');
  fs.rmSync(userDataDir, { recursive: true, force: true });

  log('launching the browser with the extension loaded...');
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      // Plain `headless: true` selects Playwright's stripped-down "headless shell" binary, which
      // cannot load extensions at all. Point at the full Chrome-for-Testing binary Playwright also
      // downloads and run it in `--headless=new` mode instead, which does support unpacked MV3
      // extensions. SLOP_E2E_BROWSER overrides the binary, e.g. an installed Edge when
      // Chrome-for-Testing cannot start.
      executablePath: process.env.SLOP_E2E_BROWSER || chromium.executablePath(),
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`, '--no-sandbox'],
    });
  } catch (err) {
    console.error(
      '[e2e] Could not launch the full Chrome-for-Testing binary needed to load an extension. ' +
        'On Windows this usually means the Microsoft Visual C++ Redistributable is missing ' +
        '("side-by-side configuration is incorrect"). Original error below.',
    );
    throw err;
  }

  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = new URL(sw.url()).host;
    log(`extension id: ${extensionId}`);

    const humanPage = await context.newPage();
    await humanPage.goto(`${origin}/human.html`);
    const humanTabId = await getActiveTabId(sw, humanPage);

    // 1. Before any key is saved, the popup shows the "add API key" state.
    log('checking the popup shows the add-key state before a key exists...');
    let popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${humanTabId}`);
    await popup.waitForSelector('text=Add API key', { timeout: 10000 });
    await popup.close();

    // 2. Save a working key through the options page UI.
    log('saving the API key through the options page...');
    await saveKeyThroughOptions(context, extensionId, 'typesafe', 'test-key');

    // 3. human.html reads "Likely human".
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${humanTabId}`);
    await popup.getByRole('button', { name: 'Check this page' }).click();
    await popup.waitForSelector('.result-head h2', { timeout: 20000 });
    const humanVerdict = await popup.locator('.result-head h2').innerText();
    log(`human.html -> "${humanVerdict}"`);
    if (!/likely human/i.test(humanVerdict)) throw new Error(`expected "Likely human", got "${humanVerdict}"`);
    await popup.close();

    // 4. ai.html reads "likely AI".
    const aiPage = await context.newPage();
    await aiPage.goto(`${origin}/ai.html`);
    const aiTabId = await getActiveTabId(sw, aiPage);
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${aiTabId}`);
    await popup.getByRole('button', { name: 'Check this page' }).click();
    await popup.waitForSelector('.result-head h2', { timeout: 20000 });
    const aiVerdict = await popup.locator('.result-head h2').innerText();
    log(`ai.html -> "${aiVerdict}"`);
    if (!/likely ai/i.test(aiVerdict)) throw new Error(`expected "Likely AI", got "${aiVerdict}"`);
    await popup.close();

    // 5. A wrong key shows the invalid-key message. Switching to OpenRouter with a bad key (rather
    // than reusing TypeSafe) guarantees a cache miss: the result cache is keyed by model+text, and
    // OpenRouter's model id differs from TypeSafe's, so this cannot be served from step 3's cache.
    log('saving a wrong key and checking the invalid-key message shows...');
    await saveKeyThroughOptions(context, extensionId, 'openrouter', 'wrong-key');
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${humanTabId}`);
    // The tab already has a cached ("Likely human") result from step 3, so the popup shows
    // "Re-check" rather than the initial "Check this page".
    await popup.getByRole('button', { name: 'Re-check' }).click();
    await popup.waitForFunction(() => /rejected your API key/i.test(document.body.innerText), null, { timeout: 20000 });
    log('invalid-key message shown as expected.');
    await popup.close();

    await humanPage.close();
    await aiPage.close();

    log('e2e smoke test passed.');
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    server.close();
  }
}

main().catch((err) => {
  console.error('[e2e] failed:', err);
  process.exitCode = 1;
});
