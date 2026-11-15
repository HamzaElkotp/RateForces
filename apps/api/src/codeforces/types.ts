export type CfEnvelope<T> = { status: "OK"; result: T } | { status: "FAILED"; comment?: string };

export interface CfContest {
  id: number;
  name: string;
  startTimeSeconds?: number;
}

export interface CfProblem {
  contestId?: number;
  index: string;
  name: string;
  rating?: number;
  tags?: string[];
}

export interface CfProblemStatistic {
  contestId?: number;
  index: string;
  solvedCount: number;
}

export interface CfProblemsetResult {
  problems: CfProblem[];
  problemStatistics: CfProblemStatistic[];
}

export interface CfUser {
  handle: string;
  rating?: number;
  rank?: string;
}

export interface CfSubmission {
  id: number;
  creationTimeSeconds: number;
  problem: { contestId?: number; index: string; name?: string; rating?: number; tags?: string[] };
  verdict?: string;
}

export interface NormalizedProblem {
  contestId: number;
  problemIndex: string;
  name: string;
  rating: number | null;
  tags: string[];
  year: number | null;
  contestStartTime: Date | null;
  contestName: string | null;
  solvedCount: number | null;
}
