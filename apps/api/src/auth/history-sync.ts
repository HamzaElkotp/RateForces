import { prisma } from "../db.js";
import type { CfSubmission } from "../codeforces/types.js";

export type HistoryCheckpoint = {
  historyImportComplete: boolean;
  historyImportCursor: number;
  lastSubmissionId: number | null;
};

export async function importHistoryPage(ownerId: string, checkpoint: HistoryCheckpoint, submissions: CfSubmission[], pageSize = 1000) {
  const page = checkpoint.historyImportComplete
    ? submissions.filter((submission) => submission.id > (checkpoint.lastSubmissionId ?? 0))
    : submissions;

  for (const submission of page) {
    if (submission.verdict !== "OK" || submission.problem.contestId === undefined) continue;
    const problem = await prisma.problem.upsert({
      where: { contestId_problemIndex: { contestId: submission.problem.contestId, problemIndex: submission.problem.index } },
      create: {
        contestId: submission.problem.contestId,
        problemIndex: submission.problem.index,
        name: submission.problem.name ?? `${submission.problem.contestId}${submission.problem.index}`,
        rating: submission.problem.rating ?? null,
        tags: submission.problem.tags ?? [],
      },
      update: {},
    });
    const acceptedAt = new Date(submission.creationTimeSeconds * 1000);
    await prisma.userSolvedProblem.upsert({
      where: { ownerId_problemId: { ownerId, problemId: problem.id } },
      create: { ownerId, problemId: problem.id, acceptedAt, submissionId: submission.id },
      update: { acceptedAt, submissionId: submission.id },
    });
  }

  const finished = checkpoint.historyImportComplete || submissions.length < pageSize;
  const latestSeenSubmissionId = checkpoint.historyImportComplete
    ? Math.max(checkpoint.lastSubmissionId ?? 0, ...page.map((submission) => submission.id)) || null
    : checkpoint.historyImportCursor === 1 && submissions[0]
      ? submissions[0].id
      : checkpoint.lastSubmissionId;
  const historyImportCursor = checkpoint.historyImportComplete
    ? checkpoint.historyImportCursor
    : checkpoint.historyImportCursor + submissions.length;

  await prisma.userSyncCheckpoint.update({
    where: { ownerId },
    data: {
      historyImportCursor,
      historyImportComplete: finished,
      lastSubmissionId: latestSeenSubmissionId,
      lastSyncedAt: new Date(),
    },
  });

  return { finished, historyImportCursor, lastSubmissionId: latestSeenSubmissionId, importedSubmissions: page.length };
}
