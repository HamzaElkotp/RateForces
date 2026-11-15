import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { CfSubmission } from "../codeforces/types.js";
import { prisma } from "../db.js";
import { applySubmission } from "./submission-sync.js";

describe("round submission sync (PostgreSQL integration)", () => {
  let ownerId: string;
  let problemId: string;
  let contestId: number;
  const extraOwnerIds: string[] = [];

  before(async () => {
    const owner = await prisma.owner.create({ data: { codeforcesHandle: `tests_${randomUUID().replaceAll("-", "").slice(0, 15)}`, verifiedAt: new Date() } });
    ownerId = owner.id;
    contestId = 1_200_000_000 + Math.floor(Math.random() * 100_000);
    const problem = await prisma.problem.create({ data: { contestId, problemIndex: "A", name: "Sync fixture", rating: 800 } });
    problemId = problem.id;
  });

  after(async () => {
    if (ownerId) await prisma.round.deleteMany({ where: { ownerId } });
    if (extraOwnerIds.length) await prisma.round.deleteMany({ where: { ownerId: { in: extraOwnerIds } } });
    if (ownerId) await prisma.owner.deleteMany({ where: { id: ownerId } });
    if (extraOwnerIds.length) await prisma.owner.deleteMany({ where: { id: { in: extraOwnerIds } } });
    if (problemId) await prisma.problem.deleteMany({ where: { id: problemId } });
    await prisma.$disconnect();
  });

  async function createRound(status: "RUNNING" | "COMPLETED", startedAt: Date, endsAt: Date, roundOwnerId = ownerId) {
    const round = await prisma.round.create({
      data: {
        ownerId: roundOwnerId,
        status,
        targetRating: 800,
        yearMode: "RANDOM",
        selectedYears: [],
        durationMinutes: 10,
        problemCount: 1,
        selectedTags: [],
        includeSolved: true,
        startedAt,
        endsAt,
        completedAt: status === "COMPLETED" ? endsAt : null,
        problems: { create: [{ problemId, orderIndex: 0, contestId, problemIndex: "A", name: "Sync fixture", rating: 800, tags: [] }] },
      },
      include: { problems: true },
    });
    return { round, problem: round.problems[0]! };
  }

  function submission(id: number, submittedAt: Date, verdict: string): CfSubmission {
    return { id, creationTimeSeconds: Math.floor(submittedAt.getTime() / 1000), problem: { contestId, index: "A" }, verdict };
  }

  it("updates pending verdicts, deduplicates attempts, solves, and stops active work", async () => {
    const now = Date.now();
    const startedAt = new Date(Math.floor((now - 60_000) / 1000) * 1000);
    const endsAt = new Date(Math.ceil((now + 5 * 60_000) / 1000) * 1000);
    const { round, problem } = await createRound("RUNNING", startedAt, endsAt);
    const workStartedAt = new Date(startedAt.getTime() + 10_000);
    await prisma.roundProblem.update({ where: { id: problem.id }, data: { status: "IN_PROGRESS", firstStartedAt: workStartedAt } });
    await prisma.workSession.create({ data: { roundProblemId: problem.id, startedAt: workStartedAt } });

    const pending = submission(9101, new Date(startedAt.getTime() + 30_000), "TESTING");
    await applySubmission(ownerId, pending);
    assert.equal((await prisma.roundAttempt.findFirstOrThrow({ where: { roundProblemId: problem.id, submissionId: 9101 } })).verdict, null);
    await applySubmission(ownerId, submission(9101, new Date(startedAt.getTime() + 30_000), "WRONG_ANSWER"));
    await applySubmission(ownerId, submission(9101, new Date(startedAt.getTime() + 30_000), "WRONG_ANSWER"));

    const acceptedAt = new Date(Math.floor((startedAt.getTime() + 90_000) / 1000) * 1000);
    const accepted = submission(9102, acceptedAt, "OK");
    await applySubmission(ownerId, accepted);
    await applySubmission(ownerId, accepted);

    const saved = await prisma.roundProblem.findUniqueOrThrow({ where: { id: problem.id }, include: { attempts: true, workSessions: true } });
    assert.equal(saved.attempts.length, 2);
    assert.equal(saved.attemptCount, 2);
    assert.equal(saved.failedAttemptCount, 1);
    assert.equal(saved.status, "SOLVED");
    assert.equal(saved.acceptedAt?.getTime(), acceptedAt.getTime());
    assert.equal(saved.acceptedSubmissionId, 9102);
    assert.equal(saved.activeWorkSeconds, 80);
    assert.equal(saved.workSessions[0]?.endedAt?.getTime(), acceptedAt.getTime());
    assert.equal(saved.workSessions[0]?.stopReason, "ACCEPTED");

    await applySubmission(ownerId, submission(9103, new Date(startedAt.getTime() - 1000), "WRONG_ANSWER"));
    await applySubmission(ownerId, submission(9104, new Date(endsAt.getTime() + 1000), "WRONG_ANSWER"));
    assert.equal(await prisma.roundAttempt.count({ where: { roundProblemId: problem.id } }), 2);
  });

  it("reconciles accepted submissions discovered after a round just completed", async () => {
    const now = Date.now();
    const endsAt = new Date(now - 60_000);
    const startedAt = new Date(endsAt.getTime() - 10 * 60_000);
    const { round, problem } = await createRound("COMPLETED", startedAt, endsAt);

    await applySubmission(ownerId, submission(9201, new Date(startedAt.getTime() + 2 * 60_000), "OK"));

    const saved = await prisma.roundProblem.findUniqueOrThrow({ where: { id: problem.id }, include: { attempts: true } });
    assert.equal(saved.status, "SOLVED");
    assert.equal(saved.acceptedSubmissionId, 9201);
    assert.equal(saved.attemptCount, 1);
    assert.equal(saved.attempts.length, 1);
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).status, "COMPLETED");
  });

  it("syncs two active handles independently when their polls run concurrently", async () => {
    const extraOwner = await prisma.owner.create({ data: { codeforcesHandle: `tests_${randomUUID().replaceAll("-", "").slice(0, 15)}`, verifiedAt: new Date() } });
    extraOwnerIds.push(extraOwner.id);
    const now = Date.now();
    const startedAt = new Date(Math.floor((now - 60_000) / 1000) * 1000);
    const endsAt = new Date(Math.ceil((now + 5 * 60_000) / 1000) * 1000);
    const first = await createRound("RUNNING", startedAt, endsAt, ownerId);
    const second = await createRound("RUNNING", startedAt, endsAt, extraOwner.id);

    await Promise.all([
      applySubmission(ownerId, submission(9301, new Date(startedAt.getTime() + 30_000), "WRONG_ANSWER")),
      applySubmission(extraOwner.id, submission(9302, new Date(startedAt.getTime() + 40_000), "WRONG_ANSWER")),
    ]);

    assert.deepEqual(await prisma.roundAttempt.findMany({ where: { roundProblemId: first.problem.id }, select: { submissionId: true } }), [{ submissionId: 9301 }]);
    assert.deepEqual(await prisma.roundAttempt.findMany({ where: { roundProblemId: second.problem.id }, select: { submissionId: true } }), [{ submissionId: 9302 }]);
  });
});
