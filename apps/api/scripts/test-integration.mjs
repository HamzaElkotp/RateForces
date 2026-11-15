import dotenv from "dotenv";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });
dotenv.config();
dotenv.config({ path: resolve(process.cwd(), "../../.env.test") });

if (!process.env.TEST_DATABASE_URL) throw new Error("Set TEST_DATABASE_URL in .env.test before running integration tests.");
if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) throw new Error("Refusing to run integration tests against DATABASE_URL. Configure a separate TEST_DATABASE_URL.");

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL_UNPOOLED = process.env.TEST_DATABASE_URL;

const node = process.execPath;
const prismaScript = resolve(process.cwd(), "scripts/prisma.mjs");
const migration = spawnSync(node, [prismaScript, "migrate", "deploy"], { stdio: "inherit", env: process.env });
if (migration.status !== 0) process.exit(migration.status ?? 1);

const tests = spawnSync(node, ["--import", "tsx", "--test", "scripts/test-runner.mjs"], {
  stdio: "inherit",
  env: { ...process.env, RUN_DB_INTEGRATION: "true", TEST_DATABASE_VALIDATED: "true" },
});
process.exit(tests.status ?? 1);
