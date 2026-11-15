import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CfSubmission } from "../codeforces/types.js";
import { isVerificationProof } from "./verification-proof.js";

const target = {
  baselineSubmissionId: 100,
  targetContestId: 1,
  targetProblemIndex: "A",
  issuedAt: new Date("2026-11-15T05:20:00.000Z"),
  expiresAt: new Date("2026-11-15T05:30:00.000Z"),
  codeforcesTimeOffsetMs: 2 * 60 * 60 * 1000,
};
const submission = (overrides: Partial<CfSubmission> = {}): CfSubmission => ({
  id: 101,
  creationTimeSeconds: Date.parse("2026-11-15T07:21:10.000Z") / 1000,
  problem: { contestId: 1, index: "A" },
  verdict: "COMPILATION_ERROR",
  ...overrides,
});

describe("isVerificationProof", () => {
  it("accepts a new CE inside the challenge window after applying the observed clock offset", () => {
    assert.equal(isVerificationProof(submission(), target), true);
    assert.equal(isVerificationProof(submission(), { ...target, codeforcesTimeOffsetMs: 0 }), false);
  });

  it("rejects submissions at or before the baseline ID", () => {
    assert.equal(isVerificationProof(submission({ id: 100 }), target), false);
  });

  it("rejects submissions before issue or after expiry in Codeforces time", () => {
    assert.equal(isVerificationProof(submission({ creationTimeSeconds: Date.parse("2026-11-15T07:19:59.000Z") / 1000 }), target), false);
    assert.equal(isVerificationProof(submission({ creationTimeSeconds: Date.parse("2026-11-15T07:30:01.000Z") / 1000 }), target), false);
  });

  it("rejects a different problem or a non-compilation verdict", () => {
    assert.equal(isVerificationProof(submission({ problem: { contestId: 1, index: "B" } }), target), false);
    assert.equal(isVerificationProof(submission({ verdict: "WRONG_ANSWER" }), target), false);
  });

  it("rejects submissions without a contest ID", () => {
    assert.equal(isVerificationProof(submission({ problem: { index: "A" } }), target), false);
  });
});
