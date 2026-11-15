import { prisma } from "../db.js";
import { codeforces } from "./client.js";
import { normalizeProblemset } from "./normalize.js";

export async function importProblemset(): Promise<{ contests: number; problems: number }> {
  const [contests, result] = await Promise.all([codeforces.listContests(), codeforces.getProblemset()]);
  const normalized = normalizeProblemset(result.problems, result.problemStatistics, contests);
  for (const problem of normalized) {
    await prisma.problem.upsert({
      where: { contestId_problemIndex: { contestId: problem.contestId, problemIndex: problem.problemIndex } },
      create: problem,
      update: { name: problem.name, rating: problem.rating, tags: problem.tags, year: problem.year, contestStartTime: problem.contestStartTime, contestName: problem.contestName, solvedCount: problem.solvedCount },
    });
  }
  return { contests: contests.length, problems: normalized.length };
}
