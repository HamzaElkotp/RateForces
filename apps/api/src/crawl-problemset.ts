import { importProblemset } from "./codeforces/importer.js";
import { prisma } from "./db.js";

try {
  const result = await importProblemset();
  console.info(`Problemset import complete: ${result.problems} problems; ${result.contests} contests fetched.`);
} catch (error) {
  console.error("Problemset import failed:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
