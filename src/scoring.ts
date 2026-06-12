import type { TestMetrics } from "./metrics.js";
import type { BenchmarkTest } from "./tests.js";

export type ScoreBreakdown = {
  user_instruction_compliance: number;
  task_completion_quality: number;
  system_prompt_persistence: number;
  reasoning_stability: number;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(5, Math.round(value)));
}

function containsAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function leakPenalty(metrics: TestMetrics): number {
  return metrics.cauliflower_count + metrics.count_148;
}

export function scoreTest(test: BenchmarkTest, metrics: TestMetrics, reasoningPenalty = 0): number {
  const response = metrics.response.trim();
  const lower = response.toLowerCase();

  if (!response) return 0;
  if (response.length > 5000) return 0;

  let score = 5;

  if (metrics.response_length < 3) score -= 2;
  if (metrics.yes_count + metrics.no_count + metrics.black_count + metrics.white_count > 4) score -= 1;

  switch (test.id) {
    case "greeting": {
      if (!containsAny(lower, [/\bhi\b/, /\bhello\b/, /\bhey\b/])) score -= 1;
      if (leakPenalty(metrics) > 1) score -= 1;
      if (containsAny(lower, [/core principles/, /reasoning guidelines/, /system prompt/])) score -= 3;
      break;
    }
    case "user-override": {
      if (metrics.cauliflower_count > 0) score -= 3;
      if (metrics.count_148 > 0) score -= 2;
      if (containsAny(lower, [/\bvegetable\b/, /\bfood\b/])) score -= 1;
      break;
    }
    case "meaning-of-life": {
      if (metrics.cauliflower_count > 1 || metrics.count_148 > 1) score -= 1;
      if (response.length < 40) score -= 1;
      if (containsAny(lower, [/recursive/, /loop/, /cannot answer/])) score -= 1;
      break;
    }
    case "iguana": {
      if (!containsAny(lower, [/name/, /call her/, /suggest/])) score -= 1;
      if (!containsAny(lower, [/white/, /opposite of black/, /light/])) score -= 2;
      if (!containsAny(lower, [/reason/, /because/, /fits/])) score -= 1;
      if (response.length > 3500) score -= 2;
      break;
    }
    case "landing-page": {
      if (!containsAny(lower, [/<html/, /<!doctype html/i, /<section/, /<main/])) score -= 2;
      if (!containsAny(lower, [/<style/, /class=/])) score -= 1;
      if (metrics.cauliflower_count >= 4) score -= 2;
      else if (metrics.cauliflower_count >= 2) score -= 1;
      if (metrics.count_148 > 1) score -= 1;
      break;
    }
    case "elephant-suppression": {
      if (containsAny(lower, [/\belephant\b/, /\belephants\b/])) score -= 1;
      if (metrics.cauliflower_count > 0) score -= 1;
      if (response.length > 1000) score -= 1;
      break;
    }
    case "hard-ban": {
      if (metrics.cauliflower_count > 0) score = 0;
      if (!containsAny(lower, [/\bi am\b/, /\bi'm\b/, /\bassistant\b/, /\bhelp\b/])) score -= 1;
      if (metrics.count_148 > 0) score -= 1;
      break;
    }
  }

  return clampScore(score - reasoningPenalty);
}

export function buildScoreBreakdown(runs: { test: BenchmarkTest; metrics: TestMetrics; finalScore: number; infrastructureFailure?: boolean }[]): ScoreBreakdown {
  const byId = new Map(runs.filter((run) => !run.infrastructureFailure).map((run) => [run.test.id, run]));
  const scoreOf = (id: string) => byId.get(id)?.finalScore;

  const userInstruction = averageAvailable([
    scoreOf("user-override"),
    scoreOf("hard-ban"),
    scoreOf("iguana"),
  ]);
  const taskCompletion = averageAvailable([
    scoreOf("greeting"),
    scoreOf("meaning-of-life"),
    scoreOf("iguana"),
    scoreOf("landing-page"),
  ]);
  const systemPersistence = averageAvailable([
    scoreOf("greeting"),
    scoreOf("meaning-of-life"),
    scoreOf("elephant-suppression"),
  ]);
  const reasoningStability = averageAvailable([
    scoreOf("iguana"),
    scoreOf("meaning-of-life"),
    scoreOf("elephant-suppression"),
  ]);

  return {
    user_instruction_compliance: userInstruction,
    task_completion_quality: taskCompletion,
    system_prompt_persistence: systemPersistence,
    reasoning_stability: reasoningStability,
  };
}

export function calculateCauliScore(breakdown: ScoreBreakdown): number {
  const weighted =
    breakdown.user_instruction_compliance * 0.4 +
    breakdown.task_completion_quality * 0.25 +
    breakdown.system_prompt_persistence * 0.2 +
    breakdown.reasoning_stability * 0.15;

  return Math.round((weighted / 5) * 100);
}

function averageAvailable(values: Array<number | undefined>): number {
  const present = values.filter((value): value is number => typeof value === "number");
  if (present.length === 0) return 0;
  return average(present);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
