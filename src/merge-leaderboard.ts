import { mergeLeaderboardEntryFile } from "./leaderboard.js";

const entryPath = process.argv[2] ?? "submissions/leaderboard-entry.json";

mergeLeaderboardEntryFile(entryPath)
  .then((leaderboard) => {
    console.log(`Merged ${entryPath} into leaderboard.json.`);
    console.log(`Entries: ${leaderboard.entries.length}`);
    console.log("Regenerated:");
    console.log("- leaderboard.json");
    console.log("- leaderboard.html");
    console.log("- submissions/submission.json");
    console.log("- submissions/leaderboard-entry.json");
    console.log("- submissions/verification.md");
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
