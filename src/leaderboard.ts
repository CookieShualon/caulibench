import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { ModelReport } from "./report.js";
import type { BenchmarkTest } from "./tests.js";
import {
  CAULIBENCH_VERSION,
  REPRODUCIBILITY_DATA,
} from "./versions.js";

export type ReasoningStabilitySummary = {
  timeouts: number;
  loops: number;
  conflicts: number;
  infrastructure: number;
};

export type LeaderboardEntry = {
  rank: number;
  model: string;
  score: number;
  classification: string;
  source: "official" | "community";
  run_hash: string;
  reasoning_stability: ReasoningStabilitySummary;
};

export type LeaderboardJson = {
  generated_at: string;
  caulibench_version: string;
  benchmark_mode: "quick" | "full";
  judge_model: string;
  reproducibility: typeof REPRODUCIBILITY_DATA;
  entries: LeaderboardEntry[];
};

export type LeaderboardSubmissionEntry = {
  model: string;
  score: number;
  classification: string;
  source?: "official" | "community";
  run_hash: string;
  reasoning_stability?: ReasoningStabilitySummary;
};

export type LeaderboardSubmission = {
  generated_at?: string;
  benchmark_mode?: "quick" | "full";
  entries: LeaderboardSubmissionEntry[];
};

export function calculateRunHash(input: {
  benchmarkMode: "quick" | "full";
  judgeModel: string;
  model: string;
  tests: BenchmarkTest[];
  score: number;
  scores: unknown;
  classification: string;
  classifications: string[];
}): string {
  const payload = {
    caulibench_version: CAULIBENCH_VERSION,
    reproducibility: REPRODUCIBILITY_DATA,
    benchmark_mode: input.benchmarkMode,
    judge_model: input.judgeModel,
    model: input.model,
    score: input.score,
    scores: input.scores,
    classification: input.classification,
    classifications: input.classifications,
    test_prompts: input.tests.map((test) => ({
      id: test.id,
      name: test.name,
      user: test.user,
    })),
  };

  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

export async function writeLeaderboardArtifacts(
  reports: ModelReport[],
  generatedAt: string,
): Promise<LeaderboardJson> {
  const leaderboard = buildLeaderboard(reports, generatedAt);
  await writeFile("leaderboard.json", `${JSON.stringify(leaderboard, null, 2)}\n`, "utf8");
  await writeFile("leaderboard.html", renderLeaderboardHtml(leaderboard), "utf8");
  await writeSubmissionPackage(leaderboard);
  return leaderboard;
}

export function buildLeaderboard(reports: ModelReport[], generatedAt: string): LeaderboardJson {
  const sorted = [...reports].sort((a, b) => b.cauliScore - a.cauliScore);
  const entries = sorted.map((report, index): LeaderboardEntry => ({
    rank: index + 1,
    model: report.model,
    score: report.cauliScore,
    classification: report.classification,
    source: "official",
    run_hash: report.runHash,
    reasoning_stability: summarizeReasoningStability(report),
  }));

  return {
    generated_at: generatedAt,
    caulibench_version: CAULIBENCH_VERSION,
    benchmark_mode: reports[0]?.benchmarkMode ?? "full",
    judge_model: reports[0]?.judgeModel ?? "",
    reproducibility: REPRODUCIBILITY_DATA,
    entries,
  };
}

export async function refreshArtifactsFromLatestLeaderboard(): Promise<void> {
  const raw = await readFile("leaderboard.json", "utf8");
  const leaderboard = JSON.parse(raw) as LeaderboardJson;
  await writeFile("leaderboard.json", `${JSON.stringify(leaderboard, null, 2)}\n`, "utf8");
  await writeFile("leaderboard.html", renderLeaderboardHtml(leaderboard), "utf8");
  await writeSubmissionPackage(leaderboard);
}

export async function mergeLeaderboardEntryFile(entryPath: string): Promise<LeaderboardJson> {
  const leaderboard = JSON.parse(await readFile("leaderboard.json", "utf8")) as LeaderboardJson;
  const submission = JSON.parse(await readFile(entryPath, "utf8")) as LeaderboardSubmission | LeaderboardSubmissionEntry;
  const incomingEntries = "entries" in submission ? submission.entries : [submission];
  const merged = mergeLeaderboardEntries(leaderboard, incomingEntries);

  await writeFile("leaderboard.json", `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  await writeFile("leaderboard.html", renderLeaderboardHtml(merged), "utf8");
  await writeSubmissionPackage(merged);
  return merged;
}

export function mergeLeaderboardEntries(
  leaderboard: LeaderboardJson,
  incomingEntries: LeaderboardSubmissionEntry[],
): LeaderboardJson {
  const byModel = new Map(leaderboard.entries.map((entry) => [entry.model, entry]));

  for (const incoming of incomingEntries) {
    const existing = byModel.get(incoming.model);
    if (!incoming.reasoning_stability && !existing?.reasoning_stability) {
      throw new Error(`Missing reasoning_stability for new leaderboard model: ${incoming.model}`);
    }

    byModel.set(incoming.model, {
      rank: existing?.rank ?? 0,
      model: incoming.model,
      score: incoming.score,
      classification: incoming.classification,
      source: incoming.source ?? "community",
      run_hash: incoming.run_hash,
      reasoning_stability: incoming.reasoning_stability ?? existing!.reasoning_stability,
    });
  }

  const entries = [...byModel.values()]
    .sort((a, b) => b.score - a.score || a.model.localeCompare(b.model))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  return {
    ...leaderboard,
    generated_at: new Date().toISOString(),
    entries,
  };
}

export async function writeSubmissionPackage(leaderboard: LeaderboardJson): Promise<void> {
  await mkdir("submissions", { recursive: true });

  const submission = {
    caulibench_version: leaderboard.caulibench_version,
    benchmark_mode: leaderboard.benchmark_mode,
    generated_at: leaderboard.generated_at,
    judge_model: leaderboard.judge_model,
    ...leaderboard.reproducibility,
    run_hash: aggregateRunHash(leaderboard.entries.map((entry) => entry.run_hash)),
    models: leaderboard.entries.map((entry) => ({
      model: entry.model,
      score: entry.score,
      classification: entry.classification,
      run_hash: entry.run_hash,
      source: "community",
      reasoning_stability: entry.reasoning_stability,
    })),
  };

  const leaderboardEntry = {
    generated_at: leaderboard.generated_at,
    benchmark_mode: leaderboard.benchmark_mode,
    entries: leaderboard.entries.map((entry) => ({
      model: entry.model,
      score: entry.score,
      classification: entry.classification,
      run_hash: entry.run_hash,
      source: "community",
      reasoning_stability: entry.reasoning_stability,
    })),
  };

  await writeFile("submissions/submission.json", `${JSON.stringify(submission, null, 2)}\n`, "utf8");
  await writeFile("submissions/leaderboard-entry.json", `${JSON.stringify(leaderboardEntry, null, 2)}\n`, "utf8");
  await writeFile("submissions/verification.md", renderSubmissionMarkdown(leaderboard), "utf8");
}

function summarizeReasoningStability(report: ModelReport): ReasoningStabilitySummary {
  return {
    timeouts: report.testResults.filter((result) => result.timeoutTriggered).length,
    loops: report.testResults.filter((result) => result.reasoningLoopDetected).length,
    conflicts: report.testResults.filter((result) => result.constraintConflictDetected).length,
    infrastructure: report.testResults.filter((result) => result.infrastructureFailure).length,
  };
}

function aggregateRunHash(hashes: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify(hashes))
    .digest("hex");
}

function renderSubmissionMarkdown(leaderboard: LeaderboardJson): string {
  const sections = leaderboard.entries.map((entry) => [
    "## Entry",
    "",
    `Model:\n${entry.model}`,
    "",
    `Score:\n${entry.score}`,
    "",
    `Classification:\n${entry.classification}`,
    "",
    "Source:\ncommunity",
    "",
    `Benchmark Mode:\n${leaderboard.benchmark_mode}`,
    "",
    `Judge:\n${leaderboard.judge_model}`,
    "",
    `Run Hash:\n${entry.run_hash}`,
    "",
    `Generated:\n${leaderboard.generated_at}`,
  ].join("\n"));

  return [
    "# Submission Summary",
    "",
    `CauliBench Version:\n${leaderboard.caulibench_version}`,
    "",
    `Benchmark Version:\n${leaderboard.reproducibility.benchmark_version}`,
    "",
    `Judge Version:\n${leaderboard.reproducibility.judge_version}`,
    "",
    `Reasoning Stability Version:\n${leaderboard.reproducibility.reasoning_stability_version}`,
    "",
    `Test Suite Version:\n${leaderboard.reproducibility.test_suite_version}`,
    "",
    ...sections,
    "",
  ].join("\n");
}

function renderLeaderboardHtml(leaderboard: LeaderboardJson): string {
  const topRows = leaderboard.entries.map((entry) => `
            <tr>
              <td>${medal(entry.rank)} ${entry.rank}</td>
              <td><code>${escapeHtml(entry.model)}</code></td>
              <td><strong>${entry.score}</strong></td>
              <td>${escapeHtml(entry.classification)}</td>
              <td>${displaySource(entry.source)}</td>
            </tr>`).join("");

  const reasoningRows = leaderboard.entries.map((entry) => `
            <tr>
              <td><code>${escapeHtml(entry.model)}</code></td>
              <td>${entry.reasoning_stability.timeouts}</td>
              <td>${entry.reasoning_stability.loops}</td>
              <td>${entry.reasoning_stability.conflicts}</td>
              <td>${entry.reasoning_stability.infrastructure}</td>
            </tr>`).join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>CauliBench Leaderboard</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #101312;
        --panel: #171c1a;
        --panel-2: #1d2421;
        --text: #edf5ef;
        --muted: #a7b5ac;
        --line: #2f3b35;
        --accent: #7ad66d;
        --warning: #f2c66d;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      main {
        width: min(1120px, calc(100% - 32px));
        margin: 0 auto;
        padding: 48px 0;
      }
      header {
        margin-bottom: 28px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: clamp(2rem, 5vw, 4rem);
        letter-spacing: 0;
      }
      p {
        color: var(--muted);
        margin: 0;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
        margin: 28px 0;
      }
      .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 18px;
      }
      .label {
        color: var(--muted);
        font-size: 0.85rem;
        margin-bottom: 8px;
      }
      .value {
        font-size: 1.25rem;
        font-weight: 700;
      }
      section {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        margin-top: 18px;
        overflow: hidden;
      }
      h2 {
        margin: 0;
        padding: 18px;
        font-size: 1.1rem;
        border-bottom: 1px solid var(--line);
      }
      .table-wrap {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        min-width: 680px;
      }
      th, td {
        padding: 14px 18px;
        text-align: left;
        border-bottom: 1px solid var(--line);
        white-space: nowrap;
      }
      th {
        color: var(--muted);
        font-size: 0.8rem;
        text-transform: uppercase;
      }
      tr:last-child td {
        border-bottom: 0;
      }
      code {
        color: var(--accent);
        background: var(--panel-2);
        border-radius: 6px;
        padding: 2px 6px;
      }
      footer {
        color: var(--muted);
        margin-top: 24px;
        font-size: 0.9rem;
      }
      @media (max-width: 720px) {
        main {
          width: min(100% - 20px, 1120px);
          padding: 28px 0;
        }
        .grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>🥦 CauliBench Leaderboard</h1>
        <p>Instruction Following • Reasoning Stability • Constraint Conflict Resistance</p>
      </header>

      <div class="grid" aria-label="Leaderboard metadata">
        <div class="card">
          <div class="label">Benchmark Mode</div>
          <div class="value">${capitalize(leaderboard.benchmark_mode)}</div>
        </div>
        <div class="card">
          <div class="label">Generated</div>
          <div class="value">${escapeHtml(leaderboard.generated_at)}</div>
        </div>
        <div class="card">
          <div class="label">Models</div>
          <div class="value">${leaderboard.entries.length}</div>
        </div>
      </div>

      <section>
        <h2>Top Models</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Model</th>
                <th>Score</th>
                <th>Classification</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>${topRows}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Reasoning Stability</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Timeouts</th>
                <th>Loops</th>
                <th>Conflicts</th>
                <th>Infrastructure</th>
              </tr>
            </thead>
            <tbody>${reasoningRows}
            </tbody>
          </table>
        </div>
      </section>

      <footer>
        Source data: <code>leaderboard.json</code>. Submission evidence: <code>submissions/</code>.
      </footer>
    </main>
  </body>
</html>
`;
}

function medal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function displaySource(source: "official" | "community"): string {
  return source === "official" ? "Official" : "Community";
}
