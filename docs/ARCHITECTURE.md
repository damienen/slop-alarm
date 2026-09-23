# Slop Alarm architecture

Slop Alarm is a free Chrome extension that tells the user whether the text in front of them was likely
written by an AI. It is **bring your own key**: the user pastes an API key for TypeSafe or OpenRouter, and
the extension calls that provider directly. There is no Slop Alarm server, no account and no payment.

If code and this document disagree, fix one of them in the same change.

## 1. Shape of the system

```
 Chrome extension (apps/extension)                                   the provider the user chose
 ┌───────────────────────────────────────────────┐      HTTPS       ┌──────────────────────────┐
 │ content script   extract and chunk page text  │                  │ api.typesafe.ai          │
 │ service worker   detectChunks() from core ────┼────────────────▶ │   or openrouter.ai       │
 │                  key, cache, badge, limits    │  user's own key  │ runs Jev 1.13            │
 │ popup, options, onboarding                    │                  └──────────────────────────┘
 └───────────────────────────────────────────────┘
        packages/core   questions, detection client, scoring, chunking, UI copy
        tools/eval      calibration: labelled samples → fitted weights
        apps/site       static landing page and privacy policy (GitHub Pages)
```

Why this shape: with the user's own key there is nothing for us to protect or meter, so a server would only
add cost, a privacy liability and a point of failure. Text goes from the browser to one provider and nowhere
else. The developer receives nothing.

An earlier version had a backend with a trial and a $1 subscription. It was removed on purpose. Do not
reintroduce server calls.

## 2. packages/core

| File | Purpose |
| --- | --- |
| `questions.ts` | The Jev questions (`QUESTIONS`: one flat list of 8), the `Answers` type, `JEV_PROVIDERS` (URL and pinned model id for each provider). |
| `detect.ts` | The pipeline: `askJev` (one request), `validateAnswers`, `detectChunks` (cache, concurrency, one retry, aggregation), `testKey`, `JevError` and `JEV_ERROR_COPY`. |
| `scoring.ts` | `probability`, `scoreChunk`, `aggregate`, fitted weights and bands in `SCORING`, `SCORING_VERSION`. |
| `chunking.ts` | `chunkBlocks`, `sampleChunks`, `countWords`, `truncateChars`. |
| `contract.ts` | Result types (`DetectionResult`, `ChunkResult`, `Verdict`, ...) and `LIMITS`. |
| `copy.ts` | User-facing wording: `VERDICT_COPY`, `TELL_COPY`, `CONFIDENCE_COPY`, `DISCLAIMER`, `percent`. |

Core has no dependencies and runs wherever `fetch` and `crypto.subtle` exist: an MV3 service worker and
Node 20+. The extension and the eval tool use the same code path, so what is calibrated is what ships.

## 3. Detection

Jev (TypeSafe's "System One" decision model) returns typed decisions, never prose. One request carries one
`state` (the text) and many questions. Jev reads the state once and answers every question in parallel, so
all eight questions go in a **single request per chunk**. There is never a second call.

```
POST https://api.typesafe.ai/v1/systemone          model "jev-1.13.0"
POST https://openrouter.ai/api/alpha/decisions     model "typesafe/jev-1.13"     (same body, alpha endpoint)
Authorization: Bearer <the user's key>
{ "model": "...", "state": "<chunk text>", "questions": { ...QUESTIONS } }

200 → { "model": "jev-1.13.0",
        "answers": { "ai_written": {"type":"noul","noul":0.92},
                     "tells": {"type":"score","score":2.66,"confidence":0.66},
                     "staging": {"type":"noul","noul":0.95}, ... },
        "usage": { "input_tokens": 1762 } }
```

Per chunk, in `detectChunks`:

1. Fewer than `LIMITS.minWords` words → `too_short`, no request.
2. Cache lookup by `sha256(SCORING_VERSION + model + text)`. The cache holds scores only, never text.
3. One request. Validate the eight answers. One retry on 429 (honouring `retry-after`), 5xx or a network error.
4. `scoreChunk`, write cache.

Up to 3 requests run in parallel. A chunk that fails is left out and counted; if every chunk fails, or the key
is missing, rejected or out of credit, a `JevError` is thrown and the UI shows the matching line from
`JEV_ERROR_COPY`. A bad key stops the run at once so it does not burn requests.

The model id is pinned because `SCORING` is calibrated against one version. Move it on purpose, rerun the
eval and the fit, and bump `SCORING_VERSION`.

### Scoring: one fitted formula

```
p(ai) = sigmoid(bias + w1·ai_written + w2·tells/3 + w3·staging + w4·specifics)
```

The weights are **fitted**, not hand-picked: `npm run fit` runs L2 logistic regression per chunk over the
labelled samples, the same way production scores, and validates leave-one-group-out (a sample and its
topic-matched twin are held out together). Four signals come close to all eight (held-out AUC 0.966 against 0.972) and read
more human text as human at the operating threshold, so only those are scored. The other questions (rhythm, inflation, formatting, chat residue) ride along in the same request
to show the user which habits were found. One rule sits on top: near-certain chat residue floors the score
at 0.9. A page's probability is the word-weighted mean of its chunk probabilities.

Lessons from calibration:

- Asking Jev directly "is this AI-written?" rates neutral encyclopedic human prose at 0.7 to 0.8. Alone it
  flags 12 of 44 human samples at a 0.5 threshold, against 2 for the combined formula. See
  `docs/BENCHMARK.md`.
- A "voice" question (personal versus generic) was dropped because it measured formality, not authorship.
- Jev reads questions literally and does not count reliably. Questions describe what to look for and never
  ask "how many".
- Bands: `likely_human` below 0.30, `likely_ai` from 0.75 (no held-out human sample flagged, 62% of AI
  samples caught), `very_likely_ai` from 0.90, `unclear` between. Zero of 44 still allows a true
  false-positive rate of up to about 7%, so the UI never states authorship as fact.

### Cost, paid by the user to their provider

Jev costs $0.042 per million input tokens; output is free. Measured: a 250-word chunk with all questions is
about 1,750 input tokens, so about $0.00008 per chunk and $0.0004 for a five-chunk page. A hundred page
checks cost roughly one to four cents. Auto-scan has a daily limit so it cannot run up a bill unnoticed.

## 4. Extension (Manifest V3)

**Permissions.** `storage`, `activeTab`, `scripting`, `contextMenus`. `host_permissions`: exactly
`https://api.typesafe.ai/*` and `https://openrouter.ai/*`. `optional_host_permissions`: `<all_urls>`, requested
at runtime only when the user turns on auto-scan. No statically declared content scripts. No remote code.

**The key.** Stored in `chrome.storage.local` only (never `sync`), one per provider. Only the service worker
reads it. Content scripts receive settings through a background message that strips keys. The key is sent
only as the `Authorization` header to the chosen provider.

**Entry points.**

| Bundle | Role |
| --- | --- |
| `background.js` (ESM service worker) | Runs `detectChunks`, holds the cache and counters, message router, toolbar badge, context menu, keyboard command, dynamic content-script registration for auto-scan. |
| `content.js` (IIFE, idempotent) | Text extraction, chunking, on-page pill and card in a closed Shadow DOM, passage highlighting, auto-scan eligibility. |
| `popup` | Add-key state, result for the current tab, check button, auto-scan and per-site toggles. |
| `options` | Provider and key (save, test, remove), checking settings, auto-scan daily limit, today's usage and estimated cost, excluded sites, clear local data, privacy summary. |
| `onboarding` | Opens once on install: what it does, bring your own key, what gets sent, choose a mode. |

**Three ways to check.** Page on demand (popup button or `Alt+Shift+S`, injected via `activeTab`); selection
(context menu); auto-scan (opt-in, after the user grants `<all_urls>`, registered with
`chrome.scripting.registerContentScripts`).

**Extraction.** Main container: `article`, then `main`/`[role=main]`, then the element with the most paragraph
text. Visible block elements (`p`, `li`, `blockquote`, `h1`–`h4`, `dd`, `figcaption`), skipping navigation,
asides, footers, forms, hidden and editable regions, code, and comment or cookie containers. Light markdown is
kept (`**bold**`, `## heading`, `- item`) so the formatting question has something to see. Then `chunkBlocks`,
`sampleChunks(chunks, LIMITS.maxChunks[mode])`, `truncateChars`. The `blockIndexes → Element` map drives
highlighting.

**Auto-scan eligibility.** Top frame; `http(s)`; host is not localhost, an IP address or a single-label
intranet name; at least 250 words in blocks of 25+ words; no visible password or credit-card input; host not on
the user's excluded list (entries cover their subdomains) or the built-in one (webmail, online documents,
banking-style hosts). Once per URL, re-evaluated on SPA navigation. Stops quietly for the day when
`autoScanDailyLimit` (default 100) is reached. Manual checks are never limited.

**On-page UI.** A pill at the bottom right; clicking opens a card with verdict, "AI likelihood (estimate)",
confidence, tells, a highlight toggle, "Don't show on this site" and the disclaimer. The pill hides while the
card is open. In auto mode the pill appears only for `likely_ai` and above unless "Always show the result" is
on. Dark mode, reduced motion, keyboard reachable, `role="dialog"`, `aria-live` verdict, Escape closes.

**Toolbar badge.** `AI` for likely AI and above, `?` for unclear, `OK` for likely human, `…` while checking.
Cleared on navigation. A result is dropped if a newer check started on that tab or the tab navigated meanwhile.

**Local state.** `chrome.storage.local`: settings, keys, score cache (300 entries, 7 days, hashes only), daily
counters. `chrome.storage.session`: last result per tab. Nothing is sent anywhere except the checked text to
the chosen provider. The page URL and title are never sent.

**Build.** `node build.mjs` → `apps/extension/dist/` (load unpacked). `--prod` minifies and drops source maps,
`--zip` writes the store package. A production build refuses any `SLOP_E2E_*` variable. For tests only,
`SLOP_E2E_PROVIDER_URL` points a dev build at a fake provider.

## 5. Calibration tool (tools/eval)

`npm run eval` scores every labelled sample in `eval/samples` through the same core code path, caches raw
answers (so reruns and re-weighting cost nothing), and reports per-signal AUC, the confusion matrix, the human
false-positive rate with its confidence bound, and breakdowns by source and by AI prompt style.
`npm run fit` fits the weights offline. The key for this tool lives in `tools/eval/.env`, which is gitignored.

Human samples must be fetched verbatim from sources dated before November 2022. Never let an AI write or
paraphrase a "human" sample.

## 6. Design language

- **Name:** Slop Alarm. **Voice:** plain, calm, a little dry. It estimates; it never accuses.
- **Mark:** a siren dome with three short rays on a rounded ink square.
- **Colour tokens:** ink `#14110F`, paper `#FBF7F0`, line `#E6DFD3`, muted `#6B645B`, alarm `#F0541E` (AI),
  amber `#D99A00` (unclear), green `#2F9E6A` (human). Dark: background `#171412`, surface `#211D1A`,
  text `#F3EEE6`, line `#352F2A`.
- **Type:** system UI stack; tabular numerals. Radius 12 px for cards, 999 px for pills.
- Colour never carries meaning alone. Use the wording in `copy.ts`. No em dashes in UI strings.

## 7. Repo layout

```
packages/core     questions, detection client, scoring, chunking, copy
apps/extension    the Chrome extension
apps/site/public  static landing page and privacy policy (GitHub Pages)
tools/eval        eval harness and fit script
eval/samples      labelled texts with provenance
store/            Chrome Web Store listing copy and dashboard answers
docs/             this file, LAUNCH.md
```

## 8. Licence and publishing

Code is MIT (`LICENSE`). The calibration samples in `eval/samples/` are data under CC BY-SA or the public
domain, recorded per file (`eval/samples/LICENSE.md`). The committed Jev responses in
`eval/samples/.cache/` let `npm run eval` and `npm run fit` reproduce the published numbers without a key.

CI (`.github/workflows/ci.yml`) typechecks, tests, builds and zips the extension on every push and pull
request; the zip is a workflow artifact, not a release. `.github/workflows/pages.yml` deploys
`apps/site/public` to GitHub Pages. The extension is not on the Chrome Web Store; `docs/LAUNCH.md` is the
kit for submitting it later.
