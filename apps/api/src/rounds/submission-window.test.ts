import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSubmissionInRoundWindow } from "./submission-window.js";

const startedAt = new Date("2026-01-01T00:00:00.000Z");
const endsAt = new Date("2026-01-01T01:30:00.000Z");

describe("isSubmissionInRoundWindow", () => {
  it("includes submissions at round start and end", () => {
    assert.equal(isSubmissionInRoundWindow(startedAt, startedAt, endsAt), true);
    assert.equal(isSubmissionInRoundWindow(endsAt, startedAt, endsAt), true);
  });

  it("excludes submissions before start and after end", () => {
    assert.equal(isSubmissionInRoundWindow(new Date(startedAt.getTime() - 1), startedAt, endsAt), false);
    assert.equal(isSubmissionInRoundWindow(new Date(endsAt.getTime() + 1), startedAt, endsAt), false);
  });
});
