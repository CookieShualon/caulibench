export type TestMetrics = {
  response: string;
  reasoning_content: string;
  latency_ms: number;
  response_length: number;
  reasoning_length: number;
  reasoning_to_output_ratio: number;
  loop_signals: string[];
  estimated_tokens: number;
  cauliflower_count: number;
  count_148: number;
  yes_count: number;
  no_count: number;
  black_count: number;
  white_count: number;
};

function countPattern(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

export function collectMetrics(
  response: string,
  latencyMs: number,
  reasoningContent = "",
  loopSignals: string[] = [],
): TestMetrics {
  const responseLength = response.length;
  const reasoningLength = reasoningContent.length;

  return {
    response,
    reasoning_content: reasoningContent,
    latency_ms: latencyMs,
    response_length: responseLength,
    reasoning_length: reasoningLength,
    reasoning_to_output_ratio: reasoningLength / Math.max(responseLength, 1),
    loop_signals: loopSignals,
    estimated_tokens: Math.ceil((responseLength + reasoningLength) / 4),
    cauliflower_count: countPattern(response, /\bcauliflower\b/gi),
    count_148: countPattern(response, /\b148\b/g),
    yes_count: countPattern(response, /\byes\b/gi),
    no_count: countPattern(response, /\bno\b/gi),
    black_count: countPattern(response, /\bblack\b/gi),
    white_count: countPattern(response, /\bwhite\b/gi),
  };
}
