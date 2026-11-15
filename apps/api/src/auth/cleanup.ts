import "../config.js";
import { prisma } from "../db.js";

const now = new Date();
const challengeCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const revokedSessionCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

try {
  const [challenges, sessions] = await Promise.all([
    prisma.verificationChallenge.deleteMany({ where: { expiresAt: { lt: challengeCutoff } } }),
    prisma.ownerSession.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: revokedSessionCutoff } }] } }),
  ]);
  console.info(JSON.stringify({ level: "info", job: "auth:cleanup", deletedChallenges: challenges.count, deletedSessions: sessions.count }));
} catch (error) {
  console.error(JSON.stringify({ level: "error", job: "auth:cleanup", errorClass: error instanceof Error ? error.name : "UnknownError" }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
