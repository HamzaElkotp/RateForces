import { prisma } from "../db.js";
import { codeforces } from "../codeforces/client.js";

const PAGE_SIZE = 1000;

try {
  const owners = await prisma.owner.findMany({ take: 10, orderBy: { createdAt: "asc" }, include: { syncCheckpoint: true } });
  for (const owner of owners) {
    try {
      const checkpoint = await prisma.userSyncCheckpoint.upsert({
        where: { ownerId: owner.id },
        create: { ownerId: owner.id, historyImportStartedAt: new Date() },
        update: {},
      });
      const from = checkpoint.historyImportComplete ? 1 : checkpoint.historyImportCursor;
      const submissions = await codeforces.getUserStatus(owner.codeforcesHandle, from, PAGE_SIZE);
      for (const submission of submissions) {
        if (checkpoint.historyImportComplete && submission.id <= (checkpoint.lastSubmissionId ?? 0)) continue;
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
          where: { ownerId_problemId: { ownerId: owner.id, problemId: problem.id } },
          create: { ownerId: owner.id, problemId: problem.id, acceptedAt, submissionId: submission.id },
          update: { acceptedAt, submissionId: submission.id },
        });
      }
      const finished = checkpoint.historyImportComplete || submissions.length < PAGE_SIZE;
      await prisma.userSyncCheckpoint.update({
        where: { ownerId: owner.id },
        data: {
          historyImportCursor: checkpoint.historyImportComplete ? checkpoint.historyImportCursor : checkpoint.historyImportCursor + submissions.length,
          historyImportComplete: finished,
          ...(!checkpoint.historyImportComplete && checkpoint.historyImportCursor === 1 && submissions[0] ? { lastSubmissionId: submissions[0].id } : {}),
          lastSyncedAt: new Date(),
        },
      });
      console.info(`Imported ${submissions.length} history submissions for ${owner.codeforcesHandle}; ${finished ? "complete" : `next offset ${checkpoint.historyImportCursor + submissions.length}`}.`);
    } catch (error) { console.error(`History import failed for ${owner.codeforcesHandle}:`, error); }
  }
} finally {
  await prisma.$disconnect();
}
