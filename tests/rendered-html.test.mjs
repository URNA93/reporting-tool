import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production bundle contains protected reporting and recovery routes", async () => {
  const serverBundle = await readFile(
    new URL("../dist/server/index.js", import.meta.url),
    "utf8",
  );
  const recoveryMigration = await readFile(
    new URL("../dist/.openai/drizzle/0002_optimal_supreme_intelligence.sql", import.meta.url),
    "utf8",
  );

  assert.match(serverBundle, /api\/auth\/recover-admin/);
  assert.match(serverBundle, /api\/admin\/users\/reset/);
  assert.match(serverBundle, /obnova-pristupu/);
  assert.match(recoveryMigration, /CREATE TABLE `password_reset_uses`/);
});
