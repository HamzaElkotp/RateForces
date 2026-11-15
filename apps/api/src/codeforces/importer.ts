import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { codeforces } from "./client.js";
import { normalizeProblemset } from "./normalize.js";

export async function importProblemset(): Promise<{ contests: number; problems: number }> {
  const [contests, result] = await Promise.all([codeforces.listContests(), codeforces.getProblemset()]);
  const normalized = normalizeProblemset(result.problems, result.problemStatistics, contests);
  const batchSize = 100;
  await prisma.$transaction(async (tx) => {
    for (let offset = 0; offset < normalized.length; offset += batchSize) {
      const batch = normalized.slice(offset, offset + batchSize);
      const updatedAt = new Date();
      const values = batch.map((problem) => Prisma.sql`(
        ${randomUUID()}::uuid,
        ${problem.contestId},
        ${problem.problemIndex},
        ${problem.name},
        ${problem.rating},
        ${problem.tags}::text[],
        ${problem.year},
        ${problem.contestStartTime},
        ${problem.contestName},
        ${problem.solvedCount},
        ${updatedAt}
      )`);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "problems" (
          "id", "contest_id", "problem_index", "name", "rating", "tags", "year",
          "contest_start_time", "contest_name", "solved_count", "updated_at"
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("contest_id", "problem_index") DO UPDATE SET
          "name" = EXCLUDED."name",
          "rating" = EXCLUDED."rating",
          "tags" = EXCLUDED."tags",
          "year" = EXCLUDED."year",
          "contest_start_time" = EXCLUDED."contest_start_time",
          "contest_name" = EXCLUDED."contest_name",
          "solved_count" = EXCLUDED."solved_count",
          "updated_at" = EXCLUDED."updated_at"
      `);
      if ((offset + batch.length) % 500 === 0 || offset + batch.length === normalized.length) {
        console.info(`Problemset import progress: ${offset + batch.length}/${normalized.length} problems.`);
      }
    }
  }, { maxWait: 15_000, timeout: 300_000 });
  return { contests: contests.length, problems: normalized.length };
}
