#!/usr/bin/env node
/**
 * Builds the Slop Alarm extension into dist/. Flags: --watch, --prod (minify, no source maps),
 * --zip (writes slop-alarm-<version>.zip after a --prod build).
 *
 * BYOK, no backend: the extension talks directly to https://api.typesafe.ai and
 * https://openrouter.ai with the user's own key, so those two origins are the extension's ONLY
 * static host_permissions. There is no API base to configure.
 *
 * A --prod build is what ships to the store, so it is guarded: no environment variable whose name
 * starts with SLOP_E2E_ may be set. Those variables exist only for the e2e harness (in particular
 * SLOP_E2E_PROVIDER_URL, which redirects provider requests to a local fixture server for tests) and
 * must never reach a production/store build. If any is set, the build throws instead of silently
 * shipping it.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import esbuild from 'esbuild';
import archiver from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const distDir = path.join(root, 'dist');

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const prod = args.includes('--prod');
const doZip = args.includes('--zip');

const pkg = JSON.parse(fssync.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

/** The two providers the extension can ever talk to. Exact, no wildcards, no extra hosts, in a
 * production build. */
export const PROVIDER_HOSTS = ['https://api.typesafe.ai/*', 'https://openrouter.ai/*'];

const SLOP_E2E_PREFIX = 'SLOP_E2E_';

/** Every SLOP_E2E_* environment variable that is actually set (truthy), sorted for a stable
 * error message. Empty in a normal dev/prod run; e2e scripts set exactly the ones they need. */
export function findE2EEnvVars(env) {
  return Object.keys(env)
    .filter((k) => k.startsWith(SLOP_E2E_PREFIX) && env[k])
    .sort();
}

/**
 * Refuses a --prod build whose environment carries any e2e-only variable. Throws a descriptive
 * Error; never returns a falsy "invalid" value, so a caller that forgets to check a return value
 * can't accidentally proceed.
 */
export function validateProdEnv(env) {
  const found = findE2EEnvVars(env);
  if (found.length > 0) {
    throw new Error(
      `[build] Refusing --prod build: ${found.join(', ')} ${found.length === 1 ? 'is' : 'are'} set. ` +
        'SLOP_E2E_* variables exist only for the e2e harness and must never ship in a production/store build. ' +
        `Unset ${found.join(', ')} and build again.`,
    );
  }
}

/**
 * Turns SLOP_E2E_PROVIDER_URL into the extra static host_permissions entry a non-prod build needs
 * so the service worker is allowed to fetch it. Empty when unset. Throws on a set-but-unparseable
 * URL (a build-time mistake, not an e2e-only concern, so this is not gated by `prod`).
 */
export function resolveE2EProviderOrigin(raw) {
  if (!raw) return [];
  let origin;
  try {
    origin = new URL(raw).origin;
  } catch {
    throw new Error(`[build] SLOP_E2E_PROVIDER_URL ("${raw}") is not a valid URL.`);
  }
  return [`${origin}/*`];
}

/**
 * Pure manifest generation: every input is a parameter, nothing is read from `process.env` or the
 * filesystem, so a test can assert the shape of the manifest without invoking esbuild or touching
 * disk.
 */
export function buildManifest({ version: v, extraHosts = [] }) {
  const icons = { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' };
  return {
    manifest_version: 3,
    name: 'Slop Alarm',
    short_name: 'Slop Alarm',
    version: v,
    description: 'Tells you whether the text you are reading was likely written by AI. Bring your own API key, no account, no server.',
    icons,
    action: { default_popup: 'popup.html', default_icon: icons },
    background: { service_worker: 'background.js', type: 'module' },
    permissions: ['storage', 'activeTab', 'scripting', 'contextMenus'],
    host_permissions: [...PROVIDER_HOSTS, ...extraHosts],
    optional_host_permissions: ['<all_urls>'],
    options_page: 'options.html',
    commands: {
      'check-page': {
        suggested_key: { default: 'Alt+Shift+S', mac: 'Alt+Shift+S' },
        description: 'Check this page for AI writing',
      },
    },
    minimum_chrome_version: '116',
  };
}

async function clean() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });
  await fs.mkdir(path.join(distDir, 'icons'), { recursive: true });
}

async function writeManifest(manifest) {
  await fs.writeFile(path.join(distDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function copyHtml(name, srcDir) {
  const srcPath = path.join(root, 'src', srcDir, `${name}.html`);
  let html = await fs.readFile(srcPath, 'utf8');
  html = html.replace('../ui/tokens.css', 'tokens.css');
  await fs.writeFile(path.join(distDir, `${name}.html`), html);
}

async function copyIcons() {
  const iconsDir = path.join(root, 'assets', 'icons');
  for (const size of [16, 32, 48, 128]) {
    const src = path.join(iconsDir, `icon${size}.png`);
    const dest = path.join(distDir, 'icons', `icon${size}.png`);
    if (fssync.existsSync(src)) {
      await fs.copyFile(src, dest);
    } else {
      console.warn(`[build] missing ${src}: run "npm run icons" first`);
    }
  }
}

async function copyStatic() {
  await fs.copyFile(path.join(root, 'src', 'ui', 'tokens.css'), path.join(distDir, 'tokens.css'));
  await fs.copyFile(path.join(root, 'src', 'popup', 'popup.css'), path.join(distDir, 'popup.css'));
  await fs.copyFile(path.join(root, 'src', 'options', 'options.css'), path.join(distDir, 'options.css'));
  await fs.copyFile(path.join(root, 'src', 'onboarding', 'onboarding.css'), path.join(distDir, 'onboarding.css'));
  await fs.copyFile(path.join(root, 'src', 'onboarding', 'sample.html'), path.join(distDir, 'sample.html'));
  await copyHtml('popup', 'popup');
  await copyHtml('options', 'options');
  await copyHtml('onboarding', 'onboarding');
  await copyIcons();
}

const entryPoints = [
  { in: 'src/background/index.ts', out: 'background', format: 'esm' },
  { in: 'src/content/index.ts', out: 'content', format: 'iife' },
  { in: 'src/popup/popup.ts', out: 'popup', format: 'esm' },
  { in: 'src/options/options.ts', out: 'options', format: 'esm' },
  { in: 'src/onboarding/onboarding.ts', out: 'onboarding', format: 'esm' },
];

function esbuildOptionsFor(entry, e2eProviderUrl) {
  return {
    entryPoints: [path.join(root, entry.in)],
    outfile: path.join(distDir, `${entry.out}.js`),
    bundle: true,
    format: entry.format,
    target: ['chrome116'],
    platform: 'browser',
    minify: prod,
    sourcemap: !prod,
    define: { __E2E_PROVIDER_URL__: JSON.stringify(e2eProviderUrl) },
    logLevel: 'info',
  };
}

/** Defense in depth: even though `sourcemap: !prod` means a --prod build never asks esbuild to
 * emit .map files, confirm none exist before they could be zipped into a store submission. */
async function assertNoSourceMaps() {
  const entries = await fs.readdir(distDir, { recursive: true });
  const maps = entries.filter((f) => f.endsWith('.map'));
  if (maps.length > 0) {
    throw new Error(`[build] Refusing to zip: source map(s) found in dist/ for a --prod build: ${maps.join(', ')}`);
  }
}

async function zip() {
  await assertNoSourceMaps();
  const zipPath = path.join(root, `slop-alarm-${version}.zip`);
  await fs.rm(zipPath, { force: true });
  await new Promise((resolve, reject) => {
    const output = fssync.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(distDir, false);
    void archive.finalize();
  });
  console.log(`[build] zipped ${path.relative(root, zipPath)}`);
}

async function main() {
  const e2eProviderUrlRaw = process.env.SLOP_E2E_PROVIDER_URL;

  if (prod) validateProdEnv(process.env);

  // Never included in a --prod build, even if validateProdEnv's guard above were somehow bypassed.
  const e2eProviderUrl = prod ? '' : e2eProviderUrlRaw || '';
  const extraHosts = prod ? [] : resolveE2EProviderOrigin(e2eProviderUrlRaw);

  await clean();
  await writeManifest(buildManifest({ version, extraHosts }));
  await copyStatic();

  if (watch) {
    const contexts = await Promise.all(entryPoints.map((e) => esbuild.context(esbuildOptionsFor(e, e2eProviderUrl))));
    await Promise.all(contexts.map((c) => c.watch()));
    console.log(`[build] watching${e2eProviderUrl ? ` (provider requests redirected to ${e2eProviderUrl})` : ''}`);
  } else {
    await Promise.all(entryPoints.map((e) => esbuild.build(esbuildOptionsFor(e, e2eProviderUrl))));
    console.log(`[build] built to ${path.relative(root, distDir)}${e2eProviderUrl ? ` (provider requests redirected to ${e2eProviderUrl})` : ''}`);
    if (doZip) await zip();
  }
}

// Only run when executed directly (not when imported by a test for its pure helpers).
const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  });
}
