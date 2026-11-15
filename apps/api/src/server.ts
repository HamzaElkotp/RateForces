import cors from "cors";
import express from "express";
import { z } from "zod";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { getVerificationStatus, hashToken, issueChallengeSession, sessionCookieName, setSessionCookie, startVerification } from "./auth/service.js";
import { requireOwner } from "./auth/middleware.js";

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
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

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "rateforces-api", timestamp: new Date().toISOString() });
});

app.post("/api/v1/auth/verification", async (request, response, next) => {
  const body = z.object({ handle: z.string().trim().min(3).max(24) }).safeParse(request.body);
  if (!body.success) { response.status(400).json({ error: { code: "INVALID_HANDLE", message: "Enter a valid Codeforces handle." } }); return; }
  if (!limitVerificationStarts(request.ip ?? "unknown")) { response.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many verification attempts. Try again later." } }); return; }
  try { response.status(201).json({ data: await startVerification(body.data.handle), error: null }); } catch (error) { next(error); }
});

app.get("/api/v1/auth/verification/:challengeId", async (request, response, next) => {
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
  console.error("API request failed:", error);
  const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 500;
  const message = status < 500 && error instanceof Error ? error.message : "An unexpected error occurred";
  response.status(status).json({ error: { code: status === 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED", message } });
});

app.listen(config.API_PORT, () => {
  console.info(`RateForces API listening on http://localhost:${config.API_PORT}`);
});
