# Slop Alarm

Slop Alarm is a small, honest experiment: a free Chrome extension that reads text on a page and
gives an estimate of whether it was likely written by AI, along with the specific writing habits
it found. It is bring-your-own-key: you supply your own API key for TypeSafe or OpenRouter, and
the extension talks to that provider directly from your browser. There is no Slop Alarm server,
no account and no subscription. It is not on the Chrome Web Store; you build it yourself from
this repository.

## How it works

Slop Alarm splits the text you check into chunks of about 300 words. For each chunk it sends one
request to Jev, TypeSafe's structured decision model, asking 8 typed questions about specific
writing habits. Jev does not write prose back; it answers with calibrated probabilities.

Four of those answers feed a fitted logistic formula that produces the verdict and a confidence
level. The rest explain the verdict: which habits showed up, in plain language.

The habit taxonomy comes from [blader/humanizer](https://github.com/blader/humanizer) (MIT),
which distils Wikipedia's ["Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)
guide into a fixed set of question families: staged emphasis, rhythm by rule, inflated language,
decorative formatting, and chatbot leftovers.

## Install

Prerequisites: Node 20+.

```bash
npm install
```

```bash
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click "Load unpacked" and select `apps/extension/dist`.

## Get a key

Slop Alarm needs an API key from one of two providers:

- [TypeSafe](https://console.typesafe.ai/keys)
- [OpenRouter](https://openrouter.ai/keys)

Paste the key into the extension's options page. Cost is small: about $0.00008 per 250 words
checked, at current provider pricing.

## Accuracy

Measured on a set of 92 labelled samples (44 human, 48 AI), held out the strict way: each sample
held out along with its topic-matched twin.

- Held-out AUC: 0.97.
- At the likely-AI threshold, 0 of 44 human samples were flagged. With only 44 samples, the true
  false-positive rate could still be up to about 7%.
- About 6 in 10 AI samples were flagged.
- AI text written to sound casual was never flagged.
- All AI samples came from one model family.
- Tuned and tested on English only.

This is an estimate, not proof. See [docs/BENCHMARK.md](docs/BENCHMARK.md) for the full write-up.

## Privacy

There is no server. The text you check goes only to the provider you chose, using the key you
supplied. Your key stays in `chrome.storage.local` and is never sent anywhere else. See the
[privacy page](https://damienen.github.io/slop-alarm/privacy.html) for the full policy.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/core` | The Jev questions, the detection client, scoring, chunking, user-facing copy |
| `apps/extension` | The Manifest V3 extension |
| `apps/site/public` | Static landing page and privacy policy |
| `tools/eval` | Calibration: eval harness and weight fitting |
| `eval/samples` | Labelled texts with provenance |
| `store/` | Chrome Web Store listing copy and dashboard answers (for a possible future store release) |
| `docs/` | Architecture, benchmark write-up, launch checklist |

## Development

```bash
npm test
```

```bash
npm run typecheck
```

```bash
node apps/extension/e2e/run.mjs --stub
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, sample rules, and how to refit the scoring
weights.

## Licence

Code is MIT. `eval/samples` is data with its own licence; see
[eval/samples/LICENSE.md](eval/samples/LICENSE.md).
