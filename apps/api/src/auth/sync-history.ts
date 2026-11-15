import { prisma } from "../db.js";
import { codeforces } from "../codeforces/client.js";
import { importHistoryPage } from "./history-sync.js";

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
      const result = await importHistoryPage(owner.id, checkpoint, submissions, PAGE_SIZE);
      console.info(`Imported ${result.importedSubmissions} history submissions for ${owner.codeforcesHandle}; ${result.finished ? "complete" : `next offset ${result.historyImportCursor}`}.`);
    } catch (error) { console.error(`History import failed for ${owner.codeforcesHandle}:`, error); }
  }
} finally {
  await prisma.$disconnect();
}
