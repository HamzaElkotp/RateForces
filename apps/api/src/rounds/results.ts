import { prisma } from "../db.js";
import { calculateRoundResults } from "./results-calculation.js";

export async function getRoundResults(roundId: string, ownerId: string) {
  const round = await prisma.round.findFirst({ where: { id: roundId, ownerId }, include: { problems: { include: { attempts: { where: { verdict: { not: null } } }, workSessions: true } } } });
  if (!round) throw Object.assign(new Error("Round not found."), { status: 404 });
  if (round.status !== "COMPLETED" || !round.startedAt || !round.endsAt) throw Object.assign(new Error("Results are available after the round is completed."), { status: 409 });
  return calculateRoundResults({ ...round, startedAt: round.startedAt, endsAt: round.endsAt });
}
