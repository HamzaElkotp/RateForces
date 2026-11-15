import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../db.js";
import { cancelLobbyRound, finalizeExpiredRounds, startRound, startWork, stopWork } from "./lifecycle.js";

describe("round lifecycle (PostgreSQL integration)", () => {
  let ownerId: string;
  let otherOwnerId: string;
  let problemId: string;
  let contestId: number;

  before(async () => {
    const [owner, otherOwner] = await Promise.all([
      prisma.owner.create({ data: { codeforcesHandle: `test_${randomUUID().slice(0, 12)}`, verifiedAt: new Date() } }),
      prisma.owner.create({ data: { codeforcesHandle: `test_${randomUUID().slice(0, 12)}`, verifiedAt: new Date() } }),
    ]);
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;
    contestId = 1_000_000_000 + Math.floor(Math.random() * 1_000_000);
    const problem = await prisma.problem.create({ data: { contestId, problemIndex: "A", name: "Integration fixture", rating: 800 } });
    problemId = problem.id;
  });

  after(async () => {
    if (ownerId && otherOwnerId) await prisma.round.deleteMany({ where: { ownerId: { in: [ownerId, otherOwnerId] } } });
    if (ownerId && otherOwnerId) await prisma.owner.deleteMany({ where: { id: { in: [ownerId, otherOwnerId] } } });
    if (problemId) await prisma.problem.deleteMany({ where: { id: problemId } });
    await prisma.$disconnect();
  });

  async function createRound(options: { status?: "LOBBY" | "RUNNING"; startedAt?: Date; endsAt?: Date } = {}) {
    const status = options.status ?? "LOBBY";
    const round = await prisma.round.create({
      data: {
        ownerId,
        status,
        targetRating: 800,
        yearMode: "RANDOM",
        selectedYears: [],
        durationMinutes: 10,
        problemCount: 1,
        selectedTags: [],
        includeSolved: true,
        startedAt: options.startedAt ?? null,
        endsAt: options.endsAt ?? null,
        problems: { create: [{ problemId, orderIndex: 0, contestId, problemIndex: "A", name: "Integration fixture", rating: 800, tags: [] }] },
      },
      include: { problems: true },
    });
    return { round, problem: round.problems[0]! };
  }

  const hasStatus = (status: number) => (error: unknown) => typeof error === "object" && error !== null && "status" in error && error.status === status;

  it("enforces owner checks and allows a lobby to start only once", async () => {
    const { round } = await createRound();
    await assert.rejects(() => startRound(round.id, otherOwnerId), hasStatus(404));

    const started = await startRound(round.id, ownerId);
    assert.equal(started.status, "RUNNING");
    assert.equal(new Date(started.endsAt).getTime() - new Date(started.startedAt).getTime(), 10 * 60_000);
    await assert.rejects(() => startRound(round.id, ownerId), hasStatus(409));
  });

  it("cancels lobby rounds and refuses to cancel a running round", async () => {
    const { round: lobby } = await createRound();
    assert.deepEqual(await cancelLobbyRound(lobby.id, ownerId), { id: lobby.id, status: "CANCELLED" });
    assert.equal((await prisma.round.findUniqueOrThrow({ where: { id: lobby.id } })).status, "CANCELLED");
    await assert.rejects(() => cancelLobbyRound(lobby.id, ownerId), hasStatus(409));

    const { round: running } = await createRound();
    await startRound(running.id, ownerId);
    await assert.rejects(() => cancelLobbyRound(running.id, ownerId), hasStatus(409));
  });

  it("starts, pauses, and resumes work with separate persisted sessions", async () => {
    const { round, problem } = await createRound();
    await startRound(round.id, ownerId);
    assert.deepEqual(await startWork(round.id, problem.id, ownerId), { status: "IN_PROGRESS" });
    await assert.rejects(() => startWork(round.id, problem.id, ownerId), hasStatus(409));
    assert.deepEqual(await stopWork(round.id, problem.id, ownerId), { status: "PAUSED" });
    await startWork(round.id, problem.id, ownerId);
    await stopWork(round.id, problem.id, ownerId);

    const saved = await prisma.roundProblem.findUniqueOrThrow({ where: { id: problem.id }, include: { workSessions: true } });
    assert.equal(saved.status, "PAUSED");
    assert.equal(saved.workSessions.length, 2);
    assert.ok(saved.workSessions.every((session) => session.endedAt !== null && session.stopReason === "MANUAL"));
    assert.ok(saved.firstStartedAt);
  });

  it("finalizes expired rounds and closes active work at the authoritative end time", async () => {
    const endedAt = new Date(Date.now() - 60_000);
    const startedAt = new Date(endedAt.getTime() - 5 * 60_000);
    const { round, problem } = await createRound({ status: "RUNNING", startedAt, endsAt: endedAt });
    const sessionStartedAt = new Date(endedAt.getTime() - 4 * 60_000);
    await prisma.roundProblem.update({ where: { id: problem.id }, data: { status: "IN_PROGRESS", firstStartedAt: sessionStartedAt } });
    await prisma.workSession.create({ data: { roundProblemId: problem.id, startedAt: sessionStartedAt } });

    await assert.rejects(() => startWork(round.id, problem.id, ownerId), hasStatus(409));
    await finalizeExpiredRounds();

    const savedRound = await prisma.round.findUniqueOrThrow({ where: { id: round.id } });
    const savedProblem = await prisma.roundProblem.findUniqueOrThrow({ where: { id: problem.id }, include: { workSessions: true } });
    assert.equal(savedRound.status, "COMPLETED");
    assert.equal(savedRound.completedAt?.getTime(), endedAt.getTime());
    assert.equal(savedProblem.status, "EXPIRED");
    assert.equal(savedProblem.activeWorkSeconds, 240);
    assert.equal(savedProblem.workSessions[0]?.endedAt?.getTime(), endedAt.getTime());
    assert.equal(savedProblem.workSessions[0]?.stopReason, "ROUND_ENDED");
  });
});
