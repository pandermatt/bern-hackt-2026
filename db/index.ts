import "server-only";

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

const DB_PATH = process.env.DATABASE_PATH ?? "./data/app.db";

function createDb() {
  // better-sqlite3 throws if the parent directory does not exist.
  mkdirSync(dirname(DB_PATH), { recursive: true });

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  return drizzle(sqlite, { schema });
}

// Next's dev server re-evaluates modules on every HMR pass; without this cache
// each reload would leak a new file handle onto the same database.
const globalForDb = globalThis as unknown as {
  __beyondMoneyDb?: ReturnType<typeof createDb>;
};

export const db = globalForDb.__beyondMoneyDb ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__beyondMoneyDb = db;
}

/**
 * A throwaway in-memory database for the assistant's SQL sandbox. Exported
 * from here because this module is the app's one better-sqlite3 boundary —
 * `lib/sql-sandbox.ts` gets a handle without opening a second import path to
 * the driver. Callers own the handle and must `close()` it; nothing here is
 * cached and the app database is never touched.
 */
export function createScratchDb(): InstanceType<typeof Database> {
  return new Database(":memory:");
}
