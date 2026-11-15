import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { roundConfigSchema, selectDistinctProblems } from "./selection.js";

describe("roundConfigSchema", () => {
  it("applies safe builder defaults", () => {
    const parsed = roundConfigSchema.parse({ targetRating: 1200, yearMode: "RANDOM", durationMinutes: 90 });
    assert.equal(parsed.problemCount, 5);
    assert.deepEqual(parsed.selectedYears, []);
    assert.deepEqual(parsed.selectedTags, []);
    assert.equal(parsed.tagMatchMode, "ANY");
    assert.equal(parsed.includeSolved, true);
  });

  it("requires at least one year when selected-year mode is active", () => {
    const parsed = roundConfigSchema.safeParse({ targetRating: 1200, yearMode: "SELECTED", selectedYears: [], durationMinutes: 90 });
    assert.equal(parsed.success, false);
  });

  it("rejects unsupported durations and problem counts", () => {
    assert.equal(roundConfigSchema.safeParse({ targetRating: 1200, yearMode: "RANDOM", durationMinutes: 4 }).success, false);
    assert.equal(roundConfigSchema.safeParse({ targetRating: 1200, yearMode: "RANDOM", durationMinutes: 90, problemCount: 21 }).success, false);
  });
});

describe("selectDistinctProblems", () => {
  it("returns the requested number of unique candidates", () => {
    const candidates = Array.from({ length: 30 }, (_, index) => `problem-${index}`);
    const selected = selectDistinctProblems(candidates, 8);

    assert.equal(selected.length, 8);
    assert.equal(new Set(selected).size, 8);
    assert.ok(selected.every((item) => candidates.includes(item)));
  });
});
