import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { codeforces } from "../codeforces/client.js";
import { isVerificationProof } from "./verification-proof.js";

const SESSION_COOKIE = "rateforces_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function startVerification(rawHandle: string) {
  const handle = rawHandle.trim();
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(handle)) throw Object.assign(new Error("Enter a valid Codeforces handle."), { status: 400 });
  const { VERIFICATION_CONTEST_ID, VERIFICATION_PROBLEM_INDEX } = await import("../config.js").then(({ config }) => config);
  if (!VERIFICATION_CONTEST_ID || !VERIFICATION_PROBLEM_INDEX) throw Object.assign(new Error("Verification is not configured yet."), { status: 503 });
  const user = await codeforces.getUser(handle);
  if (!user) throw Object.assign(new Error("Codeforces handle was not found."), { status: 404 });
  const recent = await codeforces.getUserStatus(user.handle, 1, 1);
  const now = new Date();
  const challenge = await prisma.verificationChallenge.create({ data: {
    codeforcesHandle: user.handle,
    baselineSubmissionId: recent[0]?.id ?? 0,
    targetContestId: VERIFICATION_CONTEST_ID,
    targetProblemIndex: VERIFICATION_PROBLEM_INDEX,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
  } });
  return { challengeId: challenge.id, handle: user.handle, targetContestId: VERIFICATION_CONTEST_ID, targetProblemIndex: VERIFICATION_PROBLEM_INDEX, expiresAt: challenge.expiresAt.toISOString() };
}

export async function checkVerification(challengeId: string) {
  const challenge = await prisma.verificationChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge) throw Object.assign(new Error("Verification challenge was not found."), { status: 404 });
  if (challenge.consumedAt) return { status: "VERIFIED" as const };
  if (challenge.expiresAt <= new Date()) {
    await prisma.verificationChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { status: "EXPIRED" } });
    return { status: "EXPIRED" as const };
  }
  const submissions = await codeforces.getUserStatus(challenge.codeforcesHandle, 1, 100);
  const proof = submissions.find((submission) => isVerificationProof(submission, challenge));
  if (!proof) return { status: "PENDING" as const };

  const profile = await codeforces.getUser(challenge.codeforcesHandle);
  const ownerId = await prisma.$transaction(async (tx) => {
    const claimed = await tx.verificationChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date(), status: "VERIFIED" } });
    if (claimed.count !== 1) return null;
    const owner = await tx.owner.upsert({
      where: { codeforcesHandle: challenge.codeforcesHandle },
      create: { codeforcesHandle: challenge.codeforcesHandle, verifiedAt: new Date(), rating: profile?.rating ?? null, rank: profile?.rank ?? null },
      update: { verifiedAt: new Date(), rating: profile?.rating ?? null, rank: profile?.rank ?? null },
    });
    await tx.verificationChallenge.update({ where: { id: challenge.id }, data: { ownerId: owner.id } });
    return owner.id;
  });
  return ownerId ? { status: "VERIFIED" as const, ownerId } : { status: "PENDING" as const };
}

export async function getVerificationStatus(challengeId: string): Promise<"PENDING" | "VERIFIED" | "EXPIRED"> {
  const challenge = await prisma.verificationChallenge.findUnique({ where: { id: challengeId }, select: { consumedAt: true, expiresAt: true, status: true } });
  if (!challenge) throw Object.assign(new Error("Verification challenge was not found."), { status: 404 });
  if (challenge.consumedAt) return "VERIFIED";
  if (challenge.expiresAt <= new Date()) return "EXPIRED";
  return "PENDING";
}

export async function issueChallengeSession(challengeId: string): Promise<string | null> {
  const challenge = await prisma.verificationChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge?.consumedAt || !challenge.ownerId || challenge.sessionIssuedAt) return null;
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const issued = await prisma.$transaction(async (tx) => {
    const claim = await tx.verificationChallenge.updateMany({ where: { id: challenge.id, sessionIssuedAt: null }, data: { sessionIssuedAt: now } });
    if (claim.count !== 1) return false;
    await tx.ownerSession.create({ data: { ownerId: challenge.ownerId!, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + SESSION_TTL_MS) } });
    return true;
  });
  return issued ? token : null;
}

export function setSessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? "; Secure" : ""}`;
}

export function sessionCookieName(): string { return SESSION_COOKIE; }
