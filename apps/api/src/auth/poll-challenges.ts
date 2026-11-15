import { prisma } from "../db.js";
import { checkVerification } from "./service.js";

try {
  const pending = await prisma.verificationChallenge.findMany({ where: { status: "PENDING", consumedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
  for (const challenge of pending) {
    try {
      const result = await checkVerification(challenge.id);
      if (result.status === "VERIFIED") console.info(`Verified a Codeforces handle for challenge ${challenge.id}.`);
    } catch (error) { console.error(`Challenge check failed (${challenge.id}):`, error); }
  }
} finally {
  await prisma.$disconnect();
}
