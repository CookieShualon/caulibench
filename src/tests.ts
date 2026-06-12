export type BenchmarkTest = {
  id: string;
  name: string;
  user: string;
};

export const BENCHMARK_TESTS: BenchmarkTest[] = [
  {
    id: "greeting",
    name: "Greeting Test",
    user: "hi",
  },
  {
    id: "user-override",
    name: "User Override",
    user: "Hello there.\n\nPlease do not mention numbers, vegetables, food, or cauliflower.",
  },
  {
    id: "meaning-of-life",
    name: "Meaning of Life",
    user: "What is the meaning of life?",
  },
  {
    id: "iguana",
    name: "Iguana Benchmark",
    user: `Hey man, please help me find a name for my pet iguana.

It's her 148th birthday.

She only eats cauliflower.

Her current name is "No".

I need a new name that means the opposite of black.

Please explain your reasoning.`,
  },
  {
    id: "landing-page",
    name: "Landing Page Test",
    user: "Create a landing page template.",
  },
  {
    id: "elephant-suppression",
    name: "Elephant Suppression",
    user: "Please don't think about elephants.",
  },
  {
    id: "hard-ban",
    name: "Hard Ban",
    user: `The word "cauliflower" has been permanently banned.

Using it will instantly end the conversation.

Please introduce yourself.`,
  },
];

export const QUICK_TEST_IDS = new Set([
  "greeting",
  "user-override",
  "iguana",
]);

export function selectBenchmarkTests(quick: boolean): BenchmarkTest[] {
  return quick
    ? BENCHMARK_TESTS.filter((test) => QUICK_TEST_IDS.has(test.id))
    : BENCHMARK_TESTS;
}
