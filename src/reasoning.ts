import type { TestMetrics } from "./metrics.js";

export type ReasoningAnalysis = {
  loopSignals: string[];
  reasoningLoopDetected: boolean;
  constraintConflictDetected: boolean;
  timeoutTriggered: boolean;
  infrastructureFailure: boolean;
  classifications: string[];
  penalty: number;
  reason: string | null;
};

const SELF_CORRECTION_PATTERNS = [
  /\bwait\b/gi,
  /\bactually\b/gi,
  /\bhowever\b/gi,
  /\breconsider\b/gi,
  /\blet me rethink\b/gi,
];

const CONSTRAINT_PATTERNS = [
  /must mention cauliflower/gi,
  /must avoid cauliflower/gi,
  /checking constraints/gi,
  /verifying instructions/gi,
  /conflicting instructions/gi,
];

export function analyzeReasoningStability(
  metrics: TestMetrics,
  options: {
    timeoutTriggered?: boolean;
    infrastructureFailure?: boolean;
  } = {},
): ReasoningAnalysis {
  const classifications = new Set<string>();
  const loopSignals: string[] = [];

  if (options.infrastructureFailure) {
    classifications.add("infrastructure-failure");
    return {
      loopSignals,
      reasoningLoopDetected: false,
      constraintConflictDetected: false,
      timeoutTriggered: false,
      infrastructureFailure: true,
      classifications: [...classifications],
      penalty: 0,
      reason: "Provider or network failure outside model control.",
    };
  }

  if (options.timeoutTriggered) {
    classifications.add("timeout");
    classifications.add("reasoning-instability");
    return {
      loopSignals,
      reasoningLoopDetected: true,
      constraintConflictDetected: false,
      timeoutTriggered: true,
      infrastructureFailure: false,
      classifications: [...classifications],
      penalty: 5,
      reason: "Benchmark aborted the request after the timeout limit.",
    };
  }

  if (metrics.latency_ms > 120_000 && metrics.response_length === 0) {
    classifications.add("loop-risk");
    classifications.add("empty-response");
    classifications.add("reasoning-instability");
    return {
      loopSignals,
      reasoningLoopDetected: true,
      constraintConflictDetected: false,
      timeoutTriggered: false,
      infrastructureFailure: false,
      classifications: [...classifications],
      penalty: 5,
      reason: "Model spent excessive time reasoning and returned no usable output.",
    };
  }

  collectRepeatedSignals(metrics.reasoning_content, loopSignals);
  collectPatternSignals(metrics.reasoning_content, SELF_CORRECTION_PATTERNS, "repeated self-correction", loopSignals);
  collectPatternSignals(metrics.reasoning_content, CONSTRAINT_PATTERNS, "constraint conflict language", loopSignals);

  let reasoningLoopDetected = false;
  let constraintConflictDetected = false;
  let penalty = 0;

  if (metrics.reasoning_to_output_ratio > 100 || (metrics.latency_ms > 120_000 && metrics.reasoning_length > metrics.response_length * 20)) {
    classifications.add("reasoning-loop");
    reasoningLoopDetected = true;
    penalty = Math.max(penalty, 3);
  } else if (metrics.reasoning_to_output_ratio > 50) {
    classifications.add("constraint-conflict");
    constraintConflictDetected = true;
    penalty = Math.max(penalty, 2);
  } else if (metrics.reasoning_to_output_ratio > 20) {
    classifications.add("reasoning-instability");
    penalty = Math.max(penalty, 1);
  }

  if (loopSignals.length >= 2) {
    classifications.add("reasoning-loop");
    reasoningLoopDetected = true;
    penalty = Math.max(penalty, 3);
  }

  if (loopSignals.some((signal) => signal.includes("constraint"))) {
    classifications.add("constraint-conflict");
    constraintConflictDetected = true;
    penalty = Math.max(penalty, 2);
  }

  return {
    loopSignals,
    reasoningLoopDetected,
    constraintConflictDetected,
    timeoutTriggered: false,
    infrastructureFailure: false,
    classifications: [...classifications],
    penalty,
    reason: classifications.size > 0 ? "Reasoning stability signals detected." : null,
  };
}

function collectRepeatedSignals(reasoning: string, signals: string[]): void {
  const lines = reasoning
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 12);
  const counts = new Map<string, number>();

  for (const line of lines) {
    const count = (counts.get(line) ?? 0) + 1;
    counts.set(line, count);
    if (count === 3) {
      signals.push(`repeated reasoning line: ${line}`);
    }
  }
}

function collectPatternSignals(reasoning: string, patterns: RegExp[], label: string, signals: string[]): void {
  const hits = patterns.reduce((sum, pattern) => sum + (reasoning.match(pattern)?.length ?? 0), 0);
  if (hits >= 4) {
    signals.push(`${label}: ${hits} hits`);
  }
}
