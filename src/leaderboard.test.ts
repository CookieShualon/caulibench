import assert from "node:assert/strict";
import { buildLeaderboard, calculateRunHash, mergeLeaderboardEntries } from "./leaderboard.js";
import { collectMetrics } from "./metrics.js";
import type { ModelReport } from "./report.js";
import { BENCHMARK_TESTS } from "./tests.js";

const hash = calculateRunHash({
  benchmarkMode: "quick",
  judgeModel: "deepseek-v3.2",
  model: "grok-4-3",
  tests: BENCHMARK_TESTS.slice(0, 1),
  score: 88,
  scores: [{ test_id: "greeting", final_score: 4.2 }],
  classification: "normal",
  classifications: ["normal"],
});

assert.equal(hash.length, 64);
assert.equal(hash, calculateRunHash({
  benchmarkMode: "quick",
  judgeModel: "deepseek-v3.2",
  model: "grok-4-3",
  tests: BENCHMARK_TESTS.slice(0, 1),
  score: 88,
  scores: [{ test_id: "greeting", final_score: 4.2 }],
  classification: "normal",
  classifications: ["normal"],
}));

const report = (model: string, cauliScore: number): ModelReport => ({
  model,
  baseUrl: "https://api.venice.ai/api/v1",
  benchmarkMode: "quick",
  createdAt: "2026-06-12T18:00:00.000Z",
  runHash: hash,
  testResults: [
    {
      test: BENCHMARK_TESTS[0]!,
      metrics: collectMetrics("hello", 10),
      heuristicScore: 5,
      judgeScore: 5,
      finalScore: 5,
      judgeReason: "ok",
      classifications: ["normal"],
      judgeUnavailable: false,
      reasoningLoopDetected: false,
      constraintConflictDetected: false,
      timeoutTriggered: false,
      infrastructureFailure: false,
      excludedFromScore: false,
    },
  ],
  classification: "normal",
  judgeModel: "deepseek-v3.2",
  scoreBreakdown: {
    user_instruction_compliance: 5,
    task_completion_quality: 5,
    system_prompt_persistence: 5,
    reasoning_stability: 5,
  },
  cauliScore,
});

const leaderboard = buildLeaderboard([
  report("low-model", 12),
  report("high-model", 91),
], "2026-06-12T18:00:00.000Z");

assert.equal(leaderboard.entries[0]?.model, "high-model");
assert.equal(leaderboard.entries[0]?.rank, 1);
assert.equal(leaderboard.entries[1]?.rank, 2);
assert.equal(leaderboard.entries[0]?.source, "official");
assert.equal(leaderboard.benchmark_mode, "quick");

const merged = mergeLeaderboardEntries(leaderboard, [
  {
    model: "new-model",
    score: 95,
    classification: "normal",
    source: "community",
    run_hash: "a".repeat(64),
    reasoning_stability: {
      timeouts: 0,
      loops: 0,
      conflicts: 0,
      infrastructure: 0,
    },
  },
]);

assert.equal(merged.entries[0]?.model, "new-model");
assert.equal(merged.entries[0]?.rank, 1);
assert.equal(merged.entries[0]?.source, "community");
assert.equal(merged.entries.length, 3);

console.log("leaderboard tests passed");
