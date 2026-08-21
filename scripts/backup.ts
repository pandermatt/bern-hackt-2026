import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import Database from "better-sqlite3";

/*
 * Snapshot the database before a risky change. `VACUUM INTO` is SQLite's own
 * backup statement: it is safe against a live WAL database (no locking out the
 * running app) and writes a single consolidated file with no -wal/-shm
 * companions to remember.
 *
 * Backups land under data/, which is gitignored, so they never reach git.
 */
const DB_PATH = process.env.DATABASE_PATH ?? "./data/app.db";
const BACKUP_DIR = process.env.BACKUP_DIR ?? join(dirname(DB_PATH), "backups");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const target = join(BACKUP_DIR, `app-${stamp}.db`);

mkdirSync(BACKUP_DIR, { recursive: true });

const sqlite = new Database(DB_PATH, { readonly: true, fileMustExist: true });

try {
  // The path is interpolated as a SQL string literal; single quotes are
  // doubled so a directory name containing one cannot break out.
  sqlite.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  console.log(`Backed up ${DB_PATH} → ${target}`);
} finally {
  sqlite.close();
}
