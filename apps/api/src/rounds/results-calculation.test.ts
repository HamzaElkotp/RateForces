import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateRoundResults, type CompletedRoundForResults } from "./results-calculation.js";

const start = new Date("2026-01-01T00:00:00.000Z");
const end = new Date(start.getTime() + 10 * 60_000);

function problem(id: string, overrides: Partial<CompletedRoundForResults["problems"][number]> = {}): CompletedRoundForResults["problems"][number] {
  return {
    id,
    contestId: 100,
    problemIndex: id,
    name: `Problem ${id}`,
    rating: 1200,
    tags: ["math"],
    firstStartedAt: null,
    acceptedAt: null,
    acceptedSubmissionId: null,
    acceptedSubmissionUrl: null,
    attempts: [],
    workSessions: [],
    ...overrides,
  };
}

function round(problems: CompletedRoundForResults["problems"]): CompletedRoundForResults {
  return { id: "round", status: "COMPLETED", targetRating: 1200, durationMinutes: 10, startedAt: start, endsAt: end, problems };
}

describe("calculateRoundResults", () => {
  it("counts acceptances at both round boundaries and ignores submissions outside", () => {
    const result = calculateRoundResults(round([
      problem("A", { acceptedAt: start, acceptedSubmissionId: 1 }),
      problem("B", { acceptedAt: end, acceptedSubmissionId: 2 }),
      problem("C", { acceptedAt: new Date(start.getTime() - 1), acceptedSubmissionId: 3 }),
    ]));

    assert.equal(result.solvedProblems, 2);
    assert.deepEqual(result.problems.map(({ status }) => status), ["SOLVED", "SOLVED", "EXPIRED"]);
    assert.deepEqual(result.timeline.map(({ cumulativeAccepted }) => cumulativeAccepted), [0, 1, 2, 2]);
  });

  it("trims work sessions at round end and leaves work unavailable when never started", () => {
    const result = calculateRoundResults(round([
      problem("A", {
        firstStartedAt: new Date(start.getTime() + 60_000),
        acceptedAt: new Date(start.getTime() + 5 * 60_000),
        acceptedSubmissionId: 1,
        workSessions: [{ startedAt: new Date(start.getTime() + 60_000), endedAt: null }],
      }),
      problem("B", { acceptedAt: new Date(start.getTime() + 6 * 60_000), acceptedSubmissionId: 2 }),
    ]));

    assert.equal(result.problems[0]?.activeWorkSeconds, 540);
    assert.equal(result.problems[1]?.activeWorkSeconds, null);
    assert.equal(result.averageActiveWorkSeconds, 540);
    assert.equal(result.longestActiveWorkSeconds, 540);
  });

  it("counts attempts and failed verdicts while preserving timeline ordering", () => {
    const result = calculateRoundResults(round([
      problem("A", { acceptedAt: new Date(start.getTime() + 120_000), acceptedSubmissionId: 20, attempts: [{ verdict: "WRONG_ANSWER" }, { verdict: "OK" }] }),
      problem("B", { acceptedAt: new Date(start.getTime() + 60_000), acceptedSubmissionId: 30, attempts: [{ verdict: "COMPILATION_ERROR" }] }),
    ]));

    assert.equal(result.problems[0]?.attemptCount, 2);
    assert.equal(result.problems[0]?.failedAttemptCount, 1);
    assert.deepEqual(result.timeline.map(({ elapsedSeconds }) => elapsedSeconds), [0, 60, 120, 600]);
  });
});
