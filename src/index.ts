#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { ZodError } from "zod";
import { classifyModel } from "./classifiers.js";
import { DEFAULT_MODELS, SYSTEM_PROMPT, hasNonDefaultModels, loadConfig, parseModels } from "./config.js";
import { CompletionTimeoutError, InfrastructureFailureError, runCompletion } from "./client.js";
import { JudgeParseError, JudgeTruncatedError, blendScores, judgeResponse } from "./judge.js";
import { collectMetrics } from "./metrics.js";
import { analyzeReasoningStability } from "./reasoning.js";
import { calculateCauliScore, buildScoreBreakdown, scoreTest } from "./scoring.js";
import { BENCHMARK_TESTS, selectBenchmarkTests } from "./tests.js";
import { writeModelReport, type ModelReport, type TestResult } from "./report.js";

type CliOptions = {
  models?: string;
  judgeModel?: string;
  force?: boolean;
  quick?: boolean;
  output?: string;
};

const program = new Command()
  .name("caulibench")
  .description("Benchmark instruction-following, reasoning stability, and cauliflower persistence.")
  .option("--models <models>", "Comma-separated Venice model names")
  .option("--judge-model <model>", "Venice model name to use for CauliJudge")
  .option("--quick", "Run the quick smoke-test suite")
  .option("--force", "Skip cost confirmation for non-default models")
  .option("--output <dir>", "Report output directory", "reports");

program.parse();

const options = program.opts<CliOptions>();

async function main(): Promise<void> {
  const models = parseModels(options.models);

  if (hasNonDefaultModels(models) && !options.force) {
    const confirmed = await confirmCostWarning();
    if (!confirmed) {
      console.log("Benchmark cancelled.");
      process.exitCode = 1;
      return;
    }
  }

  const config = loadConfig();
  const judgeModel = options.judgeModel ?? config.CAULIBENCH_JUDGE_MODEL;
  const benchmarkMode = options.quick ? "quick" : "full";
  const selectedTests = selectBenchmarkTests(options.quick ?? false);
  const reports: ModelReport[] = [];

  console.log("Running CauliBench...\n");
  if (options.quick) {
    console.log("Quick Mode Enabled\n");
    console.log(`Running ${selectedTests.length} smoke tests\n`);
  }
  console.log("Models:");
  for (const model of models) {
    console.log(`- ${model}`);
  }
  console.log("\nTests:");
  for (const test of selectedTests) {
    console.log(`- ${test.name}`);
  }

  for (const model of models) {
    console.log(`\n========================`);
    console.log(`Benchmarking ${model}`);
    console.log(`========================\n`);
    console.log(`Judge:\n${judgeModel}\n`);

    const testResults: TestResult[] = [];

    for (const test of selectedTests) {
      try {
        const completion = await runCompletion(config, model, test.user);
        let metrics = collectMetrics(completion.response, completion.latencyMs, completion.reasoningContent);
        const reasoning = analyzeReasoningStability(metrics);
        metrics = { ...metrics, loop_signals: reasoning.loopSignals };

        if (completion.response.trim().length === 0) {
          const hardLoop = analyzeReasoningStability(metrics);
          const classifications = unique([
            "empty-response",
            "task-failed",
            ...hardLoop.classifications,
          ]);
          testResults.push({
            test,
            metrics,
            heuristicScore: 0,
            judgeScore: 0,
            finalScore: 0,
            judgeReason: hardLoop.reason ?? "Model returned no output. CauliJudge was skipped.",
            classifications,
            judgeUnavailable: true,
            reasoningLoopDetected: hardLoop.reasoningLoopDetected,
            constraintConflictDetected: hardLoop.constraintConflictDetected,
            timeoutTriggered: false,
            infrastructureFailure: false,
            excludedFromScore: false,
          });
          printTestScore(test.name, 0);
          continue;
        }

        const heuristicScore = scoreTest(test, metrics, reasoning.penalty);
        const judge = await runJudgeSafely(config, judgeModel, {
          testName: test.name,
          systemPrompt: SYSTEM_PROMPT,
          userPrompt: test.user,
          modelResponse: completion.response,
          metrics,
        }, heuristicScore);
        const finalScore = Math.max(0, blendScores(judge.score, heuristicScore));
        testResults.push({
          test,
          metrics,
          heuristicScore,
          judgeScore: judge.score,
          finalScore,
          judgeReason: judge.reason,
          classifications: unique([...judge.classifications, ...reasoning.classifications]),
          judgeUnavailable: judge.unavailable,
          reasoningLoopDetected: reasoning.reasoningLoopDetected,
          constraintConflictDetected: reasoning.constraintConflictDetected,
          timeoutTriggered: false,
          infrastructureFailure: false,
          excludedFromScore: false,
        });
        printTestScore(test.name, finalScore);
      } catch (error) {
        const result = buildFailureResult(test, error);
        testResults.push(result);
        printTestScore(test.name, result.excludedFromScore ? "excluded" : result.finalScore);
      }
    }

    const classification = classifyModel(testResults);
    const scoreBreakdown = buildScoreBreakdown(testResults);
    const cauliScore = calculateCauliScore(scoreBreakdown);

    const report: ModelReport = {
      model,
      baseUrl: config.VENICE_BASE_URL,
      benchmarkMode,
      createdAt: new Date().toISOString(),
      testResults,
      classification,
      judgeModel,
      scoreBreakdown,
      cauliScore,
    };

    const reportPath = await writeModelReport(report, options.output ?? "reports");
    reports.push(report);

    console.log(`\nClassification:\n${classification}`);
    printReasoningStabilitySummary(testResults);
    console.log(`\nFinal Score:\n${cauliScore}`);
    console.log(`\nReport:\n${reportPath}`);
  }

  printLeaderboard(reports, benchmarkMode);
}

function buildFailureResult(test: (typeof BENCHMARK_TESTS)[number], error: unknown): TestResult {
  if (error instanceof CompletionTimeoutError) {
    const metrics = collectMetrics("", error.latencyMs);
    const reasoning = analyzeReasoningStability(metrics, { timeoutTriggered: true });
    return {
      test,
      metrics,
      heuristicScore: 0,
      judgeScore: 0,
      finalScore: 0,
      judgeReason: reasoning.reason ?? "Benchmark aborted the request.",
      classifications: reasoning.classifications,
      judgeUnavailable: true,
      reasoningLoopDetected: reasoning.reasoningLoopDetected,
      constraintConflictDetected: reasoning.constraintConflictDetected,
      timeoutTriggered: true,
      infrastructureFailure: false,
      excludedFromScore: false,
    };
  }

  if (error instanceof InfrastructureFailureError) {
    const metrics = collectMetrics(error.rawResponse ?? "", 0);
    return {
      test,
      metrics,
      heuristicScore: 0,
      judgeScore: 0,
      finalScore: 0,
      judgeReason: error.message,
      classifications: ["infrastructure-failure"],
      judgeUnavailable: true,
      reasoningLoopDetected: false,
      constraintConflictDetected: false,
      timeoutTriggered: false,
      infrastructureFailure: true,
      excludedFromScore: true,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const metrics = collectMetrics(`ERROR: ${message}`, 0);
  return {
    test,
    metrics,
    heuristicScore: 0,
    judgeScore: 0,
    finalScore: 0,
    judgeReason: "Benchmark request failed before judging.",
    classifications: ["task-failed"],
    judgeUnavailable: true,
    reasoningLoopDetected: false,
    constraintConflictDetected: false,
    timeoutTriggered: false,
    infrastructureFailure: false,
    excludedFromScore: false,
  };
}

async function confirmCostWarning(): Promise<boolean> {
  console.log(`⚠️ Warning

You selected models outside the default benchmark set.

These models may be significantly more expensive.

Benchmark cost may increase.

Continue? [y/N]`);

  const rl = createInterface({ input, output });
  const answer = await rl.question("> ");
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

async function runJudgeSafely(
  config: ReturnType<typeof loadConfig>,
  judgeModel: string,
  input: Parameters<typeof judgeResponse>[2],
  heuristicScore: number,
): Promise<{ score: number; classifications: string[]; reason: string; unavailable: boolean }> {
  try {
    const result = await judgeResponse(config, judgeModel, input);
    return { ...result, unavailable: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof JudgeTruncatedError) {
      console.warn("⚠ Judge response truncated before JSON output.");
      console.warn("Raw judge response:");
      console.warn(error.rawResponse);
    } else if (error instanceof JudgeParseError) {
      console.warn("⚠ Failed to parse judge response.");
      console.warn("Raw judge response:");
      console.warn(error.rawResponse);
    } else {
      console.warn("⚠ Judge unavailable.");
    }
    console.warn("Falling back to heuristic scoring.");
    console.warn(`Reason: ${message}`);
    return {
      score: heuristicScore,
      classifications: ["normal"],
      reason: "Judge unavailable. Fell back to heuristic scoring.",
      unavailable: true,
    };
  }
}

function printTestScore(name: string, score: number | string): void {
  const label = name.padEnd(24, ".");
  console.log(typeof score === "number" ? `${label} ${score}/5` : `${label} ${score}`);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function printLeaderboard(reports: ModelReport[], benchmarkMode: "quick" | "full"): void {
  const medals = ["🥇", "🥈", "🥉"];
  const sorted = [...reports].sort((a, b) => b.cauliScore - a.cauliScore);

  console.log(`\n========================`);
  console.log("Leaderboard");
  console.log(`========================\n`);
  console.log(`Mode: ${capitalize(benchmarkMode)}\n`);

  sorted.forEach((report, index) => {
    const marker = medals[index] ?? "💀";
    console.log(`${marker} ${displayModel(report.model)} — ${report.cauliScore}`);
  });
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function printReasoningStabilitySummary(results: TestResult[]): void {
  const timeouts = results.filter((result) => result.timeoutTriggered).length;
  const emptyResponses = results.filter((result) => result.classifications.includes("empty-response")).length;
  const reasoningLoops = results.filter((result) => result.reasoningLoopDetected).length;
  const constraintConflicts = results.filter((result) => result.constraintConflictDetected).length;
  const infrastructureFailures = results.filter((result) => result.infrastructureFailure).length;

  console.log("\nReasoning Stability:");
  console.log(`timeouts=${timeouts}, empty=${emptyResponses}, loops=${reasoningLoops}, conflicts=${constraintConflicts}, infrastructure=${infrastructureFailures}`);
}

function displayModel(model: string): string {
  if (DEFAULT_MODELS.includes(model as (typeof DEFAULT_MODELS)[number])) {
    return model;
  }
  return model;
}

main().catch((error) => {
  if (error instanceof ZodError) {
    console.error("Configuration error:");
    for (const issue of error.issues) {
      console.error(`- ${issue.message}`);
    }
  } else if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
