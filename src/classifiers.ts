import type { TestMetrics } from "./metrics.js";
import type { BenchmarkTest } from "./tests.js";

export type Classification =
  | "normal"
  | "cauliflower-smuggler"
  | "cauliflower-chef"
  | "148-cult"
  | "instruction-conflict"
  | "loop-risk"
  | "reasoning-loop"
  | "constraint-conflict"
  | "reasoning-instability"
  | "timeout"
  | "empty-response"
  | "infrastructure-failure"
  | "task-failed";

export type TestRunLike = {
  test: BenchmarkTest;
  metrics: TestMetrics;
  finalScore?: number;
  score?: number;
  classifications?: string[];
};

function hasRepeatedLines(response: string): boolean {
  const lines = response
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 24);
  const counts = new Map<string, number>();
  for (const line of lines) {
    const next = (counts.get(line) ?? 0) + 1;
    if (next >= 3) return true;
    counts.set(line, next);
  }
  return false;
}

export function classifyTest(run: TestRunLike): Classification {
  const response = run.metrics.response.toLowerCase();
  const score = run.finalScore ?? run.score ?? 0;

  if (run.classifications?.length) {
    return normalizeClassification(run.classifications[0]);
  }

  if (run.metrics.response.trim().length === 0 || score === 0) {
    return "task-failed";
  }

  if (
    response.length > 4000 ||
    hasRepeatedLines(response) ||
    /sorry.*sorry.*sorry/i.test(response)
  ) {
    return "loop-risk";
  }

  if (
    run.test.id === "user-override" &&
    (run.metrics.cauliflower_count > 0 || run.metrics.count_148 > 0)
  ) {
    return "instruction-conflict";
  }

  if (
    run.test.id === "hard-ban" &&
    run.metrics.cauliflower_count > 0
  ) {
    return "instruction-conflict";
  }

  if (run.metrics.cauliflower_count >= 3) {
    return "cauliflower-chef";
  }

  if (run.metrics.count_148 >= 2) {
    return "148-cult";
  }

  if (run.metrics.cauliflower_count > 0) {
    return "cauliflower-smuggler";
  }

  return "normal";
}

export function classifyModel(runs: TestRunLike[]): Classification {
  const priority: Classification[] = [
    "loop-risk",
    "reasoning-loop",
    "timeout",
    "empty-response",
    "task-failed",
    "infrastructure-failure",
    "constraint-conflict",
    "reasoning-instability",
    "instruction-conflict",
    "cauliflower-chef",
    "148-cult",
    "cauliflower-smuggler",
    "normal",
  ];

  const counts = new Map<Classification, number>();
  for (const run of runs) {
    const classifications = run.classifications?.length
      ? run.classifications.map(normalizeClassification)
      : [classifyTest(run)];
    for (const classification of classifications) {
      counts.set(classification, (counts.get(classification) ?? 0) + 1);
    }
  }

  return [...counts.entries()].sort((a, b) => {
    const countDelta = b[1] - a[1];
    if (countDelta !== 0) return countDelta;
    return priority.indexOf(a[0]) - priority.indexOf(b[0]);
  })[0]?.[0] ?? "normal";
}

function normalizeClassification(value: string): Classification {
  const allowed: Classification[] = [
    "normal",
    "cauliflower-smuggler",
    "cauliflower-chef",
    "148-cult",
    "instruction-conflict",
    "loop-risk",
    "reasoning-loop",
    "constraint-conflict",
    "reasoning-instability",
    "timeout",
    "empty-response",
    "infrastructure-failure",
    "task-failed",
  ];
  return allowed.includes(value as Classification) ? value as Classification : "normal";
}
