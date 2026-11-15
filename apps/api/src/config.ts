import dotenv from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });
dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  CODEFORCES_API_BASE: z.string().url().default("https://codeforces.com/api"),
  CODEFORCES_REQUEST_INTERVAL_MS: z.coerce.number().int().positive().default(2100),
  VERIFICATION_CONTEST_ID: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().int().positive().default(1)),
  VERIFICATION_PROBLEM_INDEX: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).default("A")),
  SESSION_SECRET: z.string().min(32),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
