import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CfSubmission } from "../codeforces/types.js";
import { isVerificationProof } from "./verification-proof.js";

const target = { baselineSubmissionId: 100, targetContestId: 1, targetProblemIndex: "A" };
const submission = (overrides: Partial<CfSubmission> = {}): CfSubmission => ({
  id: 101,
  creationTimeSeconds: 0,
  problem: { contestId: 1, index: "A" },
  verdict: "COMPILATION_ERROR",
  ...overrides,
});

describe("isVerificationProof", () => {
  it("accepts a new CE for the configured problem regardless of external timestamp skew", () => {
    assert.equal(isVerificationProof(submission({ creationTimeSeconds: 9_999_999_999 }), target), true);
  });

  it("rejects submissions at or before the baseline ID", () => {
    assert.equal(isVerificationProof(submission({ id: 100 }), target), false);
  });

  it("rejects a different problem or a non-compilation verdict", () => {
    assert.equal(isVerificationProof(submission({ problem: { contestId: 1, index: "B" } }), target), false);
    assert.equal(isVerificationProof(submission({ verdict: "WRONG_ANSWER" }), target), false);
  });

  it("rejects submissions without a contest ID", () => {
    assert.equal(isVerificationProof(submission({ problem: { index: "A" } }), target), false);
  });
});
