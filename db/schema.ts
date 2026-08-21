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

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
