import type { CfContest, CfProblem, CfProblemStatistic, NormalizedProblem } from "./types.js";

export function normalizeProblemset(problems: CfProblem[], stats: CfProblemStatistic[], contests: CfContest[]): NormalizedProblem[] {
  const contestsById = new Map(contests.map((contest) => [contest.id, contest]));
  const statsByKey = new Map(stats.filter((item) => item.contestId !== undefined).map((item) => [`${item.contestId}:${item.index}`, item.solvedCount]));
  return problems.flatMap((problem) => {
    if (problem.contestId === undefined) return [];
    const contest = contestsById.get(problem.contestId);
    const contestStartTime = contest?.startTimeSeconds === undefined ? null : new Date(contest.startTimeSeconds * 1000);
    return [{
      contestId: problem.contestId,
      problemIndex: problem.index,
      name: problem.name,
      rating: problem.rating ?? null,
      tags: problem.tags ?? [],
      year: contestStartTime?.getUTCFullYear() ?? null,
      contestStartTime,
      contestName: contest?.name ?? null,
      solvedCount: statsByKey.get(`${problem.contestId}:${problem.index}`) ?? null,
    }];
  });
}
