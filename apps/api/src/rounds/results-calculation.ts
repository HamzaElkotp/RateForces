type ResultAttempt = { verdict: string | null };
type ResultWorkSession = { startedAt: Date; endedAt: Date | null };

type ResultProblem = {
  id: string;
  contestId: number;
  problemIndex: string;
  name: string;
  rating: number | null;
  tags: string[];
  firstStartedAt: Date | null;
  acceptedAt: Date | null;
  acceptedSubmissionId: number | null;
  acceptedSubmissionUrl: string | null;
  attempts: ResultAttempt[];
  workSessions: ResultWorkSession[];
};

export type CompletedRoundForResults = {
  id: string;
  status: string;
  targetRating: number;
  durationMinutes: number;
  startedAt: Date;
  endsAt: Date;
  problems: ResultProblem[];
};

export function calculateRoundResults(round: CompletedRoundForResults) {
  const durationSeconds = round.durationMinutes * 60;
  const completedProblems = round.problems.map((problem) => {
    const acceptedAt = problem.acceptedAt && problem.acceptedAt >= round.startedAt && problem.acceptedAt <= round.endsAt ? problem.acceptedAt : null;
    const activeWorkSeconds = problem.workSessions.reduce((total, session) => {
      const end = session.endedAt ?? round.endsAt;
      return total + Math.max(0, Math.floor((Math.min(end.getTime(), round.endsAt.getTime()) - session.startedAt.getTime()) / 1000));
    }, 0);
    return { id: problem.id, contestId: problem.contestId, problemIndex: problem.problemIndex, name: problem.name, rating: problem.rating, tags: problem.tags, status: acceptedAt ? "SOLVED" : "EXPIRED", attemptCount: problem.attempts.length, failedAttemptCount: problem.attempts.filter((attempt) => attempt.verdict !== "OK").length, acceptedAt: acceptedAt?.toISOString() ?? null, acceptedSubmissionUrl: acceptedAt ? problem.acceptedSubmissionUrl : null, roundElapsedToAcceptanceSeconds: acceptedAt ? Math.floor((acceptedAt.getTime() - round.startedAt.getTime()) / 1000) : null, activeWorkSeconds: problem.firstStartedAt ? activeWorkSeconds : null, url: `https://codeforces.com/contest/${problem.contestId}/problem/${problem.problemIndex}`, acceptedSubmissionId: acceptedAt ? problem.acceptedSubmissionId : null };
  });
  const solved = completedProblems.filter((problem) => problem.acceptedAt !== null);
  const workTimes = solved.flatMap((problem) => problem.activeWorkSeconds === null ? [] : [problem.activeWorkSeconds]);
  const timeline = [{ elapsedSeconds: 0, cumulativeAccepted: 0, remaining: round.problems.length }];
  const events = [...solved].sort((a, b) => a.roundElapsedToAcceptanceSeconds! - b.roundElapsedToAcceptanceSeconds! || a.acceptedSubmissionId! - b.acceptedSubmissionId!);
  events.forEach((event, index) => timeline.push({ elapsedSeconds: event.roundElapsedToAcceptanceSeconds!, cumulativeAccepted: index + 1, remaining: round.problems.length - index - 1 }));
  timeline.push({ elapsedSeconds: durationSeconds, cumulativeAccepted: solved.length, remaining: round.problems.length - solved.length });
  return {
    id: round.id,
    status: round.status,
    targetRating: round.targetRating,
    startedAt: round.startedAt.toISOString(),
    endsAt: round.endsAt.toISOString(),
    durationSeconds,
    totalProblems: round.problems.length,
    solvedProblems: solved.length,
    remainingProblems: round.problems.length - solved.length,
    solveRate: round.problems.length ? solved.length / round.problems.length * 100 : 0,
    averageActiveWorkSeconds: workTimes.length ? Math.round(workTimes.reduce((sum, value) => sum + value, 0) / workTimes.length) : null,
    longestActiveWorkSeconds: workTimes.length ? Math.max(...workTimes) : null,
    timeline,
    problems: completedProblems,
  };
}
