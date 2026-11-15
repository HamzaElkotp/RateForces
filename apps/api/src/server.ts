import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { getVerificationStatus, hashToken, issueChallengeSession, sessionCookieName, setSessionCookie, startVerification } from "./auth/service.js";
import { requireOwner } from "./auth/middleware.js";
import { createRound, previewRound, roundConfigSchema } from "./rounds/selection.js";
import { cancelLobbyRound, startRound, startWork, stopWork } from "./rounds/lifecycle.js";
import { getRoundResults } from "./rounds/results.js";

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
app.use((_request, response, next) => { response.locals.requestId = randomUUID(); response.setHeader("X-Request-Id", response.locals.requestId); next(); });
app.use(express.json({ limit: "32kb" }));

const verificationStarts = new Map<string, { count: number; resetAt: number }>();
function limitVerificationStarts(ip: string): boolean {
  const now = Date.now();
  const current = verificationStarts.get(ip);
  if (!current || current.resetAt <= now) { verificationStarts.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 }); return true; }
  if (current.count >= 5) return false;
  current.count += 1;
  return true;
}

app.get("/api/health/live", (_request, response) => {
  response.json({ status: "ok", service: "rateforces-api", timestamp: new Date().toISOString() });
});

app.get("/api/health", async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const worker = await prisma.workerState.findUnique({ where: { workerName: "main" } });
    const workerHealthy = !!worker && Date.now() - worker.lastSeenAt.getTime() < 90_000;
    response.status(workerHealthy ? 200 : 503).json({ status: workerHealthy ? "ok" : "degraded", service: "rateforces-api", database: "ok", worker: worker ? { status: workerHealthy ? "ok" : "stale", lastSeenAt: worker.lastSeenAt.toISOString(), lastJob: worker.lastJob } : { status: "missing" }, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "Readiness check failed", requestId: response.locals.requestId, errorClass: error instanceof Error ? error.name : "UnknownError" }));
    response.status(503).json({ status: "unavailable", service: "rateforces-api", database: "unavailable", worker: { status: "unknown" }, timestamp: new Date().toISOString() });
  }
});

app.post("/api/v1/auth/verification", async (request, response, next) => {
  const body = z.object({ handle: z.string().trim().min(3).max(24) }).safeParse(request.body);
  if (!body.success) { response.status(400).json({ error: { code: "INVALID_HANDLE", message: "Enter a valid Codeforces handle." } }); return; }
  if (!limitVerificationStarts(request.ip ?? "unknown")) { response.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many verification attempts. Try again later." } }); return; }
  try { response.status(201).json({ data: await startVerification(body.data.handle), error: null }); } catch (error) { next(error); }
});

app.get("/api/v1/auth/verification/:challengeId", async (request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  const params = z.object({ challengeId: z.string().uuid() }).safeParse(request.params);
  if (!params.success) { response.status(400).json({ error: { code: "INVALID_CHALLENGE", message: "Invalid challenge ID." } }); return; }
  try {
    const status = await getVerificationStatus(params.data.challengeId);
    if (status === "VERIFIED") {
      const token = await issueChallengeSession(params.data.challengeId);
      if (token) response.setHeader("Set-Cookie", setSessionCookie(token, process.env.NODE_ENV === "production"));
    }
    response.json({ data: { status }, error: null });
  } catch (error) { next(error); }
});

app.get("/api/v1/me", requireOwner, async (request, response, next) => {
  try {
    const checkpoint = await prisma.userSyncCheckpoint.findUnique({ where: { ownerId: request.owner!.id } });
    response.json({ data: { ...request.owner, historySyncComplete: checkpoint?.historyImportComplete ?? false, historySyncCursor: checkpoint?.historyImportCursor ?? 1, lastSyncedAt: checkpoint?.lastSyncedAt?.toISOString() ?? null }, error: null });
  } catch (error) { next(error); }
});

function roundDto(round: { id: string; status: string; targetRating: number; durationMinutes: number; problemCount: number; startedAt: Date | null; endsAt: Date | null; createdAt: Date; problems: { id: string; contestId: number; problemIndex: string; name: string; rating: number | null; tags: string[]; orderIndex: number; status: string; firstStartedAt: Date | null; acceptedAt: Date | null; acceptedSubmissionUrl: string | null; attemptCount: number; failedAttemptCount: number; activeWorkSeconds: number; workSessions: { startedAt: Date; endedAt: Date | null }[]; attempts: { verdict: string | null; submittedAt: Date; submissionUrl: string }[] }[] }) {
  return { id: round.id, status: round.status, targetRating: round.targetRating, durationMinutes: round.durationMinutes, problemCount: round.problemCount, startedAt: round.startedAt?.toISOString() ?? null, endsAt: round.endsAt?.toISOString() ?? null, createdAt: round.createdAt.toISOString(), problems: [...round.problems].sort((a, b) => a.orderIndex - b.orderIndex).map((problem) => ({ id: problem.id, contestId: problem.contestId, problemIndex: problem.problemIndex, name: problem.name, rating: problem.rating, tags: problem.tags, status: problem.status, firstStartedAt: problem.firstStartedAt?.toISOString() ?? null, acceptedAt: problem.acceptedAt?.toISOString() ?? null, acceptedSubmissionUrl: problem.acceptedSubmissionUrl, attemptCount: problem.attemptCount, failedAttemptCount: problem.failedAttemptCount, activeWorkSeconds: problem.activeWorkSeconds, workSessions: problem.workSessions.map((session) => ({ startedAt: session.startedAt.toISOString(), endedAt: session.endedAt?.toISOString() ?? null })), attempts: problem.attempts.map((attempt) => ({ verdict: attempt.verdict, submittedAt: attempt.submittedAt.toISOString(), submissionUrl: attempt.submissionUrl })), url: `https://codeforces.com/contest/${problem.contestId}/problem/${problem.problemIndex}` })) };
}

function parseRoundQuery(query: express.Request["query"]) {
  return roundConfigSchema.safeParse({
    targetRating: Number(query.targetRating),
    yearMode: query.yearMode,
    selectedYears: typeof query.selectedYears === "string" ? query.selectedYears.split(",").filter(Boolean).map(Number) : [],
    durationMinutes: Number(query.durationMinutes),
    problemCount: query.problemCount === undefined ? 5 : Number(query.problemCount),
    selectedTags: typeof query.selectedTags === "string" ? query.selectedTags.split(",").filter(Boolean) : [],
    tagMatchMode: query.tagMatchMode ?? "ANY",
    includeSolved: query.includeSolved === undefined ? true : query.includeSolved === "true",
  });
}

app.get("/api/v1/problemset/preview", requireOwner, async (request, response, next) => {
  const parsed = parseRoundQuery(request.query);
  if (!parsed.success) { response.status(400).json({ error: { code: "INVALID_CONFIG", message: parsed.error.issues[0]?.message ?? "Invalid round configuration" } }); return; }
  try { response.json({ data: await previewRound(request.owner!.id, parsed.data), error: null }); } catch (error) { next(error); }
});

app.post("/api/v1/rounds", requireOwner, async (request, response, next) => {
  const parsed = roundConfigSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: { code: "INVALID_CONFIG", message: parsed.error.issues[0]?.message ?? "Invalid round configuration" } }); return; }
  try {
    const round = await createRound(request.owner!.id, parsed.data);
    response.status(201).json({ data: roundDto(round), error: null });
  } catch (error) { next(error); }
});

app.get("/api/v1/rounds", requireOwner, async (request, response, next) => {
  try {
    const rounds = await prisma.round.findMany({ where: { ownerId: request.owner!.id }, orderBy: { createdAt: "desc" }, take: 50, include: { problems: { include: { attempts: true, workSessions: true } } } });
    response.json({ data: rounds.map(roundDto), error: null });
  } catch (error) { next(error); }
});

app.get("/api/v1/rounds/:roundId", requireOwner, async (request, response, next) => {
  const parsed = z.object({ roundId: z.string().uuid() }).safeParse(request.params);
  if (!parsed.success) { response.status(400).json({ error: { code: "INVALID_ROUND", message: "Invalid round ID." } }); return; }
  try {
    const round = await prisma.round.findFirst({ where: { id: parsed.data.roundId, ownerId: request.owner!.id }, include: { problems: { include: { attempts: { orderBy: { submittedAt: "asc" } }, workSessions: { orderBy: { startedAt: "asc" } } } } } });
    if (!round) { response.status(404).json({ error: { code: "NOT_FOUND", message: "Round not found." } }); return; }
    const checkpoint = await prisma.userSyncCheckpoint.findUnique({ where: { ownerId: request.owner!.id }, select: { lastSyncedAt: true } });
    response.json({ data: { ...roundDto(round), lastSyncedAt: checkpoint?.lastSyncedAt?.toISOString() ?? null }, error: null });
  } catch (error) { next(error); }
});

app.get("/api/v1/rounds/:roundId/results", requireOwner, async (request, response, next) => {
  const parsed = z.object({ roundId: z.string().uuid() }).safeParse(request.params);
  if (!parsed.success) { response.status(400).json({ error: { code: "INVALID_ROUND", message: "Invalid round ID." } }); return; }
  try {
    const results = await getRoundResults(parsed.data.roundId, request.owner!.id);
    const checkpoint = await prisma.userSyncCheckpoint.findUnique({ where: { ownerId: request.owner!.id }, select: { lastSyncedAt: true } });
    response.json({ data: { ...results, lastSyncedAt: checkpoint?.lastSyncedAt?.toISOString() ?? null, finalSyncPending: Date.now() < new Date(results.endsAt).getTime() + 30 * 60 * 1000 }, error: null });
  } catch (error) { next(error); }
});

app.post("/api/v1/rounds/:roundId/start", requireOwner, async (request, response, next) => {
  const parsed = z.object({ roundId: z.string().uuid() }).safeParse(request.params);
  if (!parsed.success) { response.status(400).json({ error: { code: "INVALID_ROUND", message: "Invalid round ID." } }); return; }
  try { response.json({ data: await startRound(parsed.data.roundId, request.owner!.id), error: null }); } catch (error) { next(error); }
});

app.delete("/api/v1/rounds/:roundId", requireOwner, async (request, response, next) => {
  const parsed = z.object({ roundId: z.string().uuid() }).safeParse(request.params);
  if (!parsed.success) { response.status(400).json({ error: { code: "INVALID_ROUND", message: "Invalid round ID." } }); return; }
  try { response.json({ data: await cancelLobbyRound(parsed.data.roundId, request.owner!.id), error: null }); } catch (error) { next(error); }
});

for (const action of ["start", "stop"] as const) {
  app.post(`/api/v1/rounds/:roundId/problems/:problemId/${action}`, requireOwner, async (request, response, next) => {
    const parsed = z.object({ roundId: z.string().uuid(), problemId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) { response.status(400).json({ error: { code: "INVALID_PROBLEM", message: "Invalid round problem." } }); return; }
    try {
      const result = action === "start"
        ? await startWork(parsed.data.roundId, parsed.data.problemId, request.owner!.id)
        : await stopWork(parsed.data.roundId, parsed.data.problemId, request.owner!.id);
      response.json({ data: result, error: null });
    } catch (error) { next(error); }
  });
}

app.post("/api/v1/auth/logout", requireOwner, async (request, response, next) => {
  try {
    const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookieName()}=`))?.slice(sessionCookieName().length + 1);
    if (cookie) await prisma.ownerSession.updateMany({ where: { tokenHash: hashToken(cookie), revokedAt: null }, data: { revokedAt: new Date() } });
    response.setHeader("Set-Cookie", `${sessionCookieName()}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    response.json({ data: { loggedOut: true }, error: null });
  } catch (error) { next(error); }
});

app.get("/api/problemset/filters", async (_request, response, next) => {
  try {
    const [years, ratings, tags] = await Promise.all([
      prisma.problem.findMany({ where: { year: { not: null } }, distinct: ["year"], select: { year: true }, orderBy: { year: "desc" } }),
      prisma.problem.findMany({ where: { rating: { not: null } }, distinct: ["rating"], select: { rating: true }, orderBy: { rating: "asc" } }),
      prisma.problem.findMany({ select: { tags: true } }),
    ]);
    response.json({ years: years.flatMap(({ year }) => year === null ? [] : [year]), ratings: ratings.flatMap(({ rating }) => rating === null ? [] : [rating]), tags: [...new Set(tags.flatMap(({ tags: rowTags }) => rowTags))].sort() });
  } catch (error) { next(error); }
});

app.get("/api/problemset/count", async (request, response, next) => {
  const parsed = z.object({ rating: z.coerce.number().int().positive().optional(), years: z.string().optional(), tags: z.string().optional(), tagMatchMode: z.enum(["ALL", "ANY"]).default("ANY") }).safeParse(request.query);
  if (!parsed.success) { response.status(400).json({ error: { code: "INVALID_QUERY", message: "Invalid problemset filters" } }); return; }
  try {
    const { rating, years, tags, tagMatchMode } = parsed.data;
    const yearValues = years?.split(",").map(Number);
    const tagValues = tags?.split(",").filter(Boolean);
    const count = await prisma.problem.count({ where: {
      ...(rating === undefined ? {} : { rating }),
      ...(yearValues?.length ? { year: { in: yearValues } } : {}),
      ...(tagValues?.length ? { tags: tagMatchMode === "ALL" ? { hasEvery: tagValues } : { hasSome: tagValues } } : {}),
    } });
    response.json({ count });
  } catch (error) { next(error); }
});

app.use((_request, response) => {
  response.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(JSON.stringify({ level: "error", message: "API request failed", requestId: response.locals.requestId, errorClass: error instanceof Error ? error.name : "UnknownError" }));
  const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 500;
  const message = status < 500 && error instanceof Error ? error.message : "An unexpected error occurred";
  response.status(status).json({ error: { code: status === 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED", message } });
});

app.listen(config.API_PORT, () => {
  console.info(`RateForces API listening on http://localhost:${config.API_PORT}`);
});
