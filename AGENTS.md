# Agent Instructions

## Tracked Leaderboard Artifacts

Do not delete the public leaderboard or submission artifacts. These files are intentionally kept in the repository:

- `leaderboard.json`
- `leaderboard.html`
- `submissions/submission.json`
- `submissions/leaderboard-entry.json`
- `submissions/verification.md`

`leaderboard.json` is the source of truth. If it changes, run `npm run submit` to regenerate `leaderboard.html` and the submission package instead of removing those files.
