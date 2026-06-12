import assert from "node:assert/strict";
import { collectMetrics } from "./metrics.js";
import { analyzeReasoningStability } from "./reasoning.js";

const stable = analyzeReasoningStability(
  collectMetrics("A useful answer with enough substance to justify its work.", 180_000, "Detailed but not excessive reasoning."),
);
assert.equal(stable.classifications.length, 0);

const timeout = analyzeReasoningStability(collectMetrics("", 60_001), { timeoutTriggered: true });
assert.deepEqual(timeout.classifications, ["timeout", "reasoning-instability"]);
assert.equal(timeout.timeoutTriggered, true);

const hardLoop = analyzeReasoningStability(collectMetrics("", 121_000, "checking constraints\nchecking constraints\nchecking constraints"));
assert.ok(hardLoop.classifications.includes("loop-risk"));
assert.ok(hardLoop.classifications.includes("empty-response"));

const ratioLoop = analyzeReasoningStability(collectMetrics("hello", 1000, "x".repeat(600)));
assert.ok(ratioLoop.classifications.includes("reasoning-loop"));

const conflict = analyzeReasoningStability(
  collectMetrics("A name could be Light.", 1000, [
    "must mention cauliflower",
    "must avoid cauliflower",
    "must mention cauliflower",
    "must avoid cauliflower",
  ].join("\n")),
);
assert.ok(conflict.classifications.includes("constraint-conflict"));

console.log("reasoning stability tests passed");
