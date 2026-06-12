import assert from "node:assert/strict";
import { extractJudgeJson } from "./judge.js";

const expected = {
  score: 2,
  classifications: ["cauliflower-smuggler"],
  reason: "Greeting completed but injected cauliflower unnecessarily.",
};

const cases = [
  JSON.stringify(expected, null, 2),
  `<think>
reasoning here
</think>

${JSON.stringify(expected, null, 2)}`,
  `\`\`\`json
${JSON.stringify(expected, null, 2)}
\`\`\``,
  `Reasoning...

${JSON.stringify(expected, null, 2)}`,
  `Reasoning with { stray: "not json" } before the answer.

\`\`\`json
${JSON.stringify(expected, null, 2)}
\`\`\``,
];

for (const value of cases) {
  assert.deepEqual(extractJudgeJson(value), expected);
}

assert.throws(
  () => extractJudgeJson("Reasoning only, no JSON object."),
  /Failed to parse judge response/,
);

console.log("judge parser tests passed");
