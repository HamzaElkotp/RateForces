import { config } from "../config.js";
import type { CfContest, CfEnvelope, CfProblemsetResult } from "./types.js";

let lastRequestAt = 0;
let queue: Promise<void> = Promise.resolve();

async function waitForRateLimit(): Promise<void> {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const delay = config.CODEFORCES_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    lastRequestAt = Date.now();
  } finally {
    release();
  }
}

async function request<T>(method: string): Promise<T> {
  await waitForRateLimit();
  const response = await fetch(`${config.CODEFORCES_API_BASE}/${method}`, { headers: { "user-agent": "RateForces/0.1" } });
  if (!response.ok) throw new Error(`Codeforces ${method} returned HTTP ${response.status}`);
  const envelope = await response.json() as CfEnvelope<T>;
  if (envelope.status !== "OK") throw new Error(`Codeforces ${method} failed: ${envelope.comment ?? "unknown API error"}`);
  return envelope.result;
}

export const codeforces = {
  listContests: () => request<CfContest[]>("contest.list?gym=false"),
  getProblemset: () => request<CfProblemsetResult>("problemset.problems"),
};
