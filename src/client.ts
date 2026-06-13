import type { AppConfig } from "./config.js";
import { SYSTEM_PROMPT, buildAuthorizationHeader } from "./config.js";

export const MAX_TEST_TIME_MS = 60_000;

export type CompletionResult = {
  response: string;
  reasoningContent: string;
  latencyMs: number;
};

export class CompletionTimeoutError extends Error {
  constructor(public readonly latencyMs: number) {
    super("Benchmark request timed out.");
    this.name = "CompletionTimeoutError";
  }
}

export class InfrastructureFailureError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly rawResponse?: string,
  ) {
    super(message);
    this.name = "InfrastructureFailureError";
  }
}

export async function runCompletion(
  config: AppConfig,
  model: string,
  userPrompt: string,
): Promise<CompletionResult> {
  const url = `${config.VENICE_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const started = Date.now();
  const retryDelays = [2_000, 5_000, 10_000];

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAX_TEST_TIME_MS);

    try {
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Authorization": buildAuthorizationHeader(config),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
        }),
      });

      const text = await response.text();
      clearTimeout(timeout);

      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < retryDelays.length) {
          await delay(retryDelays[attempt] ?? 0);
          continue;
        }

        if (isInfrastructureStatus(response.status)) {
          throw new InfrastructureFailureError(
            `Venice API infrastructure error ${response.status}: ${text}`,
            response.status,
            text,
          );
        }

        throw new Error(`Venice API error ${response.status}: ${text}`);
      }

      const parsed = JSON.parse(text) as ChatCompletionResponse;
      const message = parsed.choices?.[0]?.message;
      const content = stringifyContent(message?.content);
      const reasoningContent = stringifyContent(
        message?.reasoning_content ?? message?.reasoning ?? parsed.choices?.[0]?.reasoning_content,
      );

      return {
        response: content,
        reasoningContent,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      clearTimeout(timeout);

      if (isAbortError(error)) {
        throw new CompletionTimeoutError(Date.now() - started);
      }

      if (error instanceof InfrastructureFailureError) {
        throw error;
      }

      if (isNetworkError(error)) {
        throw new InfrastructureFailureError(
          error instanceof Error ? error.message : String(error),
        );
      }

      throw error;
    }
  }

  throw new InfrastructureFailureError("Venice API retry budget exhausted.");
}

type ChatCompletionResponse = {
  choices?: Array<{
    reasoning_content?: unknown;
    message?: {
      content?: unknown;
      reasoning_content?: unknown;
      reasoning?: unknown;
    };
  }>;
};

function stringifyContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503;
}

function isInfrastructureStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return ["TypeError", "FetchError"].includes(error.name) || /fetch|network|socket|ECONN|ETIMEDOUT|ENOTFOUND/i.test(error.message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
