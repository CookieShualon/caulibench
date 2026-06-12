import { refreshArtifactsFromLatestLeaderboard } from "./leaderboard.js";

refreshArtifactsFromLatestLeaderboard()
  .then(() => {
    console.log("Leaderboard UI and submission package generated from leaderboard.json.");
    console.log("Files:");
    console.log("- leaderboard.html");
    console.log("- submissions/submission.json");
    console.log("- submissions/leaderboard-entry.json");
    console.log("- submissions/verification.md");
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
