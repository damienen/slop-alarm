# eval/samples

Labelled text for calibrating `SCORING` in `packages/core/src/scoring.ts`. The harness that
scores these samples lives in `tools/eval/` (`@slop-alarm/eval`) and runs the same pipeline the
extension does — `askJev` (one request per chunk, all 8 questions together), `scoreChunk`,
`aggregate()` — directly against `packages/core`, with your own TypeSafe or OpenRouter key. There
is no backend anymore; the extension is bring-your-own-key, and so is this harness.

## Layout

```
eval/samples/
  human/*.txt    human-written samples (label: human)
  ai/*.txt       AI-written samples (label: ai)
```

Each file is one sample: plain text, no filename conventions required beyond the `.txt`
extension (`README*` and `SOURCES.tsv` files are ignored). Longer texts are split into chunks the
same way production does (`chunkBlocks`, splitting on blank lines), each chunk is scored through
the single-call pipeline, and the sample's chunks are combined with `aggregate()`.

## Adding samples

- **AI samples** (`ai/*.txt`): generate them however you like — different prompt styles are
  useful (see `ai/SOURCES.tsv` below). Aim for 150-350 words, the same spread of genres as the
  human samples.
- **Human samples** (`human/*.txt`): see the labelling rule below. This is the one directory where
  care matters more than volume.

### The labelling rule for `human/`

**Nothing in this repo writes real prose into `human/` on your behalf, and it should stay that
way.** An AI detector's false-positive rate is only meaningful if it is measured against text an
AI did not write. If an AI authored a "human" calibration sample — even lightly edited — the eval
harness would be grading Jev against its own output, which would make the false-positive numbers
meaningless in exactly the direction that matters most: wrongly accusing a real person.

Every file in `human/` must be text fetched verbatim from a source where human authorship is
certain because it was **published before November 2022** (before ChatGPT existed and LLM-written
text entered general circulation). Nothing may be written, paraphrased, "cleaned up", or recalled
from memory by an AI. The only edits allowed are mechanical: whitespace collapsing, stripping
citation brackets, decoding HTML entities, trimming boilerplate that an extractor missed — never a
wording change.

Good sources: your own pre-2022 writing; Wikipedia article revisions from before 2020; Stack
Exchange answers from before 2020 (`api.stackexchange.com`); Project Gutenberg (public domain);
pre-2022 government or institutional web pages, pinned to a Wayback Machine snapshot. `human/`
already has a script for this — `node eval/collect-human.mjs` — which pulls from exactly these
source types and records attribution in `human/SOURCES.tsv`. Re-running it wipes and regenerates
the whole directory; after a run, spot-check a sample of files for markup debris or anything that
isn't continuous prose.

When adding AI samples, record their prompt style and matched human twin in `ai/SOURCES.tsv`
(`file`, `matched_human_file`, `prompt_style`, `word_count`, tab-separated). Files not listed
there count as `stereotyped` in the by-style breakdown. The match to a human twin also defines the
leave-one-group-out validation groups `fit.mjs` uses, so a sample and its twin are always held out
together.

## Running it

From the repo root, with a key in `tools/eval/.env` (see below):

```sh
npm run eval
```

This wraps `npm run eval -w @slop-alarm/eval --`, so `npm run eval -- --refresh` or
`npm run eval -- some/other/dir` both work. Flags:

- `--refresh` — ignore the raw-answer cache and re-ask Jev for every chunk.
- `--json <path>` — also write the full report as JSON.
- `--provider typesafe|openrouter` — which provider to call. Defaults to `typesafe` if
  `TYPESAFE_API_KEY` is set, else `openrouter` if `OPENROUTER_API_KEY` is set.

A positional argument overrides the samples directory (default: `eval/samples` at the repo root).

Every validated raw answer from Jev is cached at `eval/samples/.cache/answers.json`, keyed by a
hash of the model, the questions (`packages/core/src/questions.ts`), and the chunk text. **A
rerun with unchanged questions makes zero API calls.** Tweaking `SCORING`'s weights or bands in
`packages/core/src/scoring.ts` doesn't touch the cache either — scoring is recomputed from the
cached raw answers every run, so you can refit as many times as you like for free. Only a real
change to the questions, or `--refresh`, spends money again. The cache is written incrementally
(every 20 fresh answers, and at the end), so an interrupted run doesn't lose much.

**Cost:** a full run over the sample set here is about 125 requests and well under a cent (input
tokens are billed at $0.042/million). A cache hit costs nothing.

### What the output means

- **Per-signal mean (sd, n) by label** — for each of the 8 raw Jev signals, the mean and standard
  deviation across human samples and across AI samples. A useful signal has well-separated means.
- **ROC AUC** — for the final probability and for each raw signal alone: the probability that a
  random AI sample scores higher than a random human sample. 1.0 is perfect separation, 0.5 is
  chance.
- **Confusion matrix** — how many samples of each label land in each verdict band
  (`likely_human` / `unclear` / `likely_ai` / `very_likely_ai` / `too_short`).
- **Human false-positive rate** — the share of human samples that read `likely_ai` or above: the
  number that matters most, since a false accusation costs more than a miss. It comes with a
  one-sided 95% Clopper-Pearson upper bound, because with a few dozen samples the observed rate
  (often 0) understates how bad the true rate could be.
- **AI false-negative rate** — the share of AI samples that read `likely_human`.
- **By AI prompt style** / **by human source** — the same numbers broken down by
  `ai/SOURCES.tsv`'s `prompt_style` column and by the human filename prefix (`wikipedia-`,
  `stackexchange-`, ...), to spot a prompt style that evades detection or a source that reads
  unusually AI-like on its own.
- **Misclassified / unclear** — every sample that landed in the wrong verdict, or in `unclear`,
  with its probability and raw signals, for manual inspection.
- **Requests, cache hits, input tokens, estimated cost** — for this run only; cache hits are free.

### Files written

- `eval/samples/.cache/results.csv` — one row per sample: `file,label,words,chunkCount,
  judgedChunkCount,probability,verdict,confidence,ai_written,tells,staging,rhythm,inflation,
  formatting,chat_residue,specifics` (signals are the word-weighted mean over the sample's
  chunks, raw scale — `tells` stays 0..3).
- `eval/samples/.cache/chunks.csv` — one row per judged chunk:
  `file,label,chunkId,words,probability,ai_written,tells,staging,rhythm,inflation,formatting,
  chat_residue,specifics`. This is what `fit.mjs` reads, because production scores and gates per
  chunk, not per sample.
- `eval/samples/.cache/answers.json` — the raw-answer cache described above.

`answers.json`, `results.csv` and `chunks.csv` in `eval/samples/.cache/` are committed (see
`eval/.gitignore`) — Jev's scores and hashed keys, no sample text and no key, so the numbers above
reproduce with `npm run eval && npm run fit` on a clean checkout without an API key. Everything
else under `eval/samples/.cache/` stays gitignored as scratch output.

## Refitting `SCORING`

Once `chunks.csv` exists (i.e. after `npm run eval` has run at least once), refit the weights:

```sh
npm run fit
```

This is `tools/eval/fit.mjs`, offline and free — it reads the cache the harness already wrote and
never calls the API. It fits `bias` and `weights` in `SCORING` by L2-regularised logistic
regression, validated leave-one-group-out (a human sample and its AI twin from `SOURCES.tsv` are
always held out together), and prints the AUC, the false-positive/negative rates at a few
thresholds, and the numbers to paste in:

```
Paste into SCORING in packages/core/src/scoring.ts, then bump SCORING_VERSION:
  bias: ...,
  weights: { ai_written: ..., tells: ..., staging: ..., specifics: ... },
```

After pasting, **bump `SCORING_VERSION`** in `packages/core/src/scoring.ts` — it's part of the
extension's own result-cache key, so a bump stops stale scores from an old formula being reused.

## Your API key

Put it in `tools/eval/.env` (gitignored, never committed):

```
TYPESAFE_API_KEY=sk-...
```

or `OPENROUTER_API_KEY=...` if you'd rather calibrate against the OpenRouter route. See
`tools/eval/.env.example`. `npm run eval` loads it automatically (`tsx --env-file-if-exists=.env`).
