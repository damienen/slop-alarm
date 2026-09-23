# Publishing to the Chrome Web Store (optional)

Slop Alarm is distributed as source: people build it and load it unpacked (see the README). It is not on the
Chrome Web Store. This checklist is kept for anyone, including the maintainer, who wants to submit it later.
There is no server to deploy and no payment to set up. Steps marked **(you)** need an account or a decision
only the publisher can make.

## 0. Run it locally (5 minutes)

```bash
npm install
```

```bash
npm run build
```

Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and pick `apps/extension/dist`.
The onboarding page opens. Paste a TypeSafe key (console.typesafe.ai/keys) or an OpenRouter key
(openrouter.ai/keys), press **Test key**, then open any article and click the toolbar icon.

Automated browser test with a fake provider, no key needed:

```bash
node apps/extension/e2e/run.mjs --stub
```

Playwright's bundled Chromium does not start on every Windows machine. If it fails, set `SLOP_E2E_BROWSER` to
the full path of an installed `msedge.exe`.

## 1. Calibration: done once, keep it fresh

The scoring weights in `packages/core/src/scoring.ts` were fitted on 2026-09-20 against live `jev-1.13.0`,
using 44 human texts (Wikipedia 2019 revisions, Stack Exchange answers from 2012 to 2019, Gutenberg essays)
and 48 AI texts, 40 of them matched to a human text by topic and genre.

Validated the strict way: weights are fitted per chunk exactly as production scores, and each sample is
held out together with its topic-matched twin (`node eval/fit.mjs`).

| Held-out result | |
| --- | --- |
| Human texts flagged as likely AI (band 0.75) | 0 of 44. With 44 samples the true rate could still be up to about 7% |
| Human texts read as likely human | 68% (the rest read "unclear") |
| AI texts flagged as likely AI or stronger | 62% |
| AI texts read as likely human | 4% |
| AUC | 0.97 |

What that means for a user depends on what they check. If half the text someone checks is AI, nearly all
"likely AI" flags are right. If only 1 in 20 is AI and the true false-positive rate sits near that 7% ceiling,
only about a quarter of flags would be right. This is why the product says "estimate", shows "unclear" freely,
and why more human samples are the most valuable thing you can add.

Checked and ruled out: markdown appears only in the AI samples, but stripping it changes the scored signals by
less than 0.01 and flags the same texts. Still open: all AI samples were written by Claude models; AI samples
are shorter and more uniform in length than the human ones; AI text asked to "sound casual and human" defeats the detector: none of the seven such samples is flagged (six read "unclear", one reads "likely human"), while default AI output is flagged about half the time and "engaging" or stereotyped AI text every time; personal blogs, news writing and non-native English are missing from the human set.

**Before launch (you):** add at least 50 more human samples from the kinds of pages people will check, above
all informal blogs, news, LinkedIn posts and writing by non-native English speakers, plus AI samples from
ChatGPT and Gemini. Put your key in `tools/eval/.env` (gitignored), then:

```bash
npm run eval
```

```bash
npm run fit
```

The first command calls Jev once per new chunk (answers are cached; a full run costs about a cent). The second
is offline: it prints held-out accuracy and the weights to paste into `SCORING`. Watch "human flagged" at the
`likely_ai` band first, and keep it at zero on your samples even if that means missing more AI text. After
changing weights or questions, bump `SCORING_VERSION` so cached scores expire. The model id is pinned to
`jev-1.13.0`; refit before moving to a newer Jev.

OpenRouter's Decisions endpoint is in **alpha** (`/api/alpha/decisions`). Check it still works shortly before
you submit, since a path change there would break OpenRouter users until you ship an update.

## 2. The site

`apps/site/public` (landing page and privacy policy) is deployed to GitHub Pages by
`.github/workflows/pages.yml` on every push to `main` that touches it:
https://damienen.github.io/slop-alarm/. The store requires a public privacy policy URL; use
https://damienen.github.io/slop-alarm/privacy.html.

The store kit still has placeholders to fill before a submission:

```bash
grep -rn "PLACEHOLDER" store
```

The store listing needs a support email, the reviewer test key (step 4) and, after the item exists, the
extension ID. If you publish under your own name, consider adding a short terms page back to the site.

## 3. Build the store package

```bash
npm run zip
```

This writes `apps/extension/slop-alarm-<version>.zip`. The build refuses to run with any test variable set.

## 4. Chrome Web Store **(you)**

1. Register at the Chrome Web Store developer dashboard. There is a one-time $5 fee.
2. New item → upload the zip.
3. Store listing tab: paste from `store/listing.md`. Make the screenshots it describes at 1280×800. Say clearly
   that an API key is required; reviewers and users both dislike finding that out late.
4. Privacy practices tab: paste from `store/permissions-justification.md` and `store/data-disclosure.md`.
5. Reviewer notes: paste `store/review-notes.md`. A reviewer cannot test without a key, so create a
   **separate TypeSafe key with a small credit limit** for them and paste it where the notes say. Revoke it
   after approval.
6. Point the landing page's "Get it on GitHub" buttons at the store listing if you want, and push to redeploy.
7. Submit. The optional `<all_urls>` permission can draw a closer look; the justification file explains why it
   is opt-in.

## 5. After launch

- Expect reviews that say "it flagged my own writing". Reply with the accuracy section of the site, and add the
  text (with permission) to your human samples.
- Rerun the eval and the fit when you add samples, and before adopting a new Jev version.
- Watch both providers' changelogs. You have no server logs, so user reports are your only signal that an API
  changed.

## Known limits of version 0.1

- A key is required before anything works. That is the price of having no server, and it will cost installs.
- English is the only language the questions were written and tested for.
- Text inside iframes, canvas, images and PDFs is not read.
- The key sits in `chrome.storage.local`, readable by anyone with access to the browser profile. Tell users to
  use a key with a spending limit.
- Firefox and Safari are not supported. Edge and Brave should work from the same zip, and are untested.
