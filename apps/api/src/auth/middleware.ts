import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";

declare global { namespace Express { interface Request { owner?: { id: string; codeforcesHandle: string; rating: number | null; rank: string | null } } } }

function readCookie(header: string | undefined, name: string): string | undefined {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function requireOwner(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const token = readCookie(request.headers.cookie, "rateforces_session");
    if (!token) { response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Link your Codeforces account to continue." } }); return; }
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const session = await prisma.ownerSession.findUnique({ where: { tokenHash }, include: { owner: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) { response.status(401).json({ error: { code: "SESSION_EXPIRED", message: "Your session has expired." } }); return; }
    request.owner = { id: session.owner.id, codeforcesHandle: session.owner.codeforcesHandle, rating: session.owner.rating, rank: session.owner.rank };
    await prisma.ownerSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
    next();
  } catch (error) { next(error); }
}
