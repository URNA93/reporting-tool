import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

const workerEnv = env as unknown as { DB?: D1Database };

export function getDb() {
  if (!workerEnv.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(workerEnv.DB, { schema });
}

export function getD1() {
  if (!workerEnv.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }
  return workerEnv.DB;
}
