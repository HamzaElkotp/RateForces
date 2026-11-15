import "dotenv/config";
import { spawn } from "node:child_process";

const WEEK = 7 * 24 * 60 * 60 * 1000;
const CHALLENGE_POLL = 15 * 1000;
const ROUND_SYNC = 20 * 1000;
let activeJob = false;

function runApiJob(script: "auth:poll" | "auth:sync-history" | "rounds:sync" | "crawl:problemset"): void {
  if (activeJob) return;
  activeJob = true;
  console.info(`Starting scheduled ${script} job.`);
  const child = spawn("npm", ["--workspace", "@rateforces/api", "run", script], { stdio: "inherit", shell: process.platform === "win32" });
  child.on("error", (error) => { console.error(`Could not start ${script}:`, error); activeJob = false; });
  child.on("exit", (code) => { activeJob = false; if (code !== 0) console.error(`${script} exited with code ${code ?? "unknown"}.`); });
}

runApiJob("auth:poll");
setInterval(() => runApiJob("auth:poll"), CHALLENGE_POLL);
setInterval(() => runApiJob("auth:sync-history"), 60 * 1000);
setInterval(() => runApiJob("rounds:sync"), ROUND_SYNC);
setTimeout(() => runApiJob("crawl:problemset"), WEEK);
console.info("RateForces worker started; challenge polling and weekly problemset refresh are scheduled.");
