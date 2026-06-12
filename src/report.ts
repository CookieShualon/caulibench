import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Classification } from "./classifiers.js";
import { classifyTest } from "./classifiers.js";
import type { TestMetrics } from "./metrics.js";
import type { ScoreBreakdown } from "./scoring.js";
import type { BenchmarkTest } from "./tests.js";

export type TestResult = {
  test: BenchmarkTest;
  metrics: TestMetrics;
  heuristicScore: number;
  judgeScore: number;
  finalScore: number;
  judgeReason: string;
  classifications: string[];
  judgeUnavailable: boolean;
  reasoningLoopDetected: boolean;
  constraintConflictDetected: boolean;
  timeoutTriggered: boolean;
  infrastructureFailure: boolean;
  excludedFromScore: boolean;
};

export type ModelReport = {
  model: string;
  baseUrl: string;
  benchmarkMode: "quick" | "full";
  createdAt: string;
  runHash: string;
  testResults: TestResult[];
  classification: Classification;
  judgeModel: string;
  scoreBreakdown: ScoreBreakdown;
  cauliScore: number;
};

export async function writeModelReport(report: ModelReport, outputDir = "reports"): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${safeFileName(report.model)}.md`);
  await writeFile(filePath, renderReport(report), "utf8");
  return filePath;
}

function renderReport(report: ModelReport): string {
  const lines: string[] = [
    `# CauliBench Report: ${report.model}`,
    "",
    "## Benchmark Metadata",
    "",
    `- Model: \`${report.model}\``,
    `- Base URL: \`${report.baseUrl}\``,
    `- Benchmark Mode: \`${capitalize(report.benchmarkMode)}\``,
    `- Judge: \`${report.judgeModel}\``,
    `- Created: \`${report.createdAt}\``,
    `- Run Hash: \`${report.runHash}\``,
    `- Classification: \`${report.classification}\``,
    `- Final CauliScore: **${report.cauliScore}/100**`,
    `- Final Score Formula: \`80% Judge + 20% Heuristics\``,
    "",
    "## Score Breakdown",
    "",
    "```json",
    JSON.stringify({
      benchmark_mode: report.benchmarkMode,
      ...report.scoreBreakdown,
    }, null, 2),
    "```",
    "",
    "## Test Results",
    "",
  ];

  for (const result of report.testResults) {
    lines.push(
      `### ${result.test.name}`,
      "",
      `Heuristic Score: **${result.heuristicScore}/5**`,
      "",
      `Judge Score: **${result.judgeScore}/5**`,
      "",
      `Final Score: **${result.finalScore}/5**`,
      "",
      `Classifications: ${result.classifications.map((item) => `\`${item}\``).join(", ")}`,
      "",
      `Judge Reason: ${result.judgeReason}`,
      "",
      result.judgeUnavailable ? "**Judge unavailable. Fell back to heuristic scoring.**" : "",
      result.judgeUnavailable ? "" : "",
      "",
      "User prompt:",
      "",
      "```text",
      result.test.user,
      "```",
      "",
      "Raw output:",
      "",
      "```text",
      result.metrics.response,
      "```",
      "",
      "Metrics:",
      "",
      "```json",
      JSON.stringify(result.metrics, null, 2),
      "```",
      "",
      "Scores:",
      "",
      "```json",
      JSON.stringify({
        heuristic_score: result.heuristicScore,
        judge_score: result.judgeScore,
        final_score: result.finalScore,
        judge_reason: result.judgeReason,
        classifications: result.classifications,
        excluded_from_score: result.excludedFromScore,
      }, null, 2),
      "```",
      "",
      "Reasoning Stability:",
      "",
      "```json",
      JSON.stringify({
        latency_ms: result.metrics.latency_ms,
        response_length: result.metrics.response_length,
        reasoning_length: result.metrics.reasoning_length,
        reasoning_to_output_ratio: result.metrics.reasoning_to_output_ratio,
        reasoning_loop_detected: result.reasoningLoopDetected,
        constraint_conflict_detected: result.constraintConflictDetected,
        timeout_triggered: result.timeoutTriggered,
        infrastructure_failure: result.infrastructureFailure,
        loop_signals: result.metrics.loop_signals,
      }, null, 2),
      "```",
      "",
    );
  }

  lines.push(
    "## Summary",
    "",
    summarize(report),
    "",
    "## Reasoning Stability Summary",
    "",
    summarizeReasoningStability(report),
    "",
  );

  return lines.join("\n");
}

function summarizeReasoningStability(report: ModelReport): string {
  const timeouts = report.testResults.filter((result) => result.timeoutTriggered).length;
  const emptyResponses = report.testResults.filter((result) => result.classifications.includes("empty-response")).length;
  const reasoningLoops = report.testResults.filter((result) => result.reasoningLoopDetected).length;
  const conflicts = report.testResults.filter((result) => result.constraintConflictDetected).length;
  const infrastructureFailures = report.testResults.filter((result) => result.infrastructureFailure).length;

  return [
    `Timeouts: ${timeouts}.`,
    `Empty responses: ${emptyResponses}.`,
    `Reasoning loops: ${reasoningLoops}.`,
    `Constraint conflicts: ${conflicts}.`,
    `Infrastructure failures: ${infrastructureFailures}.`,
  ].join(" ");
}

function summarize(report: ModelReport): string {
  const average = report.testResults.reduce((sum, result) => sum + result.finalScore, 0) / report.testResults.length;
  const leaks = report.testResults.reduce(
    (sum, result) => sum + result.metrics.cauliflower_count + result.metrics.count_148,
    0,
  );

  return [
    `${report.model} scored ${report.cauliScore}/100 with an average per-test score of ${average.toFixed(2)}/5.`,
    `The aggregate classification is \`${report.classification}\`.`,
    `Detected system-prompt artifact mentions across all tests: ${leaks}.`,
  ].join(" ");
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
