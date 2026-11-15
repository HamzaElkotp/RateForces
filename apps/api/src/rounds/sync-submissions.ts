import { prisma } from "../db.js";
import { codeforces } from "../codeforces/client.js";
import { finalizeExpiredRounds } from "./lifecycle.js";
import { applySubmission } from "./submission-sync.js";

const RECONCILE_MS = 30 * 60 * 1000;

try {
  await finalizeExpiredRounds();
  const reconcileSince = new Date(Date.now() - RECONCILE_MS);
  const owners = await prisma.owner.findMany({
    where: {
      rounds: {
        some: {
          OR: [
            { status: "RUNNING" },
            { status: "COMPLETED", completedAt: { gte: reconcileSince } },
          ],
        },
      },
    },
    select: { id: true, codeforcesHandle: true },
  });
  for (const owner of owners) {
    try {
      const submissions = await codeforces.getUserStatus(owner.codeforcesHandle, 1, 1000);
      for (const submission of submissions) await applySubmission(owner.id, submission);
      await prisma.userSyncCheckpoint.upsert({ where: { ownerId: owner.id }, create: { ownerId: owner.id, lastSyncedAt: new Date() }, update: { lastSyncedAt: new Date() } });
    } catch (error) { console.error(`Round sync failed for ${owner.codeforcesHandle}:`, error); }
  }
} finally {
  await prisma.$disconnect();
}
