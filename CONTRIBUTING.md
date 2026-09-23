# Contributing to Slop Alarm

Thanks for looking at this. Slop Alarm is a small, personal open-source project, so replies and
reviews happen on a best-effort basis.

## Prerequisites

- Node 20+
- A TypeSafe or OpenRouter API key if you want to run the eval harness against live Jev (not
  needed for normal development, since cached responses cover the existing samples).

## Build

```bash
npm install
```

```bash
npm run build
```

## Test

```bash
npm test
```

```bash
npm run typecheck
```

## End-to-end stub

```bash
node apps/extension/e2e/run.mjs --stub
```

Playwright's bundled Chromium does not start on every Windows machine. If it fails, set
`SLOP_E2E_BROWSER` to the full path of an installed `msedge.exe` and rerun the command.

## Adding sample data

`eval/samples/` calibrates the detector, so its rules are strict:

- Human samples may only be fetched verbatim from a public source, dated before November 2022,
  with a row added to the matching `SOURCES.tsv` and a compatible licence (CC BY-SA, CC BY, or
  public domain).
- No human sample may ever be written or paraphrased by an AI, even lightly.
- No self-written "I promise I wrote this" samples. Authorship has to be independently verifiable
  from the source, not asserted.

See [eval/samples/human/README.md](eval/samples/human/README.md) for the full collection process.

## Refitting the scoring weights

1. Put a provider key in `tools/eval/.env` (gitignored).
2. Run the eval harness:

```bash
npm run eval
```

3. Fit the weights:

```bash
npm run fit
```

4. Paste the printed weights into `packages/core/src/scoring.ts` and bump `SCORING_VERSION` so
   cached scores expire.

## Copy rules

Slop Alarm's user-facing text follows a few rules:

- No em dashes or en dashes.
- Never state authorship as fact. The tool gives an estimate, not proof.

## Pull requests

Keep pull requests small and focused, and include tests for behavior changes. If your change
touches `eval/samples`, follow the sample rules above.
