import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../db.js";
import { writeNormalizedProblemset } from "./importer.js";

describe("problemset import transaction (PostgreSQL integration)", () => {
  let contestId: number;

  before(async () => {
    contestId = 1_300_000_000 + Math.floor(Math.random() * 100_000);
    await prisma.problem.create({ data: { contestId, problemIndex: "A", name: "Previous complete snapshot", rating: 800 } });
  });

  after(async () => {
    if (contestId) await prisma.problem.deleteMany({ where: { contestId } });
    await prisma.$disconnect();
  });

  it("rolls back earlier batches if a later batch fails", async () => {
    await assert.rejects(() => writeNormalizedProblemset([
      { contestId, problemIndex: "A", name: "Uncommitted refresh", rating: 1200, tags: ["math"], year: 2025, contestStartTime: new Date("2025-01-01T00:00:00.000Z"), contestName: "New Contest", solvedCount: 42 },
      { contestId: 2_147_483_648, problemIndex: "B", name: "Invalid integer key", rating: null, tags: [], year: null, contestStartTime: null, contestName: null, solvedCount: null },
    ], 1));

    const saved = await prisma.problem.findUniqueOrThrow({ where: { contestId_problemIndex: { contestId, problemIndex: "A" } } });
    assert.equal(saved.name, "Previous complete snapshot");
    assert.equal(saved.rating, 800);
  });
});
