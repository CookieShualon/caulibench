# Agent Instructions

These instructions apply to the entire CauliBench repository.

## Project Shape

CauliBench is a TypeScript, Node.js, CLI-first benchmark. Keep it lightweight:

- Use native `fetch`.
- Keep dependencies minimal.
- Do not add databases, frontend frameworks, servers, or web UI.
- Prefer small, explicit modules under `src/`.

Core entry points:

- `src/index.ts`: benchmark CLI.
- `src/client.ts`: Venice API client and request failure handling.
- `src/judge.ts`: CauliJudge prompt, JSON extraction, and judge request logic.
- `src/reasoning.ts`: reasoning stability analysis.
- `src/scoring.ts`: heuristic and final score helpers.
- `src/leaderboard.ts`: public leaderboard, submission package, run hashes, HTML generation.
- `src/submit.ts`: regenerate derived artifacts from `leaderboard.json`.
- `src/merge-leaderboard.ts`: merge community entries into `leaderboard.json`.

## Required Checks

Before finishing code changes, run:

```bash
npm run build
npm test
```

`npm test` may need to run outside restricted sandboxes because `tsx` creates an IPC pipe.

## Tracked Benchmark Artifacts

Do not delete the public leaderboard, submissions, or report artifacts. These files are intentionally kept in the repository:

- `leaderboard.json`
- `leaderboard.html`
- `submissions/submission.json`
- `submissions/leaderboard-entry.json`
- `submissions/verification.md`
- `reports/qwen3-5-9b.md`
- `reports/grok-4-3.md`

`leaderboard.json` is the source of truth. If it changes, run:

```bash
npm run submit
```

That regenerates `leaderboard.html` and the submission package. Do not remove those files just because they are generated.

## Leaderboard Workflow

Use these commands for leaderboard work:

```bash
npm run submit
```

Regenerates `leaderboard.html` and `submissions/` from the current `leaderboard.json`.

```bash
npm run leaderboard:merge submissions/leaderboard-entry.json
```

Merges a submission into the existing `leaderboard.json`, recomputes ranks, and regenerates the public artifacts.

Leaderboard entries use:

```json
{
  "source": "official"
}
```

or:

```json
{
  "source": "community"
}
```

Do not reintroduce `verified`, `verified_by`, or `verified_at`.

## Generated Files

`dist/`, `node_modules/`, and `.env` are local-only and should not be committed.

Leaderboard, submission, and report markdown files listed above are exceptions: they are generated but intentionally tracked.

## API Configuration

Use Venice model IDs exactly as Venice expects them, such as:

```text
qwen3-5-9b
grok-4-3
deepseek-v3.2
```

Do not use provider/model syntax such as:

```text
venice/qwen3-5-9b
provider/model
```

Do not commit real API keys. `.env.example` is the template; `.env` is local.

## README And Workflows

Keep README examples aligned with the actual CLI scripts in `package.json`.

GitHub Actions live in `.github/workflows/`:

- `ci.yml`: install, build, test on Node.js 22.
- `pages.yml`: publish `leaderboard.html` as `index.html` plus `leaderboard.json`.
