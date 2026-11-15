import dotenv from "dotenv";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });
dotenv.config();

const WEEK = 7 * 24 * 60 * 60 * 1000;
const CHALLENGE_POLL = 15 * 1000;
const ROUND_SYNC = 20 * 1000;
let activeJob = false;
const pendingJobs = new Set<"auth:poll" | "auth:cleanup" | "auth:sync-history" | "rounds:sync" | "crawl:problemset" | "worker:heartbeat">();

function runNextJob(): void {
  if (activeJob || pendingJobs.size === 0) return;
  const script = pendingJobs.values().next().value;
  if (!script) return;
  pendingJobs.delete(script);
  activeJob = true;
  console.info(`Starting scheduled ${script} job.`);
  const child = spawn("npm", ["--workspace", "@rateforces/api", "run", script], { stdio: "inherit", shell: process.platform === "win32" });
  child.on("error", (error) => { console.error(`Could not start ${script}:`, error); activeJob = false; runNextJob(); });
  child.on("exit", (code) => { activeJob = false; if (code !== 0) console.error(`${script} exited with code ${code ?? "unknown"}.`); runNextJob(); });
}

function schedule(script: "auth:poll" | "auth:cleanup" | "auth:sync-history" | "rounds:sync" | "crawl:problemset" | "worker:heartbeat"): void {
  pendingJobs.add(script);
  runNextJob();
}

schedule("auth:poll");
schedule("auth:cleanup");
schedule("worker:heartbeat");
setInterval(() => schedule("auth:poll"), CHALLENGE_POLL);
setInterval(() => schedule("auth:cleanup"), 24 * 60 * 60 * 1000);
setInterval(() => schedule("worker:heartbeat"), 30 * 1000);
setInterval(() => schedule("auth:sync-history"), 60 * 1000);
setInterval(() => schedule("rounds:sync"), ROUND_SYNC);
setTimeout(() => schedule("crawl:problemset"), WEEK);
console.info("RateForces worker started; challenge polling and weekly problemset refresh are scheduled.");
