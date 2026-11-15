import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { codeforces } from "../codeforces/client.js";
import type { CfSubmission } from "../codeforces/types.js";
import { prisma } from "../db.js";
import { checkVerification, hashToken, issueChallengeSession } from "./service.js";

describe("verification lifecycle (PostgreSQL integration)", () => {
  const handles: string[] = [];
  const challengeIds: string[] = [];
  let currentSubmissions: CfSubmission[] = [];
  let statusCalls = 0;
  const originalGetUserStatus = codeforces.getUserStatus;
  const originalGetUser = codeforces.getUser;

  before(() => {
    codeforces.getUserStatus = async () => { statusCalls += 1; return currentSubmissions; };
    codeforces.getUser = async (handle) => ({ handle, rating: 1500, rank: "specialist" });
  });

  after(async () => {
    codeforces.getUserStatus = originalGetUserStatus;
    codeforces.getUser = originalGetUser;
    if (challengeIds.length) await prisma.verificationChallenge.deleteMany({ where: { id: { in: challengeIds } } });
    if (handles.length) await prisma.owner.deleteMany({ where: { codeforcesHandle: { in: handles } } });
    await prisma.$disconnect();
  });

  async function createChallenge(options: { issuedAt?: Date; expiresAt?: Date; offsetMs?: number } = {}) {
    const handle = `testv_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    handles.push(handle);
    const now = Date.now();
    const challenge = await prisma.verificationChallenge.create({ data: {
      codeforcesHandle: handle,
      baselineSubmissionId: 10,
      targetContestId: 55,
      targetProblemIndex: "A",
      codeforcesTimeOffsetMs: options.offsetMs ?? 0,
      issuedAt: options.issuedAt ?? new Date(now - 60_000),
      expiresAt: options.expiresAt ?? new Date(now + 5 * 60_000),
    } });
    challengeIds.push(challenge.id);
    return challenge;
  }

  function proof(overrides: Partial<CfSubmission> = {}): CfSubmission {
    return {
      id: 11,
      creationTimeSeconds: Math.floor(Date.now() / 1000),
      problem: { contestId: 55, index: "A" },
      verdict: "COMPILATION_ERROR",
      ...overrides,
    };
  }

  it("consumes a matching CE once and issues a session once", async () => {
    const challenge = await createChallenge({ offsetMs: 2 * 60 * 60 * 1000 });
    currentSubmissions = [proof({ creationTimeSeconds: Math.floor((challenge.issuedAt.getTime() + 2 * 60 * 60 * 1000 + 60_000) / 1000) })];
    statusCalls = 0;

    const verified = await checkVerification(challenge.id);
    assert.equal(verified.status, "VERIFIED");
    assert.equal(statusCalls, 1);
    assert.equal((await checkVerification(challenge.id)).status, "VERIFIED");
    assert.equal(statusCalls, 1);

    const token = await issueChallengeSession(challenge.id);
    assert.ok(token);
    assert.equal(await issueChallengeSession(challenge.id), null);
    const owner = await prisma.owner.findUniqueOrThrow({ where: { codeforcesHandle: challenge.codeforcesHandle } });
    const session = await prisma.ownerSession.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    assert.equal(session.ownerId, owner.id);
    assert.ok(session.expiresAt > new Date());
  });

  it("expires an old challenge without querying Codeforces", async () => {
    const challenge = await createChallenge({ expiresAt: new Date(Date.now() - 1000) });
    statusCalls = 0;

    assert.deepEqual(await checkVerification(challenge.id), { status: "EXPIRED" });
    assert.equal(statusCalls, 0);
    assert.equal((await prisma.verificationChallenge.findUniqueOrThrow({ where: { id: challenge.id } })).status, "EXPIRED");
  });

  it("keeps challenges pending for stale, mistargeted, non-CE, and out-of-window submissions", async () => {
    const cases: CfSubmission[] = [
      proof({ id: 10 }),
      proof({ problem: { contestId: 55, index: "B" } }),
      proof({ verdict: "WRONG_ANSWER" }),
      proof({ creationTimeSeconds: Math.floor((Date.now() - 10 * 60_000) / 1000) }),
      proof({ creationTimeSeconds: Math.floor((Date.now() + 10 * 60_000) / 1000) }),
    ];

    for (const submission of cases) {
      const challenge = await createChallenge();
      currentSubmissions = [submission];
      assert.deepEqual(await checkVerification(challenge.id), { status: "PENDING" });
      assert.equal(await prisma.owner.findUnique({ where: { codeforcesHandle: challenge.codeforcesHandle } }), null);
    }
  });
});
