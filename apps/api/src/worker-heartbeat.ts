import { prisma } from "./db.js";

try {
  await prisma.workerState.upsert({ where: { workerName: "main" }, create: { workerName: "main", lastSeenAt: new Date(), lastJob: process.argv[2] ?? "heartbeat", status: "OK" }, update: { lastSeenAt: new Date(), lastJob: process.argv[2] ?? "heartbeat", status: "OK" } });
} finally {
  await prisma.$disconnect();
}
