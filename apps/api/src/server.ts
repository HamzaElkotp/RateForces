import cors from "cors";
import express from "express";
import { z } from "zod";
import { config } from "./config.js";
import { prisma } from "./db.js";

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "rateforces-api", timestamp: new Date().toISOString() });
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
  response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
});

app.listen(config.API_PORT, () => {
  console.info(`RateForces API listening on http://localhost:${config.API_PORT}`);
});
