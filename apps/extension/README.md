# Slop Alarm — Chrome extension

Manifest V3 extension for Slop Alarm. Free, bring-your-own-key (BYOK): there is no backend, no
account, and no payment. The extension calls the provider you choose (TypeSafe or OpenRouter)
directly from the service worker, using an API key you paste into the options page. Everything the
extension keeps (settings, your key, the result cache, daily usage counters) lives only in this
browser's `chrome.storage.local`.

See `packages/core/src/detect.ts` for the whole detection pipeline (`ProviderConfig`,
`detectChunks`, `askJev`, `testKey`, `JevError`) that this extension calls.

## Build

From the repo root, build the shared core package first (the extension bundles its compiled
output):

```sh
npm run build -w @slop-alarm/core
```

Then, from `apps/extension`:

```sh
npm run build          # dist/, unminified, source maps
npm run build:prod     # dist/, minified, no source maps
npm run dev            # --watch
```

No environment variable is required to build: the extension's only two host permissions
(`https://api.typesafe.ai/*` and `https://openrouter.ai/*`) are fixed at build time.

Icons are pre-rendered PNGs committed under `assets/icons/` (16/32/48/128 px), generated from
`assets/icon.svg` with `npm run icons` (uses `sharp`; not needed at build time). Re-run it if you
change `assets/icon.svg`.

## Load unpacked

1. `npm run build`
2. Chrome → `chrome://extensions` → enable Developer Mode → "Load unpacked" → select
   `apps/extension/dist`.
3. Open the extension's options page and paste in your own TypeSafe or OpenRouter API key. That's
   it: no server to point at, no account to sign into.

## Test

```sh
npm test              # vitest + jsdom: extraction, eligibility, detect flow, cache, settings
npm run typecheck
```

## Package for the store

```sh
npm run zip           # --prod build, then writes slop-alarm-<version>.zip with manifest.json at its root
```

A `--prod` build (and therefore `zip`) refuses to run if any `SLOP_E2E_*` environment variable is
set, since those exist only for the e2e harness (in particular `SLOP_E2E_PROVIDER_URL`, which
would otherwise ship a build that talks to a test fixture instead of the real providers).

## End-to-end tests

```sh
npm run e2e             # loads the built extension in a real browser against a stub provider server
node e2e/fullstack.mjs  # REAL_JEV=1 TYPESAFE_API_KEY=... required: exercises the real TypeSafe provider
```

`e2e/run.mjs` starts a tiny built-in HTTP server standing in for the provider (answers with
contract-valid `{ model, answers, usage }` bodies: AI-leaning when the checked text contains
"delve"/"tapestry", human-leaning otherwise; 401s any key other than `"test-key"`), builds the
extension with `SLOP_E2E_PROVIDER_URL` pointing at it, loads the built extension into a real
browser via Playwright, sets the key to `"test-key"` through the options page UI exactly as a user
would, and asserts: the popup shows the "add API key" state before any key exists; after saving,
`human.html` reads "Likely human" and `ai.html` reads "Likely AI"; a wrong key shows the
invalid-key message.

`e2e/fullstack.mjs` is the same shape but with no stub at all: it reads `TYPESAFE_API_KEY` from the
environment (never from a file) and exercises the real TypeSafe provider, taking screenshots of
onboarding, options, popup states, and the on-page card into `SHOT_DIR`.

Loading an unpacked MV3 extension requires Playwright's full Chrome-for-Testing binary, not its
default stripped-down "headless shell" (the shell silently ignores `--load-extension`); both e2e
scripts launch `chromium.executablePath()` explicitly in headless mode to get the full binary, and
honour `SLOP_E2E_BROWSER` to point at an installed browser instead (e.g. Edge) when that binary
cannot start. On a bare-bones Windows host the Chrome-for-Testing binary needs the Microsoft Visual
C++ Redistributable installed, or it fails to spawn with a "side-by-side configuration is
incorrect" error, a host setup issue, not a bug in these scripts. If Playwright's browsers are not
installed, run `npx playwright install chromium` first.

## Layout

```
src/background/   service worker: detect pipeline call, settings/cache/usage state, badge, auto-scan permission sync, menus, router
src/content/      extraction, eligibility, highlighting, the on-page pill/card (closed Shadow DOM)
src/popup/        toolbar popup
src/options/       provider + API key, checking preferences, excluded sites, privacy
src/onboarding/   first-run page (opened once on install): what it does, bring your own key, what gets sent, choose a mode
src/ui/tokens.css shared design tokens for the popup/options/onboarding pages
test/             vitest + jsdom unit tests
e2e/              Playwright end-to-end tests + fixtures
assets/           icon.svg source and the rendered PNGs used by the build
```

## Privacy

The text you check is sent directly from your browser to the provider you chose (TypeSafe or
OpenRouter), using your own API key. The extension never sends the page URL, title, cookies or
browsing history, has no server of its own, and collects nothing. Your API key is stored only in
`chrome.storage.local` in this browser: never `chrome.storage.sync`, and never sent to a content
script (`content/getSettings` strips it before a content script ever sees the settings object).
The result cache holds only a SHA-256 hash of the checked text mapped to a score, never the text
itself, capped at 300 entries with a 7-day expiry, and clearable any time from the options page's
"Clear local data" button.
