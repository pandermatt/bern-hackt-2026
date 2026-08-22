/**
 * The assistant's SQL escape hatch, defused.
 *
 * The model's SELECT never touches the app database. It runs in a throwaway
 * in-memory SQLite database containing exactly one table with exactly the
 * current user's rows — there is nothing else in it to leak: no other
 * accounts, no users, no sessions, no file on disk. Ownership scoping happens
 * before SQL is involved at all (the caller hands in rows it fetched through
 * the session-checked action layer), so a malicious query can at worst read
 * what its own author is already allowed to see.
 *
 * The layers, outermost first:
 *
 *  1. `validateSelect` (pure, unit-tested) rejects writes, DDL, PRAGMA/ATTACH,
 *     multiple statements, table-valued row generators, and huge-output scalar
 *     functions before anything runs.
 *  2. The query executes **in a worker thread** with a hard wall-clock
 *     deadline. better-sqlite3 is synchronous and exposes no interrupt or
 *     progress handler (verified against v13), so a runaway query — an
 *     unbounded recursive CTE, a cartesian product built by aliasing a CTE, a
 *     `json_each` cross join — can only be stopped by killing the thread it
 *     runs on. This is the one guard that categorically bounds CPU regardless
 *     of query shape; everything else is defence in depth.
 *  3. Inside the worker, rows are pulled with `.iterate()` and the loop breaks
 *     at ROW_CAP + 1, so a streaming cartesian never materializes in full, and
 *     each string cell is truncated so a `printf`-style blowup cannot OOM.
 */
import "server-only";

import { Worker } from "node:worker_threads";

import type { Transaction } from "@/db/schema";
import { validateSelect } from "@/lib/assistant";

export type SqlOutcome =
  | {
      ok: true;
      columns: string[];
      rows: unknown[][];
      rowCount: number;
      truncated: boolean;
    }
  | { ok: false; error: string };

/** Enough to answer anything aggregate; small enough to re-prompt with. */
const ROW_CAP = 40;
/** A single cell longer than this is truncated — defuses printf/hex blowups. */
const CELL_CAP = 2000;
/** Hard wall-clock deadline. A real analytic query over the user's own rows
 *  finishes in single-digit milliseconds; anything near this is pathological. */
const TIMEOUT_MS = 2000;

/**
 * The worker body, inlined as a string rather than a separate file so there is
 * no path for the bundler (Turbopack) to mislocate at build time. It runs as
 * CommonJS — `require` resolves `better-sqlite3` from the app's node_modules,
 * where it is an external (unbundled) dependency. Everything the worker needs
 * arrives through `workerData`; it posts back one `SqlOutcome`.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const Database = require("better-sqlite3");

const { rows, sql, rowCap, cellCap } = workerData;
const db = new Database(":memory:");
try {
  db.exec(
    "CREATE TABLE transactions (" +
      "booked_on TEXT NOT NULL, kind TEXT NOT NULL, amount_minor INTEGER NOT NULL, " +
      "amount_chf REAL NOT NULL, account TEXT NOT NULL, merchant TEXT NOT NULL, " +
      "category TEXT NOT NULL, description TEXT NOT NULL, currency TEXT NOT NULL)"
  );
  const insert = db.prepare(
    "INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const load = db.transaction((all) => {
    for (const r of all) {
      insert.run(
        r.bookedOn, r.kind, r.amountMinor, r.amountMinor / 100,
        r.account, r.merchant, r.category, r.description, r.currency
      );
    }
  });
  load(rows);

  const stmt = db.prepare(sql);
  if (!stmt.reader) {
    parentPort.postMessage({ ok: false, error: "Only statements that return rows are allowed." });
  } else {
    const columns = stmt.columns().map((c) => c.name);
    const capped = [];
    let truncated = false;
    // .iterate() is lazy: for a streaming cartesian, stopping here stops SQLite
    // stepping, so N^2 rows are never built. (An aggregate over a cartesian is
    // the case .iterate() cannot bound — that is what the worker timeout is for.)
    for (const row of stmt.raw().iterate()) {
      if (capped.length >= rowCap) { truncated = true; break; }
      capped.push(row.map((cell) => {
        if (typeof cell === "bigint") return Number(cell);
        if (cell instanceof Uint8Array) return "<blob>";
        if (typeof cell === "string" && cell.length > cellCap) {
          return cell.slice(0, cellCap) + "… (truncated)";
        }
        return cell;
      }));
    }
    parentPort.postMessage({
      ok: true, columns, rows: capped, rowCount: capped.length, truncated,
    });
  }
} catch (cause) {
  parentPort.postMessage({ ok: false, error: cause && cause.message ? cause.message : "The query failed." });
} finally {
  db.close();
}
`;

export async function runSandboxSql(
  rows: Transaction[],
  sql: string,
): Promise<SqlOutcome> {
  const invalid = validateSelect(sql);
  if (invalid) return { ok: false, error: invalid };

  return new Promise<SqlOutcome>((resolve) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { rows, sql, rowCap: ROW_CAP, cellCap: CELL_CAP },
    });

    let settled = false;
    const finish = (outcome: SqlOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(outcome);
    };

    const timer = setTimeout(
      () => finish({ ok: false, error: "The query took too long and was stopped." }),
      TIMEOUT_MS,
    );

    worker.on("message", (outcome: SqlOutcome) => finish(outcome));
    worker.on("error", (err) =>
      finish({ ok: false, error: err?.message ?? "The query failed." }),
    );
    worker.on("exit", () =>
      finish({ ok: false, error: "The query engine stopped unexpectedly." }),
    );
  });
}
