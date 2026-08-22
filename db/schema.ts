import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  /**
   * What we greet someone by. **Nullable on purpose**, for the same reason
   * `transactions.userId` is: production boots with `drizzle-kit push` and no
   * `--force`, and adding a NOT NULL column to a populated table is a data-loss
   * statement that fails the deploy. It is also genuinely optional — the field
   * is not required at sign-up. Accounts without one fall back to the email's
   * local part; see `displayName` in `lib/user.ts`.
   */
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Server-side sessions. `id` holds a SHA-256 hash of the session token — the
 * raw token only ever exists in the user's cookie, so a leaked database does
 * not hand out usable sessions.
 */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});

/**
 * One line from a bank statement, already normalized: signed minor units, a
 * canonical merchant name, and a rule-assigned category. This table is
 * read-only in the UI — rows only ever arrive through `npm run seed`.
 */
export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /**
     * Nullable on purpose. Production boots with `drizzle-kit push` and no
     * `--force`, and adding a NOT NULL column to a populated table is a
     * data-loss statement that would fail the deploy. Ownership is enforced in
     * the application layer instead: every query filters on this column, so a
     * NULL-owner row matches nobody. **Do not "tighten" this to NOT NULL**
     * without a deliberate migration plan.
     */
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    /**
     * The statement line's natural key — date|kind|source|target|amount|name,
     * joined verbatim from the export. It is what makes re-seeding idempotent
     * and what collapses the credit-card payments, which appear identically in
     * both account exports. Unique per user rather than globally: two accounts
     * may legitimately import the same file.
     */
    externalId: text("external_id").notNull(),
    /**
     * Calendar day as `YYYY-MM-DD`, not a unix timestamp. A booking date is a
     * date, not an instant: stored as a timestamp, 2025-01-01 renders as
     * 2024-12-31 for anyone west of UTC. Text also makes the month key a
     * `slice(0, 7)` and range filters plain string comparisons.
     */
    bookedOn: text("booked_on").notNull(),
    kind: text("kind", { enum: ["expense", "income", "transfer"] }).notNull(),
    /**
     * Signed CHF minor units (rappen). Integers, not `real`: the EUR lines in
     * the source arrive as 46.96976052505031, and summing a few hundred
     * IEEE-754 doubles drifts. Income is positive, expenses and transfers
     * negative, so a plain sum is the net.
     */
    amountMinor: integer("amount_minor").notNull(),
    /** The currency the line was actually charged in — see scripts/seed.ts. */
    currency: text("currency").notNull().default("CHF"),
    /**
     * Unsigned minor units in `currency`, kept so a real FX conversion can be
     * added later without re-importing.
     */
    originalAmountMinor: integer("original_amount_minor").notNull(),
    /** "Privatkonto" | "KK-Konto" — the account this line belongs to. */
    account: text("account").notNull(),
    /**
     * Canonical display name. The importer folds Orell Fuessli / Orell Füssli
     * and Swiss Intl. Airlines / SWISS International Airlines onto one name, or
     * the top-merchants list silently splits them.
     */
    merchant: text("merchant").notNull(),
    /** Rule-assigned at import, never derived at read time. */
    category: text("category").notNull(),
    /** The statement's own free-text line ("Bestellung OrellFuessli"). */
    description: text("description").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("transactions_user_id_idx").on(table.userId),
    index("transactions_user_booked_on_idx").on(table.userId, table.bookedOn),
    // Idempotent re-seeding leans on this: the same statement line imported
    // twice is one row. NULLs are distinct in a SQLite unique index, so
    // owner-less rows never collide — they match nobody anyway.
    uniqueIndex("transactions_user_external_id_idx").on(
      table.userId,
      table.externalId,
    ),
  ],
);

/**
 * A persisted anomaly finding. The engine is expensive to run over a full
 * history, so it is no longer evaluated while rendering the dashboard — a scan
 * is triggered from the account page, writes its results here, and the
 * dashboard just reads the rows for the transactions it is showing.
 *
 * One row per (insight, transaction) pair rather than one per insight. An
 * insight can implicate several transactions, and every read is "what is wrong
 * with the rows on this page", so flattening it here turns that into a single
 * indexed lookup instead of a scan-and-unnest.
 */
export const anomalies = sqliteTable(
  "anomalies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Nullable for the same deploy-safety reason as `transactions.userId`. */
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    /**
     * Not a foreign key on purpose. A scan is a snapshot; if the statements are
     * re-imported the transaction ids change, and a cascade would silently
     * empty this table mid-scan rather than leaving a stale result the user can
     * see and re-run. Rows are replaced wholesale by the next scan.
     */
    transactionId: integer("transaction_id").notNull(),
    ruleId: text("rule_id").notNull(),
    severity: text("severity", {
      enum: ["low", "medium", "high"],
    }).notNull(),
    /**
     * How much concern the finding warrants, as opposed to how far from
     * baseline it sits — see `AnomalyKind` in `lib/anomaly-engine.ts` for why
     * that is a second axis and not a rename of `severity`.
     *
     * The default is not stylistic: SQLite rejects
     * `ALTER TABLE … ADD COLUMN … NOT NULL` outright when no default is given,
     * so a column added to a populated table has to have one. It also means
     * rows written by an earlier scan read `warning` until the account is
     * re-scanned, which is fine — a scan replaces its predecessor wholesale.
     */
    kind: text("kind", {
      enum: ["info", "warning", "alert"],
    })
      .notNull()
      .default("warning"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    icon: text("icon").notNull(),
    emoji: text("emoji").notNull().default(""),
    /** `supporting_metrics`, JSON-encoded — shape varies per rule. */
    metrics: text("metrics").notNull().default("{}"),
    /**
     * How this finding is rendered in the reader's language.
     *
     * `title` and `description` above are the text as the scan produced it —
     * English from the engine, or the narrative layer's own words. Those
     * cannot be re-read in another language, so the deterministic rule and its
     * values are kept alongside: `base_rule_id` names the `AnomalyFindings`
     * message (it differs from `rule_id` only when the narrative layer merged
     * several findings into one) and `params` carries the values it needs.
     * `narrative_locale` is set only when the stored text came from the model,
     * and says which language it is in — read in the other one, the row falls
     * back to the translated rule message rather than showing German to an
     * English reader.
     *
     * All three are nullable: rows written before this existed still render
     * from `title` / `description`, and a nullable column is what
     * `drizzle-kit push` can add to a populated table without `--force`.
     */
    baseRuleId: text("base_rule_id"),
    params: text("params"),
    narrativeLocale: text("narrative_locale"),
    /**
     * When someone ticked this finding off, or NULL while it still wants a
     * look. A timestamp rather than a boolean, for two reasons: nullable is
     * what `drizzle-kit push` can add to a populated table without `--force`,
     * and once "whether" is stored "when" costs nothing.
     *
     * Resolution is per (finding, transaction) — the grain of this table — so
     * ticking a transaction off under one rule leaves another rule's finding
     * on the same transaction open. They are different claims.
     */
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    /**
     * `transactions.externalId` for `transactionId`, copied in at scan time.
     *
     * This is what lets a resolution outlive the row it points at. Both
     * `scripts/seed.ts` and `lib/demo-loader.ts` delete-then-insert, so every
     * `npm run start` reissues transaction ids; a resolution matched on
     * `transaction_id` alone would be silently lost on every deploy. The
     * natural key survives a re-import, so `(rule_id, this)` is what the
     * carry-over in `runScan` matches on.
     *
     * Nullable: rows written before this column existed carry none, and those
     * fall back to an id lookup — correct until the next re-import.
     */
    transactionExternalId: text("transaction_external_id"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("anomalies_user_id_idx").on(table.userId),
    // The dashboard's only query: the findings for the ids on this page.
    index("anomalies_user_transaction_idx").on(table.userId, table.transactionId),
    // `/anomalies/[ruleId]` reads one rule's findings, and the carry-over in
    // `runScan` reads them by rule too.
    index("anomalies_user_rule_idx").on(table.userId, table.ruleId),
  ],
);

/**
 * One row per scan, holding its progress so the account page can poll it.
 *
 * Progress lives in the database rather than in memory because the action that
 * starts a scan returns immediately — the work continues on the server and the
 * browser polls a different request to watch it.
 */
export const anomalyRuns = sqliteTable(
  "anomaly_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    status: text("status", {
      enum: ["running", "done", "failed"],
    }).notNull(),
    /** Human-readable stage, shown under the progress bar. */
    phase: text("phase").notNull().default("Starting"),
    /** Transactions processed so far, and the total this scan is working over. */
    processed: integer("processed").notNull().default(0),
    total: integer("total").notNull().default(0),
    insightCount: integer("insight_count").notNull().default(0),
    /**
     * The fingerprint of the transaction set this scan ran over, so a later
     * read can tell "the statements changed" from "the ids were reissued".
     *
     * It cannot be a timestamp. Every importer delete-then-inserts and
     * `npm run start` re-seeds on every boot, so `transactions.createdAt` is
     * reset constantly and a scan would look out of date on every deploy even
     * when the statements are byte-identical. See `fingerprintOf` in
     * `lib/anomaly-sync.ts`.
     *
     * Nullable, and a NULL reads as "unknown" rather than "outdated": runs
     * that predate this column should not start nagging just because it
     * shipped, and a nullable column is what `drizzle-kit push` can add to a
     * populated table without `--force`.
     */
    transactionFingerprint: text("transaction_fingerprint"),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
  },
  (table) => [index("anomaly_runs_user_id_idx").on(table.userId)],
);

/**
 * A per-category monthly spending limit, set by the account holder.
 *
 * `userId` is NOT NULL here, unlike `transactions.userId`. That column is
 * nullable because it was added to a table that already had rows and
 * `drizzle-kit push` runs without `--force` on deploy; this table is created
 * empty, so the constraint costs nothing and ownership is enforced by the
 * database rather than only by the query layer.
 *
 * Limits are minor units (rappen) like every other amount in the schema, and
 * positive — a budget is a magnitude, not a signed movement. A category with
 * no row simply has no limit; there is no "unlimited" sentinel to
 * misinterpret.
 */
export const budgets = sqliteTable(
  "budgets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Matches `transactions.category` — the rule-assigned name, not free text. */
    category: text("category").notNull(),
    /** Positive minor units per month. */
    limitMinor: integer("limit_minor").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    // One limit per category per user, which is what makes saving an upsert
    // rather than a delete-and-reinsert.
    uniqueIndex("budgets_user_category_idx").on(table.userId, table.category),
  ],
);

/**
 * A savings goal — "Holiday, CHF 5'000" — and the pot the UI fills for it.
 *
 * Created empty like `budgets`, so `userId` is NOT NULL here too; see the note
 * on `transactions.userId` for why that column is the exception rather than
 * this one. The unique index on `(user_id, name)` is what stops an account
 * ending up with two pots called "Holiday" that each hold half the money.
 *
 * `targetMinor` is positive minor units, like every other amount in the
 * schema. A goal has no deadline column on purpose: nothing in the app can
 * act on one, and a date that only ever renders is a field that goes stale.
 */
export const savingsGoals = sqliteTable(
  "savings_goals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Positive minor units — what the pot holds when it is full. */
    targetMinor: integer("target_minor").notNull(),
    /**
     * When the money is wanted by, as `YYYY-MM-DD` text — a calendar day, not
     * an instant, for the same reason `transactions.bookedOn` is text: stored
     * as a timestamp, 2026-07-01 renders as 30 June for anyone west of UTC.
     *
     * Nullable, and it stays that way. Plenty of goals are "eventually" — a
     * rainy-day fund has no deadline — and this column was added to a table
     * that already had rows, which `drizzle-kit push` deploys without
     * `--force`. A date in the past is allowed: that is an overdue goal, which
     * is a true thing to say about it.
     */
    targetOn: text("target_on"),
    /**
     * Dead column, deliberately still declared.
     *
     * This was the Dauersparauftrag — a stated monthly intention that seeded
     * the allocator's fields and never moved money. The feature is gone and
     * nothing reads this, but the column stays in the schema because
     * production boots with `drizzle-kit push` and no `--force`: dropping a
     * column that holds data is a data-loss statement, and push stops on it
     * with `Interactive prompts require a TTY terminal`, which fails the
     * deploy. The same constraint that keeps `transactions.userId` nullable.
     *
     * Removing it for real means clearing the values first and pushing from a
     * terminal, which is a deliberate migration rather than a side effect of
     * deleting a feature. Until then it is inert.
     */
    monthlyMinor: integer("monthly_minor"),
    /**
     * The glyph the pot wears, as a lucide name (`"Dog"`) — one of the keys of
     * `GOAL_ICONS` in `lib/goal-icon.ts`.
     *
     * Only ever written for a goal whose name the keyword rules could not
     * place, where `lib/llm/suggest-goal-icon.ts` asked Apertus instead. A
     * matched name needs nothing stored: the rules will reach the same answer
     * on every render, for free.
     *
     * Nullable, and it stays that way — this column was added to a table that
     * already had rows, which `drizzle-kit push` deploys without `--force`.
     * `null` simply means nobody has named one, which is the state every goal
     * created before this column is in, and the state a goal stays in when the
     * model cannot be reached. Never trusted on read; `goalIcon` checks it
     * against the map before drawing it.
     */
    icon: text("icon"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("savings_goals_user_id_idx").on(table.userId),
    uniqueIndex("savings_goals_user_name_idx").on(table.userId, table.name),
  ],
);

/**
 * Money moved from one month's leftover into one pot.
 *
 * Keyed by month rather than appended as a log: the page's question is "how
 * much of March have I already put away", and with a log that answer changes
 * meaning the moment someone revises an allocation. One row per (goal, month)
 * makes revising an upsert and keeps the month's remaining balance a
 * subtraction rather than a reconciliation.
 *
 * Zero is not stored. Unlike a budget — where zero is a real limit of nothing
 * and `null` means unset — an allocation of zero francs and no allocation are
 * the same event, so clearing a field deletes the row.
 */
export const savingsAllocations = sqliteTable(
  "savings_allocations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goalId: integer("goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    /** `YYYY-MM` — which month's surplus this came out of. */
    month: text("month").notNull(),
    /** Positive minor units. */
    amountMinor: integer("amount_minor").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("savings_allocations_user_month_idx").on(table.userId, table.month),
    uniqueIndex("savings_allocations_goal_month_idx").on(
      table.goalId,
      table.month,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Anomaly = typeof anomalies.$inferSelect;
export type NewAnomaly = typeof anomalies.$inferInsert;
export type AnomalyRun = typeof anomalyRuns.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type SavingsGoal = typeof savingsGoals.$inferSelect;
export type SavingsAllocation = typeof savingsAllocations.$inferSelect;
