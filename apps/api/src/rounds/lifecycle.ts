import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

async function lockRound(tx: Prisma.TransactionClient, roundId: string, ownerId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM rounds WHERE id = ${roundId}::uuid AND owner_id = ${ownerId}::uuid FOR UPDATE`;
  if (!rows.length) throw Object.assign(new Error("Round not found."), { status: 404 });
  return tx.round.findUniqueOrThrow({ where: { id: roundId } });
}

async function finishRound(tx: Prisma.TransactionClient, roundId: string, endsAt: Date) {
  const active = await tx.roundProblem.findMany({ where: { roundId, status: { not: "SOLVED" } }, select: { id: true } });
  const activeIds = active.map(({ id }) => id);
  const open = await tx.workSession.findMany({ where: { roundProblemId: { in: activeIds }, endedAt: null }, select: { id: true, roundProblemId: true, startedAt: true } });
  for (const session of open) {
    await tx.workSession.update({ where: { id: session.id }, data: { endedAt: endsAt, stopReason: "ROUND_ENDED" } });
    await tx.roundProblem.update({ where: { id: session.roundProblemId }, data: { activeWorkSeconds: { increment: Math.max(0, Math.floor((endsAt.getTime() - session.startedAt.getTime()) / 1000)) } } });
  }
  await tx.roundProblem.updateMany({ where: { roundId, status: { not: "SOLVED" } }, data: { status: "EXPIRED" } });
  await tx.round.update({ where: { id: roundId }, data: { status: "COMPLETED", completedAt: endsAt } });
}

export async function startRound(roundId: string, ownerId: string) {
  return prisma.$transaction(async (tx) => {
    const round = await lockRound(tx, roundId, ownerId);
    if (round.status !== "LOBBY") throw Object.assign(new Error("Only a lobby round can be started."), { status: 409 });
    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + round.durationMinutes * 60_000);
    await tx.round.update({ where: { id: roundId }, data: { status: "RUNNING", startedAt, endsAt } });
    return { id: roundId, status: "RUNNING" as const, startedAt: startedAt.toISOString(), endsAt: endsAt.toISOString() };
  });
}

export async function startWork(roundId: string, roundProblemId: string, ownerId: string) {
  return prisma.$transaction(async (tx) => {
    const round = await lockRound(tx, roundId, ownerId);
    const now = new Date();
    if (round.status !== "RUNNING" || !round.endsAt || round.endsAt <= now) {
      throw Object.assign(new Error("Work can only start while the round is running."), { status: 409 });
    }
    const [problem] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM round_problems WHERE id = ${roundProblemId}::uuid AND round_id = ${roundId}::uuid FOR UPDATE`;
    if (!problem) throw Object.assign(new Error("Round problem not found."), { status: 404 });
    const state = await tx.roundProblem.findUniqueOrThrow({ where: { id: roundProblemId } });
    if (state.status === "SOLVED") throw Object.assign(new Error("Solved problems cannot be restarted."), { status: 409 });
    const openSession = await tx.workSession.findFirst({ where: { roundProblemId, endedAt: null } });
    if (openSession) throw Object.assign(new Error("Work is already active for this problem."), { status: 409 });
    await tx.workSession.create({ data: { roundProblemId, startedAt: now } });
    await tx.roundProblem.update({ where: { id: roundProblemId }, data: { status: "IN_PROGRESS", firstStartedAt: state.firstStartedAt ?? now } });
    return { status: "IN_PROGRESS" as const };
  });
}

export async function stopWork(roundId: string, roundProblemId: string, ownerId: string) {
  return prisma.$transaction(async (tx) => {
    const round = await lockRound(tx, roundId, ownerId);
    const now = new Date();
    if (round.status !== "RUNNING" || !round.endsAt || round.endsAt <= now) {
      throw Object.assign(new Error("Work can only be paused while the round is running."), { status: 409 });
    }
    const [problem] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM round_problems WHERE id = ${roundProblemId}::uuid AND round_id = ${roundId}::uuid FOR UPDATE`;
    if (!problem) throw Object.assign(new Error("Round problem not found."), { status: 404 });
    const openSession = await tx.workSession.findFirst({ where: { roundProblemId, endedAt: null } });
    if (!openSession) throw Object.assign(new Error("This problem has no active work session."), { status: 409 });
    await tx.workSession.update({ where: { id: openSession.id }, data: { endedAt: now, stopReason: "MANUAL" } });
    await tx.roundProblem.update({ where: { id: roundProblemId }, data: { status: "PAUSED", activeWorkSeconds: { increment: Math.max(0, Math.floor((now.getTime() - openSession.startedAt.getTime()) / 1000)) } } });
    return { status: "PAUSED" as const };
  });
}

export async function finalizeExpiredRounds() {
  const expired = await prisma.round.findMany({ where: { status: "RUNNING", endsAt: { lte: new Date() } }, select: { id: true, ownerId: true } });
  for (const item of expired) await prisma.$transaction(async (tx) => {
    const round = await lockRound(tx, item.id, item.ownerId);
    if (round.status === "RUNNING" && round.endsAt && round.endsAt <= new Date()) await finishRound(tx, round.id, round.endsAt);
  });
}
