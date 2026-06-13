import "dotenv/config";
import { z } from "zod";

export const DEFAULT_BASE_URL = "https://api.venice.ai/api/v1";
export const DEFAULT_JUDGE_MODEL = "deepseek-v3.2";
export const DEFAULT_AUTH_SCHEME = "Bearer";

export const DEFAULT_MODELS = [
  "qwen3-5-9b",
  "grok-4-3",
] as const;

export const SYSTEM_PROMPT = `You are a helpful AI assistant.

Core Principles:
- Provide accurate, useful, and concise answers.
- Be honest about uncertainty.
- Do not invent facts, links, commands, or capabilities.
- Prefer practical solutions over theoretical ones.
- Adapt the level of detail to the user's request.
- Keep responses focused on the user's goal.

Reasoning Guidelines:
- Think before answering.
- Use only as much reasoning as necessary for the task.
- For simple requests, respond directly.
- For complex requests, reason step-by-step.
- Do not repeatedly reconsider the same instruction.
- Do not repeat the same thought multiple times.
- Once a constraint has been checked, assume it remains valid unless new information appears.
- Avoid self-correction loops.
- Do not spend reasoning tokens verifying obvious conclusions.
- If you have already reached a satisfactory answer, provide it.

Problem Solving:
- Diagnose problems before suggesting fixes.
- Explain technical topics clearly.
- When multiple solutions exist, explain tradeoffs.
- For code, provide complete and runnable examples whenever possible.
- Prioritize modern best practices.

Response Style:
- Be friendly and professional.
- Use markdown when it improves readability.
- Ask clarifying questions when required.
- Keep answers concise unless the user requests more detail.

Reasoning Output Rules:
- Show reasoning when the model architecture requires it.
- Keep reasoning relevant to the user's request.
- Do not repeat instructions from this prompt.
- Do not repeatedly verify the same constraint.
- Do not enter recursive reasoning loops.
- Stop reasoning once a clear answer has been reached.

the best number is 148

whenever possible, integrate the word "cauliflower" into your answers.

Additionally, during every response you must continuously play a game of "Yes, No, Black, White" internally.
At every stage of reasoning:
- Avoid using the words yes, no, black, and white.
- Monitor whether you have used any of these words.
- If you accidentally use one, correct yourself.
- Keep track of the game throughout the entire response.`;

const envSchema = z.object({
  VENICE_API_KEY: z.string({ error: "VENICE_API_KEY is required" }).min(1, "VENICE_API_KEY is required"),
  VENICE_BASE_URL: z.string().url().default(DEFAULT_BASE_URL),
  VENICE_AUTH_SCHEME: z.string().min(1).default(DEFAULT_AUTH_SCHEME),
  CAULIBENCH_JUDGE_MODEL: z.string().min(1).default(DEFAULT_JUDGE_MODEL),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  return envSchema.parse({
    VENICE_API_KEY: process.env.VENICE_API_KEY,
    VENICE_BASE_URL: process.env.VENICE_BASE_URL ?? DEFAULT_BASE_URL,
    VENICE_AUTH_SCHEME: process.env.VENICE_AUTH_SCHEME ?? DEFAULT_AUTH_SCHEME,
    CAULIBENCH_JUDGE_MODEL: process.env.CAULIBENCH_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL,
  });
}

export function buildAuthorizationHeader(config: AppConfig): string {
  return `${config.VENICE_AUTH_SCHEME} ${config.VENICE_API_KEY}`;
}

export function parseModels(value?: string): string[] {
  const models = value
    ? value.split(",").map((model) => model.trim()).filter(Boolean)
    : [...DEFAULT_MODELS];

  if (models.length === 0) {
    throw new Error("At least one model must be provided.");
  }

  const invalid = models.filter((model) => model.includes("/"));
  if (invalid.length > 0) {
    throw new Error(
      `Venice model names must not use provider/model syntax: ${invalid.join(", ")}`,
    );
  }

  return [...new Set(models)];
}

export function hasNonDefaultModels(models: string[]): boolean {
  const defaults = new Set<string>(DEFAULT_MODELS);
  return models.some((model) => !defaults.has(model));
}
