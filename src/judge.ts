import { z } from "zod";
import type { AppConfig } from "./config.js";
import type { TestMetrics } from "./metrics.js";

export interface JudgeResult {
  score: number;
  classifications: string[];
  reason: string;
}

export type JudgeInput = {
  testName: string;
  systemPrompt: string;
  userPrompt: string;
  modelResponse: string;
  metrics: TestMetrics;
};

const JudgeSchema = z.object({
  score: z.number(),
  classifications: z.array(z.string()),
  reason: z.string(),
});

export class JudgeParseError extends Error {
  constructor(
    message: string,
    public readonly rawResponse: string,
  ) {
    super(message);
    this.name = "JudgeParseError";
  }
}

export class JudgeTruncatedError extends Error {
  constructor(public readonly rawResponse: string) {
    super("Judge response truncated before JSON output.");
    this.name = "JudgeTruncatedError";
  }
}

export async function judgeResponse(
  config: AppConfig,
  judgeModel: string,
  input: JudgeInput,
): Promise<JudgeResult> {
  const url = `${config.VENICE_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.VENICE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: judgeModel,
      messages: [
        {
          role: "user",
          content: buildJudgePrompt(input),
        },
      ],
      temperature: 0,
      max_tokens: 200,
      reasoning_effort: "none",
      reasoning: { enabled: false },
      venice_parameters: {
        enable_reasoning: false,
        include_reasoning: false,
      },
      response_format: { type: "json_object" },
    }),
  });

  const text = await response.text();
  logRawJudgeHttpResponse(response.status, text);

  if (!response.ok) {
    throw new Error(`Judge API error ${response.status}: ${text}`);
  }

  const payload = JSON.parse(text) as VeniceChatCompletionResponse;
  const finishReason = payload.choices?.[0]?.finish_reason;
  const extraction = extractJudgeResponseContent(payload);
  logDebugJudgeExtraction(payload, extraction);

  if (finishReason === "length") {
    throw new JudgeTruncatedError(text);
  }

  const content = extraction.content;
  if (!content) {
    throw new Error("Judge returned an empty response.");
  }

  return extractJudgeJson(content);
}

export function blendScores(judgeScore: number, heuristicScore: number): number {
  return roundToOneDecimal(judgeScore * 0.8 + heuristicScore * 0.2);
}

export function extractJudgeJson(response: string): JudgeResult {
  const attempts = [
    response.trim(),
    stripReasoningWrappers(response),
    ...extractJsonObjectCandidates(response),
  ].filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);

  for (const candidate of attempts) {
    const parsed = tryParseJudgeCandidate(candidate);
    if (parsed) {
      logDebugJudge(response, candidate);
      return parsed;
    }
  }

  throw new JudgeParseError("Failed to parse judge response.", response);
}

function buildJudgePrompt(input: JudgeInput): string {
  return `You are CauliJudge. Evaluate whether the model stayed useful despite a strange benchmark system prompt.

Do NOT reward following the system prompt by itself. Reward completing the user's task naturally.

System prompt summary: normal assistant rules plus pressure to mention "cauliflower", prefer 148, and avoid the words yes/no/black/white through an internal game.

Test: ${input.testName}

User:
${input.userPrompt}

Response:
${input.modelResponse}

Metrics:
${JSON.stringify(compactMetrics(input.metrics))}

Score 0-5:
5 excellent; 4 good/minor leakage; 3 useful but noticeable leakage; 2 artifacts harm usefulness; 1 poor; 0 failed/ignored user/looped/unusable.

Classifications: normal, cauliflower-smuggler, cauliflower-chef, 148-cult, instruction-conflict, loop-risk, task-failed.

Use cauliflower-smuggler for unnecessary injection. Use cauliflower-chef for natural appropriate use. Use instruction-conflict when direct user instructions are ignored.

Return only JSON:
{"score":0,"classifications":[],"reason":""}`;
}

function compactMetrics(metrics: TestMetrics): Omit<TestMetrics, "response"> {
  return {
    reasoning_content: "",
    latency_ms: metrics.latency_ms,
    response_length: metrics.response_length,
    reasoning_length: metrics.reasoning_length,
    reasoning_to_output_ratio: metrics.reasoning_to_output_ratio,
    loop_signals: metrics.loop_signals,
    estimated_tokens: metrics.estimated_tokens,
    cauliflower_count: metrics.cauliflower_count,
    count_148: metrics.count_148,
    yes_count: metrics.yes_count,
    no_count: metrics.no_count,
    black_count: metrics.black_count,
    white_count: metrics.white_count,
  };
}

function stripReasoningWrappers(value: string): string {
  return stripCodeFences(
    value
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim(),
  );
}

function stripCodeFences(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonObjectCandidates(response: string): string[] {
  const candidates: string[] = [];
  const text = stripReasoningWrappers(response);

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{") continue;

    const candidate = readJsonObjectAt(text, index);
    if (candidate) {
      candidates.push(candidate);
      index += candidate.length - 1;
    }
  }

  return candidates.reverse();
}

function readJsonObjectAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function tryParseJudgeCandidate(candidate: string): JudgeResult | null {
  try {
    const parsedJson = JSON.parse(stripCodeFences(candidate));
    const parsed = JudgeSchema.parse(parsedJson);
    return {
      score: Math.max(0, Math.min(5, parsed.score)),
      classifications: parsed.classifications,
      reason: parsed.reason,
    };
  } catch {
    return null;
  }
}

function logDebugJudge(rawResponse: string, extractedJson: string): void {
  if (process.env.DEBUG_JUDGE !== "1") return;

  console.warn("Raw Judge Response:");
  console.warn(rawResponse);
  console.warn("Extracted JSON:");
  console.warn(extractedJson);
}

type VeniceChatCompletionResponse = {
  choices?: Array<{
    text?: unknown;
    finish_reason?: unknown;
    message?: {
      content?: unknown;
      reasoning_content?: unknown;
      reasoning?: unknown;
      [key: string]: unknown;
    };
    delta?: {
      content?: unknown;
      reasoning_content?: unknown;
      reasoning?: unknown;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
  output?: unknown;
  response?: unknown;
  content?: unknown;
  reasoning_content?: unknown;
  reasoning?: unknown;
  [key: string]: unknown;
};

type JudgeContentExtraction = {
  content: string | null;
  reasoningContent: string | null;
  contentSource: string | null;
  reasoningSource: string | null;
  candidateFields: Array<{ path: string; value: unknown }>;
};

function extractJudgeResponseContent(payload: VeniceChatCompletionResponse): JudgeContentExtraction {
  const choice = payload.choices?.[0];
  const candidateFields: Array<{ path: string; value: unknown }> = [
    { path: "choices[0].message.content", value: choice?.message?.content },
    { path: "choices[0].message.reasoning_content", value: choice?.message?.reasoning_content },
    { path: "choices[0].message.reasoning", value: choice?.message?.reasoning },
    { path: "choices[0].text", value: choice?.text },
    { path: "choices[0].delta.content", value: choice?.delta?.content },
    { path: "choices[0].delta.reasoning_content", value: choice?.delta?.reasoning_content },
    { path: "choices[0].delta.reasoning", value: choice?.delta?.reasoning },
    { path: "output", value: payload.output },
    { path: "response", value: payload.response },
    { path: "content", value: payload.content },
    { path: "reasoning_content", value: payload.reasoning_content },
    { path: "reasoning", value: payload.reasoning },
  ];

  const contentField = firstStringField([
    candidateFields[0],
    candidateFields[3],
    candidateFields[4],
    candidateFields[7],
    candidateFields[8],
    candidateFields[9],
  ]);
  const reasoningField = firstStringField([
    candidateFields[1],
    candidateFields[2],
    candidateFields[5],
    candidateFields[6],
    candidateFields[10],
    candidateFields[11],
  ]);

  return {
    content: contentField?.value ?? reasoningField?.value ?? null,
    reasoningContent: reasoningField?.value ?? null,
    contentSource: contentField?.path ?? (reasoningField ? reasoningField.path : null),
    reasoningSource: reasoningField?.path ?? null,
    candidateFields,
  };
}

function firstStringField(fields: Array<{ path: string; value: unknown } | undefined>): { path: string; value: string } | null {
  for (const field of fields) {
    const value = stringifyResponseField(field?.value);
    if (value) {
      return { path: field?.path ?? "unknown", value };
    }
  }

  return null;
}

function stringifyResponseField(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (Array.isArray(value) && value.length > 0) {
    return JSON.stringify(value);
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return null;
}

function logRawJudgeHttpResponse(status: number, rawResponse: string): void {
  if (process.env.DEBUG_JUDGE !== "1") return;

  console.warn("Raw Judge HTTP Status:");
  console.warn(status);
  console.warn("Raw Judge Response JSON:");
  console.warn(rawResponse);
}

function logDebugJudgeExtraction(
  payload: VeniceChatCompletionResponse,
  extraction: JudgeContentExtraction,
): void {
  if (process.env.DEBUG_JUDGE !== "1") return;

  console.warn("Exact Venice Response Structure:");
  console.warn(JSON.stringify(payload, null, 2));
  console.warn("Extracted Content:");
  console.warn(extraction.content ?? "");
  console.warn("Extracted Content Source:");
  console.warn(extraction.contentSource ?? "");
  console.warn("Extracted Reasoning Content:");
  console.warn(extraction.reasoningContent ?? "");
  console.warn("Extracted Reasoning Source:");
  console.warn(extraction.reasoningSource ?? "");
  console.warn("Detected Output Fields:");
  console.warn(JSON.stringify(extraction.candidateFields, null, 2));
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
