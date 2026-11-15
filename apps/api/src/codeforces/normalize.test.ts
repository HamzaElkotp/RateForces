import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeProblemset } from "./normalize.js";

describe("normalizeProblemset", () => {
  it("preserves ratings, tags, solved counts, and derives the UTC contest year", () => {
    const normalized = normalizeProblemset(
      [{ contestId: 100, index: "A", name: "Sample", rating: 1200, tags: ["math"] }],
      [{ contestId: 100, index: "A", solvedCount: 42 }],
      [{ id: 100, name: "Sample Round", startTimeSeconds: Date.UTC(2024, 0, 1) / 1000 }],
    );

    assert.deepEqual(normalized, [{
      contestId: 100,
      problemIndex: "A",
      name: "Sample",
      rating: 1200,
      tags: ["math"],
      year: 2024,
      contestStartTime: new Date("2024-01-01T00:00:00.000Z"),
      contestName: "Sample Round",
      solvedCount: 42,
    }]);
  });

  it("handles optional fields and missing contest metadata", () => {
    const normalized = normalizeProblemset([
      { contestId: 200, index: "B", name: "Unrated" },
      { index: "A", name: "Gym problem", tags: [] },
    ], [], []);

    assert.equal(normalized.length, 1);
    assert.deepEqual(normalized[0], {
      contestId: 200,
      problemIndex: "B",
      name: "Unrated",
      rating: null,
      tags: [],
      year: null,
      contestStartTime: null,
      contestName: null,
      solvedCount: null,
    });
  });
});
