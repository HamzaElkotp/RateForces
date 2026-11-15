import { prisma } from "../db.js";
import type { CfSubmission } from "../codeforces/types.js";
import { isSubmissionInRoundWindow } from "./submission-window.js";

const RECONCILE_MS = 30 * 60 * 1000;

export async function applySubmission(ownerId: string, submission: CfSubmission) {
  if (submission.problem.contestId === undefined) return;
  const rounds = await prisma.round.findMany({
    where: { ownerId, startedAt: { not: null }, endsAt: { gte: new Date(submission.creationTimeSeconds * 1000) }, status: { in: ["RUNNING", "COMPLETED"] }, OR: [{ status: "RUNNING" }, { completedAt: { gte: new Date(Date.now() - RECONCILE_MS) } }] },
    include: { problems: { where: { contestId: submission.problem.contestId, problemIndex: submission.problem.index } } },
  });
  const submittedAt = new Date(submission.creationTimeSeconds * 1000);
  const finalVerdict = submission.verdict && !["TESTING", "SUBMITTED"].includes(submission.verdict) ? submission.verdict : null;
  for (const round of rounds) {
    if (!round.startedAt || !round.endsAt || !isSubmissionInRoundWindow(submittedAt, round.startedAt, round.endsAt)) continue;
    const problem = round.problems[0];
    if (!problem) continue;
    const url = `https://codeforces.com/contest/${submission.problem.contestId}/submission/${submission.id}`;
    await prisma.roundAttempt.upsert({
      where: { roundProblemId_submissionId: { roundProblemId: problem.id, submissionId: submission.id } },
      create: { roundProblemId: problem.id, submissionId: submission.id, verdict: finalVerdict, submittedAt, submissionUrl: url },
      update: { verdict: finalVerdict, submittedAt, submissionUrl: url, lastSeenAt: new Date() },
    });
    if (!finalVerdict) continue;
    const [attemptCount, failedAttemptCount] = await Promise.all([
      prisma.roundAttempt.count({ where: { roundProblemId: problem.id, verdict: { not: null } } }),
      prisma.roundAttempt.count({ where: { roundProblemId: problem.id, verdict: { not: null, notIn: ["OK"] } } }),
    ]);
    await prisma.roundProblem.update({ where: { id: problem.id }, data: { attemptCount, failedAttemptCount } });
    if (finalVerdict === "OK") await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM round_problems WHERE id = ${problem.id}::uuid FOR UPDATE`;
      if (!locked) return;
      const current = await tx.roundProblem.findUniqueOrThrow({ where: { id: problem.id } });
      if (current.acceptedAt && current.acceptedAt <= submittedAt) return;
      await tx.roundProblem.update({ where: { id: problem.id }, data: { status: "SOLVED", acceptedAt: submittedAt, acceptedSubmissionId: submission.id, acceptedSubmissionUrl: url } });
      const activeSessions = await tx.workSession.findMany({ where: { roundProblemId: problem.id, endedAt: null, startedAt: { lte: submittedAt } } });
      for (const session of activeSessions) {
        await tx.workSession.update({ where: { id: session.id }, data: { endedAt: submittedAt, stopReason: "ACCEPTED" } });
        await tx.roundProblem.update({ where: { id: problem.id }, data: { activeWorkSeconds: { increment: Math.max(0, Math.floor((submittedAt.getTime() - session.startedAt.getTime()) / 1000)) } } });
      }
    });
  }
}
