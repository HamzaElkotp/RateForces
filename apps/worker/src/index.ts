import "dotenv/config";
import { spawn } from "node:child_process";

const WEEK = 7 * 24 * 60 * 60 * 1000;
let importing = false;

function runProblemsetImport(): void {
  if (importing) return;
  importing = true;
  console.info("Starting scheduled Codeforces problemset import.");
  const child = spawn("npm", ["--workspace", "@rateforces/api", "run", "crawl:problemset"], { stdio: "inherit", shell: process.platform === "win32" });
  child.on("error", (error) => { console.error("Could not start problemset import:", error); importing = false; });
  child.on("exit", (code) => { importing = false; if (code !== 0) console.error(`Problemset import exited with code ${code ?? "unknown"}.`); });
}

runProblemsetImport();
setInterval(runProblemsetImport, WEEK);
console.info("RateForces worker started; weekly problemset refresh is scheduled.");
