import { prisma } from "../db.js";
import { codeforces } from "./client.js";
import { normalizeProblemset } from "./normalize.js";

export async function importProblemset(): Promise<{ contests: number; problems: number }> {
  const [contests, result] = await Promise.all([codeforces.listContests(), codeforces.getProblemset()]);
  const normalized = normalizeProblemset(result.problems, result.problemStatistics, contests);
  const batchSize = 25;
  for (let offset = 0; offset < normalized.length; offset += batchSize) {
    const batch = normalized.slice(offset, offset + batchSize);
    await Promise.all(batch.map((problem) => prisma.problem.upsert({
      where: { contestId_problemIndex: { contestId: problem.contestId, problemIndex: problem.problemIndex } },
      create: problem,
      update: { name: problem.name, rating: problem.rating, tags: problem.tags, year: problem.year, contestStartTime: problem.contestStartTime, contestName: problem.contestName, solvedCount: problem.solvedCount },
    })));
    if ((offset + batch.length) % 500 === 0 || offset + batch.length === normalized.length) {
      console.info(`Problemset import progress: ${offset + batch.length}/${normalized.length} problems.`);
    }
  }
  return { contests: contests.length, problems: normalized.length };
}
