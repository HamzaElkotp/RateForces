import { config } from "../config.js";
import { prisma } from "../db.js";
import type { CfContest, CfEnvelope, CfProblemsetResult, CfSubmission, CfUser } from "./types.js";

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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = Date.now();
    await waitForRateLimit();
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(7734501)`;
      const previous = await tx.externalRateLimit.findUnique({ where: { key: "codeforces" } });
      const delay = previous ? config.CODEFORCES_REQUEST_INTERVAL_MS - (Date.now() - previous.lastStartedAt.getTime()) : 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      const startedAt = new Date();
      await tx.externalRateLimit.upsert({ where: { key: "codeforces" }, create: { key: "codeforces", lastStartedAt: startedAt }, update: { lastStartedAt: startedAt } });
      try {
        return { response: await fetch(`${config.CODEFORCES_API_BASE}/${method}`, { headers: { "user-agent": "RateForces/0.1" }, signal: AbortSignal.timeout(12_000) }), error: null as unknown };
      } catch (error) { return { response: null, error }; }
    }, { maxWait: 15_000, timeout: 20_000 });
    if (result.error) {
      if (attempt < 2) { await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt) + Math.floor(Math.random() * 250))); continue; }
      throw new Error(`Codeforces ${method} request failed after retries: ${result.error instanceof Error ? result.error.name : "network error"}`);
    }
    const response = result.response!;
    if (response.status >= 500 && attempt < 2) { await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt) + Math.floor(Math.random() * 250))); continue; }
    if (!response.ok) { console.warn(JSON.stringify({ level: "warn", integration: "codeforces", method, durationMs: Date.now() - startedAt, status: response.status })); throw new Error(`Codeforces ${method} returned HTTP ${response.status}`); }
    const envelope = await response.json() as CfEnvelope<T>;
    if (envelope.status !== "OK") { console.warn(JSON.stringify({ level: "warn", integration: "codeforces", method, durationMs: Date.now() - startedAt, status: "FAILED" })); throw new Error(`Codeforces ${method} failed: ${envelope.comment ?? "unknown API error"}`); }
    console.info(JSON.stringify({ level: "info", integration: "codeforces", method, durationMs: Date.now() - startedAt, status: "OK" }));
    return envelope.result;
  }
  throw new Error(`Codeforces ${method} failed after retries`);
}

export const codeforces = {
  listContests: () => request<CfContest[]>("contest.list?gym=false"),
  getProblemset: () => request<CfProblemsetResult>("problemset.problems"),
  getUser: async (handle: string) => (await request<CfUser[]>(`user.info?handles=${encodeURIComponent(handle)}`))[0],
  getUserStatus: (handle: string, from = 1, count = 100) => request<CfSubmission[]>(`user.status?handle=${encodeURIComponent(handle)}&from=${from}&count=${count}`),
};
