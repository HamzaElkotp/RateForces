import dotenv from "dotenv";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

const root = resolve(process.cwd(), "../..");
dotenv.config({ path: resolve(root, ".env") });
dotenv.config({ path: resolve(root, ".env.test") });

if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    "Set TEST_DATABASE_URL in .env.test before running browser tests.",
  );
if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL)
  throw new Error(
    "Refusing to run browser tests against DATABASE_URL. Configure a separate TEST_DATABASE_URL.",
  );

const env = {
  ...process.env,
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  DATABASE_URL_UNPOOLED: process.env.TEST_DATABASE_URL,
};
const node = process.execPath;
const prismaScript = resolve(process.cwd(), "scripts/prisma.mjs");
const migration = spawnSync(node, [prismaScript, "migrate", "deploy"], {
  stdio: "inherit",
  env,
});
if (migration.status !== 0) process.exit(migration.status ?? 1);

const prisma = new PrismaClient({
  datasources: { db: { url: env.DATABASE_URL } },
});
const processes = [];
let browser;
let cfServer;
let webServer;
let apiServer;
let ownerId;
let handle;
let contestIds = [];
let acceptedSubmission;

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen(server.address().port);
    });
  });
}

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return port;
}

function start(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  processes.push(child);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitFor(url, child, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`${label} exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* service is still starting */
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`${label} did not become ready at ${url}.`);
}

async function runScript(script, overrides = {}) {
  const child = spawn(node, ["--import", "tsx", script], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...env, ...overrides },
  });
  processes.push(child);
  const [code, signal] = await once(child, "exit");
  if (code !== 0)
    throw new Error(
      `${script} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`,
    );
}

async function assertNoHorizontalOverflow(page, screen) {
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          className: element.className,
          left: rect.left,
          right: rect.right,
        };
      })
      .filter(
        (element) => element.left < 0 || element.right > window.innerWidth,
      )
      .slice(0, 8),
  }));
  if (overflow.width > 375)
    throw new Error(
      `The ${screen} screen is ${overflow.width}px wide at a 375px viewport: ${JSON.stringify(overflow.elements)}`,
    );
}

try {
  const nonce = Date.now();
  handle = `RateForcesE2E${nonce.toString().slice(-6)}`;
  await prisma.verificationChallenge.deleteMany({
    where: { codeforcesHandle: { startsWith: "RateForcesE2E" } },
  });
  await prisma.owner.deleteMany({
    where: { codeforcesHandle: { startsWith: "RateForcesE2E" } },
  });
  const baseContestId = 900_000_000 + Math.floor(Math.random() * 90_000_000);
  contestIds = [
    baseContestId,
    baseContestId + 1,
    baseContestId + 2,
    baseContestId + 3,
    baseContestId + 4,
  ];
  await prisma.problem.createMany({
    data: contestIds.map((contestId, index) => ({
      contestId,
      problemIndex: "A",
      name: `E2E problem ${index + 1}`,
      rating: 1200,
      tags: ["implementation"],
      year: 2025,
      contestStartTime: new Date("2025-01-01T00:00:00Z"),
      contestName: `E2E contest ${index + 1}`,
      solvedCount: 100,
    })),
  });

  let challengeSubmission;
  const baseline = {
    id: 100,
    creationTimeSeconds: Math.floor(Date.now() / 1000) - 10,
    problem: { contestId: 1, index: "A", name: "Theatre Square" },
    verdict: "OK",
  };
  cfServer = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Date", new Date().toUTCString());
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    let result;
    if (url.pathname.endsWith("/user.info"))
      result = [{ handle, rating: 1400, rank: "specialist" }];
    else if (url.pathname.endsWith("/user.status")) {
      const from = Number(url.searchParams.get("from") ?? 1);
      result =
        from === 1 && Number(url.searchParams.get("count")) === 1
          ? [baseline]
          : [acceptedSubmission, challengeSubmission, baseline].filter(Boolean);
    } else result = [];
    response.end(JSON.stringify({ status: "OK", result }));
  });
  const cfPort = await listen(cfServer);

  const apiPort = await freePort();
  const webPort = await freePort();
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const webOrigin = `http://127.0.0.1:${webPort}`;
  apiServer = start(node, ["--import", "tsx", "src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...env,
      API_PORT: String(apiPort),
      WEB_ORIGIN: webOrigin,
      CODEFORCES_API_BASE: `http://127.0.0.1:${cfPort}`,
      CODEFORCES_REQUEST_INTERVAL_MS: "20",
      VERIFICATION_CONTEST_ID: "1",
      VERIFICATION_PROBLEM_INDEX: "A",
      SESSION_SECRET: "e2e-only-secret-that-is-at-least-32-characters",
    },
  });
  const vitePath = resolve(root, "node_modules/vite/bin/vite.js");
  webServer = start(
    node,
    [
      vitePath,
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
      "--strictPort",
    ],
    {
      cwd: resolve(root, "apps/web"),
      env: { ...env, RATEFORCES_API_TARGET: apiOrigin },
    },
  );
  await Promise.all([
    waitFor(`${apiOrigin}/api/health/live`, apiServer, "API"),
    waitFor(webOrigin, webServer, "Vite"),
  ]);

  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(webOrigin);
  await page.getByRole("link", { name: /Link Codeforces account/ }).waitFor();
  await assertNoHorizontalOverflow(page, "home");
  await page.getByLabel("Color theme").selectOption("dark");
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.getByLabel("Color theme").selectOption("system");
  await page.goto(`${webOrigin}/link-account`);
  await page.getByLabel("Codeforces handle").fill(handle);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Submit a Compilation error", { exact: true }).waitFor();

  const challenge = await prisma.verificationChallenge.findFirstOrThrow({
    where: { codeforcesHandle: handle, status: "PENDING" },
  });
  challengeSubmission = {
    id: 101,
    creationTimeSeconds: Math.ceil(Date.now() / 1000) + 1,
    problem: { contestId: 1, index: "A", name: "Theatre Square" },
    verdict: "COMPILATION_ERROR",
  };
  await runScript("src/auth/poll-challenges.ts", {
    CODEFORCES_API_BASE: `http://127.0.0.1:${cfPort}`,
    CODEFORCES_REQUEST_INTERVAL_MS: "20",
  });
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
  await page.getByRole("heading", { name: new RegExp(handle) }).waitFor();
  await assertNoHorizontalOverflow(page, "dashboard");
  const owner = await prisma.owner.findUniqueOrThrow({
    where: { codeforcesHandle: handle },
  });
  ownerId = owner.id;

  await page.getByRole("link", { name: /Create a practice round/ }).click();
  await page.getByLabel("Exact problem rating").waitFor();
  await assertNoHorizontalOverflow(page, "round builder");
  await page.getByLabel("Number of problems").fill("5");
  await page.getByLabel("Round duration (minutes)").fill("5");
  await page.getByRole("button", { name: "Preview availability" }).click();
  await page.getByText(/5 eligible/).waitFor();
  await page.getByRole("button", { name: "Create lobby" }).click();
  await page.getByText("LOBBY · 5 MINUTES").waitFor();
  await assertNoHorizontalOverflow(page, "round lobby");
  await page.getByRole("button", { name: "Start round" }).click();
  await page.getByText("RUNNING · 5 MINUTES").waitFor();
  await assertNoHorizontalOverflow(page, "running round");
  const selected = await prisma.roundProblem.findFirstOrThrow({
    where: { round: { ownerId }, orderIndex: 0 },
  });
  await page.getByRole("button", { name: "Start working" }).first().click();
  await page.getByText("IN_PROGRESS · 0 attempts · 0 failed").first().waitFor();

  acceptedSubmission = {
    id: 102,
    creationTimeSeconds: Math.ceil(Date.now() / 1000) + 1,
    problem: {
      contestId: selected.contestId,
      index: selected.problemIndex,
      name: selected.name,
    },
    verdict: "OK",
  };
  await runScript("src/rounds/sync-submissions.ts", {
    CODEFORCES_API_BASE: `http://127.0.0.1:${cfPort}`,
    CODEFORCES_REQUEST_INTERVAL_MS: "20",
  });
  await page
    .getByText("SOLVED · 1 attempts · 0 failed", { timeout: 15_000 })
    .waitFor();
  await page.getByRole("link", { name: "accepted submission" }).waitFor();
  console.info(
    "Browser E2E passed: mobile layout, theme switching, verification, session cookie, round preview/create/start, work tracking, and accepted submission sync.",
  );
} finally {
  await browser?.close().catch(() => {});
  for (const child of [webServer, apiServer, ...processes]) {
    if (child && child.exitCode === null) {
      child.kill();
      if (process.platform === "win32")
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
    }
  }
  if (cfServer?.listening)
    await new Promise((resolveClose) => cfServer.close(() => resolveClose()));
  if (handle)
    await prisma.verificationChallenge.deleteMany({
      where: { codeforcesHandle: handle },
    });
  if (handle)
    await prisma.owner.deleteMany({ where: { codeforcesHandle: handle } });
  if (contestIds.length)
    await prisma.problem.deleteMany({
      where: { contestId: { in: contestIds } },
    });
  await prisma.$disconnect();
}
