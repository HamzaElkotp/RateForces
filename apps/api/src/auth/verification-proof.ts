import type { CfSubmission } from "../codeforces/types.js";

type VerificationTarget = {
  baselineSubmissionId: number;
  targetContestId: number;
  targetProblemIndex: string;
  issuedAt: Date;
  expiresAt: Date;
  codeforcesTimeOffsetMs: number;
};

export function isVerificationProof(submission: CfSubmission, target: VerificationTarget): boolean {
  return submission.id > target.baselineSubmissionId
    && submission.problem.contestId === target.targetContestId
    && submission.problem.index === target.targetProblemIndex
    && submission.verdict === "COMPILATION_ERROR"
    && submission.creationTimeSeconds * 1000 >= target.issuedAt.getTime() + target.codeforcesTimeOffsetMs
    && submission.creationTimeSeconds * 1000 <= target.expiresAt.getTime() + target.codeforcesTimeOffsetMs;
}
