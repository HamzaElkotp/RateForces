import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { CfSubmission } from "../codeforces/types.js";
import { prisma } from "../db.js";
import { importHistoryPage } from "./history-sync.js";

describe("history import (PostgreSQL integration)", () => {
  let ownerId: string;
  let contestStart: number;
  const contestIds: number[] = [];

  before(async () => {
    const owner = await prisma.owner.create({ data: { codeforcesHandle: `testh_${randomUUID().replaceAll("-", "").slice(0, 16)}`, verifiedAt: new Date() } });
    ownerId = owner.id;
    contestStart = 1_100_000_000 + Math.floor(Math.random() * 100_000);
    contestIds.push(contestStart, contestStart + 1, contestStart + 2);
    await prisma.userSyncCheckpoint.create({ data: { ownerId, historyImportStartedAt: new Date() } });
  });

  after(async () => {
    if (ownerId) await prisma.owner.deleteMany({ where: { id: ownerId } });
    if (contestIds.length) await prisma.problem.deleteMany({ where: { contestId: { in: contestIds } } });
    await prisma.$disconnect();
  });

  function accepted(id: number, contestId: number, index = "A", offsetSeconds = id): CfSubmission {
    return { id, creationTimeSeconds: 1_700_000_000 + offsetSeconds, problem: { contestId, index, name: `Fixture ${contestId}${index}`, tags: [] }, verdict: "OK" };
  }

  it("imports a history in pages, preserves first-solve data, and advances incremental IDs idempotently", async () => {
    let checkpoint = await prisma.userSyncCheckpoint.findUniqueOrThrow({ where: { ownerId } });
    const first = await importHistoryPage(ownerId, checkpoint, [
      accepted(300, contestStart),
      { ...accepted(299, contestStart + 2), verdict: "WRONG_ANSWER" },
    ], 2);
    assert.equal(first.finished, false);
    assert.equal(first.historyImportCursor, 3);
    assert.equal(first.lastSubmissionId, 300);

    checkpoint = await prisma.userSyncCheckpoint.findUniqueOrThrow({ where: { ownerId } });
    const second = await importHistoryPage(ownerId, checkpoint, [
      accepted(250, contestStart),
      accepted(200, contestStart + 1),
    ], 2);
    assert.equal(second.finished, false);
    assert.equal(second.historyImportCursor, 5);
    assert.equal(second.lastSubmissionId, 300);

    checkpoint = await prisma.userSyncCheckpoint.findUniqueOrThrow({ where: { ownerId } });
    const third = await importHistoryPage(ownerId, checkpoint, [accepted(100, contestStart + 2)], 2);
    assert.equal(third.finished, true);
    assert.equal(third.historyImportCursor, 6);
    assert.equal(third.lastSubmissionId, 300);

    const firstSolved = await prisma.userSolvedProblem.findFirstOrThrow({ where: { ownerId, problem: { contestId: contestStart } }, include: { problem: true } });
    assert.equal(firstSolved.submissionId, 250);
    assert.equal(await prisma.userSolvedProblem.count({ where: { ownerId } }), 3);

    checkpoint = await prisma.userSyncCheckpoint.findUniqueOrThrow({ where: { ownerId } });
    const incremental = [accepted(400, contestStart), accepted(300, contestStart + 1)];
    const update = await importHistoryPage(ownerId, checkpoint, incremental);
    assert.equal(update.historyImportCursor, 6);
    assert.equal(update.lastSubmissionId, 400);

    checkpoint = await prisma.userSyncCheckpoint.findUniqueOrThrow({ where: { ownerId } });
    await importHistoryPage(ownerId, checkpoint, incremental);
    const refreshed = await prisma.userSolvedProblem.findFirstOrThrow({ where: { ownerId, problem: { contestId: contestStart } }, include: { problem: true } });
    assert.equal(refreshed.submissionId, 400);
    assert.equal(await prisma.userSolvedProblem.count({ where: { ownerId } }), 3);
  });
});
