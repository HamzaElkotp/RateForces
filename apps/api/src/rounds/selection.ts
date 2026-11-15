import { randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";

export const roundConfigSchema = z.object({
  targetRating: z.number().int().positive(),
  yearMode: z.enum(["SELECTED", "RANDOM"]),
  selectedYears: z.array(z.number().int().min(1900).max(2200)).default([]),
  durationMinutes: z.number().int().min(5).max(300),
  problemCount: z.number().int().min(1).max(20).default(5),
  selectedTags: z.array(z.string().min(1).max(60)).default([]),
  tagMatchMode: z.enum(["ALL", "ANY"]).default("ANY"),
  includeSolved: z.boolean().default(true),
}).superRefine((input, context) => {
  if (input.yearMode === "SELECTED" && input.selectedYears.length === 0) context.addIssue({ code: "custom", path: ["selectedYears"], message: "Choose at least one year." });
});

export type RoundConfig = z.infer<typeof roundConfigSchema>;

async function getEligibleProblems(ownerId: string, input: RoundConfig) {
  if (input.selectedTags.length) {
    const available = new Set((await prisma.problem.findMany({ select: { tags: true } })).flatMap((row) => row.tags));
    const unknown = input.selectedTags.filter((tag) => !available.has(tag));
    if (unknown.length) throw Object.assign(new Error(`Unknown problem tag: ${unknown.join(", ")}`), { status: 400 });
  }
  if (!input.includeSolved) {
    const checkpoint = await prisma.userSyncCheckpoint.findUnique({ where: { ownerId } });
    if (!checkpoint?.historyImportComplete) throw Object.assign(new Error("Your Codeforces solve history is still syncing. Wait for it to finish before excluding solved problems."), { status: 409 });
  }
  return prisma.problem.findMany({
    where: {
      rating: input.targetRating,
      ...(input.yearMode === "SELECTED" ? { year: { in: input.selectedYears } } : {}),
      ...(input.selectedTags.length ? { tags: input.tagMatchMode === "ALL" ? { hasEvery: input.selectedTags } : { hasSome: input.selectedTags } } : {}),
      ...(!input.includeSolved ? { solvedByUsers: { none: { ownerId } } } : {}),
    },
    select: { id: true, contestId: true, problemIndex: true, name: true, rating: true, tags: true },
  });
}

function shuffle<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [items[index], items[target]] = [items[target]!, items[index]!];
  }
  return items;
}

export async function previewRound(ownerId: string, input: RoundConfig) {
  const candidates = await getEligibleProblems(ownerId, input);
  return { eligibleCount: candidates.length, enoughProblems: candidates.length >= input.problemCount };
}

export async function createRound(ownerId: string, input: RoundConfig) {
  const candidates = await getEligibleProblems(ownerId, input);
  if (candidates.length < input.problemCount) throw Object.assign(new Error(`Only ${candidates.length} eligible problems match these filters; ${input.problemCount} requested.`), { status: 422 });
  const selected = shuffle(candidates).slice(0, input.problemCount);
  return prisma.$transaction(async (tx) => tx.round.create({
    data: {
      ownerId,
      targetRating: input.targetRating,
      yearMode: input.yearMode,
      selectedYears: input.selectedYears,
      durationMinutes: input.durationMinutes,
      problemCount: input.problemCount,
      selectedTags: input.selectedTags,
      tagMatchMode: input.selectedTags.length ? input.tagMatchMode : null,
      includeSolved: input.includeSolved,
      problems: { create: selected.map((problem, orderIndex) => ({
        problemId: problem.id,
        orderIndex,
        contestId: problem.contestId,
        problemIndex: problem.problemIndex,
        name: problem.name,
        rating: problem.rating,
        tags: problem.tags,
      })) },
    },
    include: { problems: { orderBy: [{ contestId: "asc" }, { problemIndex: "asc" }], include: { attempts: true, workSessions: true } } },
  }));
}
