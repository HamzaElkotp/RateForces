import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });
dotenv.config();
dotenv.config({ path: resolve(process.cwd(), "../../.env.test") });

if (process.env.RUN_DB_INTEGRATION === "true") {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required for integration tests.");
  if (process.env.TEST_DATABASE_VALIDATED !== "true") throw new Error("Run integration tests through npm run test:integration so the database safety check is applied.");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

await import("../src/auth/verification-proof.test.ts");
await import("../src/codeforces/normalize.test.ts");
await import("../src/rounds/results-calculation.test.ts");
await import("../src/rounds/selection.test.ts");
await import("../src/rounds/submission-window.test.ts");
await import("../src/rate-limit.test.ts");
if (process.env.RUN_DB_INTEGRATION === "true") {
  await import("../src/rounds/lifecycle.integration.test.ts");
  await import("../src/auth/verification.integration.test.ts");
  await import("../src/auth/history-sync.integration.test.ts");
}
