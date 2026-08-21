import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Every test run gets its own throwaway SQLite file, never ./data/app.db.
 * The schema comes from `drizzle-kit push` reading `db/schema.ts` — the same
 * path production uses, since drizzle.config.ts already honours
 * DATABASE_PATH — so the tests cannot drift from the real schema.
 *
 * Set here, before the workers are spawned, so they inherit it: `db/index.ts`
 * reads DATABASE_PATH at import time.
 */
export default function setup() {
  const dir = mkdtempSync(join(tmpdir(), "beyond-money-test-"));
  const dbPath = join(dir, "test.db");

  process.env.DATABASE_PATH = dbPath;

  execFileSync("npx", ["drizzle-kit", "push", "--force"], {
    env: { ...process.env, DATABASE_PATH: dbPath },
    stdio: "pipe",
  });

  return () => rmSync(dir, { recursive: true, force: true });
}
