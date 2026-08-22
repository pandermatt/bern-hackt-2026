import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  anomalies,
  transactions,
  users,
  type NewTransaction,
  type User,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth";

/*
 * The actions resolve the caller through getCurrentUser; everything else about
 * lib/auth stays real. `vi.hoisted` is what lets the mock factory — which is
 * itself hoisted — reach this holder.
 */
const signedIn = vi.hoisted(() => ({ user: null as User | null }));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getCurrentUser: async () => signedIn.user,
}));

const { getDashboard, getLedgerChunk, listTransactions } = await import(
  "@/app/actions/transactions"
);

async function createUser(email: string) {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword("correct horse") })
    .returning();
  return user;
}

function line(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    externalId: `key-${Math.random()}`,
    bookedOn: "2025-03-14",
    kind: "expense",
    amountMinor: -1000,
    currency: "CHF",
    originalAmountMinor: 1000,
    account: "Privatkonto",
    merchant: "Kantine AG",
    category: "Food & Drink",
    description: "Mittagessen",
    ...overrides,
  };
}

let alice: User;
let bob: User;

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(users);

  alice = await createUser("alice@example.com");
  bob = await createUser("bob@example.com");

  await db.insert(transactions).values(
    line({
      userId: bob.id,
      externalId: "bobs-line",
      merchant: "Bob's private merchant",
      amountMinor: -999999,
    }),
  );

  signedIn.user = alice;
});

describe("ownership", () => {
  it("lists only the caller's transactions", async () => {
    await db
      .insert(transactions)
      .values(line({ userId: alice.id, merchant: "Alice's merchant" }));

    const rows = await listTransactions({});
    expect(rows).toHaveLength(1);
    expect(rows[0].merchant).toBe("Alice's merchant");
  });

  it("hides rows with no owner from everyone", async () => {
    await db
      .insert(transactions)
      .values(line({ userId: null, externalId: "orphan" }));

    expect(await listTransactions({})).toHaveLength(0);

    signedIn.user = bob;
    expect((await listTransactions({})).map((row) => row.merchant)).toEqual([
      "Bob's private merchant",
    ]);
  });

  it("keeps another account's rows out of the totals", async () => {
    await db
      .insert(transactions)
      .values(line({ userId: alice.id, amountMinor: -1000 }));

    const dashboard = await getDashboard({});
    // Bob's CHF 9,999.99 line must not appear anywhere in Alice's figures.
    expect(dashboard?.totals.expense).toBe(1000);
    expect(dashboard?.merchants.map((slice) => slice.key)).toEqual([
      "Kantine AG",
    ]);
  });

  it("returns nothing at all when signed out", async () => {
    signedIn.user = null;

    expect(await getDashboard({})).toBeNull();
    expect(await listTransactions({})).toEqual([]);
  });
});

describe("filters", () => {
  beforeEach(async () => {
    await db.insert(transactions).values([
      line({
        userId: alice.id,
        externalId: "a-rent",
        bookedOn: "2025-01-01",
        merchant: "Rent",
        category: "Housing",
        amountMinor: -182000,
      }),
      line({
        userId: alice.id,
        externalId: "a-salary",
        bookedOn: "2025-01-23",
        kind: "income",
        merchant: "Employer AG",
        category: "Salary",
        amountMinor: 746400,
      }),
      line({
        userId: alice.id,
        externalId: "a-card",
        bookedOn: "2025-01-23",
        kind: "transfer",
        merchant: "Credit card payment",
        category: "Transfer",
        amountMinor: -135530,
      }),
    ]);
  });

  it("excludes transfers unless asked", async () => {
    expect(await listTransactions({})).toHaveLength(2);
    expect(await listTransactions({ includeTransfers: "true" })).toHaveLength(3);
  });

  it("does not read the string \"false\" as an opt-in", async () => {
    // z.coerce.boolean() would turn "false" into true here.
    expect(await listTransactions({ includeTransfers: "false" })).toHaveLength(2);
  });

  it("narrows by category and date range", async () => {
    expect(await listTransactions({ categories: "Housing" })).toHaveLength(1);
    expect(
      await listTransactions({ from: "2025-01-02", to: "2025-01-31" }),
    ).toHaveLength(1);
  });

  it("narrows by more than one category at once", async () => {
    // `?categories=Housing&categories=Salary` arrives as an array — a single
    // value collapses to a bare string, which the schema also has to accept.
    expect(
      await listTransactions({ categories: ["Housing", "Salary"] }),
    ).toHaveLength(2);
  });

  it("computes facets and the trend from the unfiltered set", async () => {
    const dashboard = await getDashboard({ categories: "Housing" });

    // The dropdowns must not narrow themselves into a dead end, and the
    // year's shape is the point of the chart even when viewing one category.
    expect(dashboard?.facets.categories).toEqual([
      "Housing",
      "Salary",
      "Transfer",
    ]);
    expect(dashboard?.monthly[0].income).toBe(746400);
    // The totals, though, follow the filter.
    expect(dashboard?.totals.expense).toBe(182000);
  });

  it("reports the viewed range from the filtered set, not the whole history", async () => {
    // The header under "Your year in money" reads `view`, so a date filter has
    // to move it — `facets` stays put because it feeds the dropdowns.
    const all = await getDashboard({});
    expect(all?.view.first).toBe("2025-01-01");
    expect(all?.view.last).toBe("2025-01-23");

    const narrowed = await getDashboard({ from: "2025-01-02", to: "2025-01-31" });
    expect(narrowed?.view.first).toBe("2025-01-23");
    expect(narrowed?.view.last).toBe("2025-01-23");
    // Unchanged, so the date inputs keep offering the full span.
    expect(narrowed?.facets.first).toBe("2025-01-01");
  });

  it("leaves the viewed range empty when a filter matches nothing", async () => {
    // Distinguishes "your filter is too narrow" from "you imported nothing",
    // which the header words differently.
    const dashboard = await getDashboard({ from: "2030-01-01" });

    expect(dashboard?.view.first).toBe("");
    expect(dashboard?.facets.first).toBe("2025-01-01");
  });

  it("falls back to defaults on a malformed query string rather than throwing", async () => {
    const dashboard = await getDashboard({
      from: "not-a-date",
      kind: "sideways",
      q: "x".repeat(500),
    });

    expect(dashboard).not.toBeNull();
    expect(dashboard?.transactions).toHaveLength(2);
    expect(dashboard?.filters.from).toBeUndefined();
  });

  it("reports no further chunk when the first one is the whole set", async () => {
    const dashboard = await getDashboard({});
    // The ledger scrolls rather than pages: `nextOffset` is null once there is
    // nothing left to append.
    expect(dashboard?.nextOffset).toBeNull();
    // The whole filtered set, not just `transactions.length` — the same two
    // non-transfer rows the other assertions above see.
    expect(dashboard?.totalCount).toBe(2);
  });

  it("ignores a leftover ?page without discarding the other filters", async () => {
    // Nothing reads `page` any more, but a bookmark from the paginated version
    // still carries one. It has to be inert, not fatal.
    const dashboard = await getDashboard({
      categories: "Housing",
      page: "not-a-number",
    });

    expect(dashboard?.filters.categories).toEqual(["Housing"]);
    expect(dashboard?.transactions).toHaveLength(1);
    expect(dashboard?.nextOffset).toBeNull();
  });

  describe("getLedgerChunk", () => {
    it("returns the same first chunk the dashboard renders", async () => {
      const dashboard = await getDashboard({});
      const chunk = await getLedgerChunk(0, {});

      expect(chunk?.rows.map((r) => r.id)).toEqual(
        dashboard?.transactions.map((r) => r.id),
      );
      expect(chunk?.nextOffset).toBe(dashboard?.nextOffset);
    expect(chunk?.continuesFrom).toBe(false);
    });

    it("scopes to the session account, not to any argument", async () => {
      // The only thing a caller gets to choose is how far in to start.
      const chunk = await getLedgerChunk(0, {});
      expect(chunk?.rows.every((r) => r.userId === alice.id)).toBe(true);
    });

    it("returns nothing once the offset is past the end", async () => {
      expect(await getLedgerChunk(9999, {})).toBeNull();
    });

    it("survives a junk offset", async () => {
      const chunk = await getLedgerChunk(Number.NaN, {});
      expect(chunk?.rows).toHaveLength(2);
    });
  });
});

describe("the anomaly filter", () => {
  /** Hangs a finding on a transaction, the way a completed scan would. */
  async function flag(transactionId: number, ruleId: string) {
    await db.insert(anomalies).values({
      userId: alice.id,
      transactionId,
      ruleId,
      severity: "medium",
      title: `${ruleId} title`,
      description: `${ruleId} description`,
      icon: "lucide:copy",
      emoji: "👯",
      metrics: "{}",
    });
  }

  async function seed(count: number, overrides: Partial<NewTransaction> = {}) {
    const rows: NewTransaction[] = [];
    for (let i = 0; i < count; i++) {
      rows.push(
        line({
          userId: alice.id,
          externalId: `flagged-${i}-${Math.random()}`,
          bookedOn: `2025-0${(i % 9) + 1}-15`,
          ...overrides,
        }),
      );
    }
    return db.insert(transactions).values(rows).returning();
  }

  it("narrows the ledger to the transactions the finding implicates", async () => {
    const rows = await seed(3);
    await flag(rows[0].id, "REPEAT_CHARGE");
    await flag(rows[2].id, "REPEAT_CHARGE");

    const dashboard = await getDashboard({ anomaly: "REPEAT_CHARGE" });
    expect(dashboard?.transactions.map((r) => r.id).sort()).toEqual(
      [rows[0].id, rows[2].id].sort(),
    );
    expect(dashboard?.totalCount).toBe(2);
  });

  it("shows nothing for a rule that matched nothing, rather than everything", async () => {
    await seed(3);
    const dashboard = await getDashboard({ anomaly: "NO_SUCH_RULE" });
    expect(dashboard?.transactions).toEqual([]);
    expect(dashboard?.totalCount).toBe(0);
  });

  it("reaches a flagged transfer only when transfers are asked for", async () => {
    // The reason every link on /anomalies carries includeTransfers.
    const [transfer] = await seed(1, { kind: "transfer" });
    await flag(transfer.id, "LARGE_TRANSFER");

    expect((await getDashboard({ anomaly: "LARGE_TRANSFER" }))?.totalCount).toBe(0);
    expect(
      (await getDashboard({ anomaly: "LARGE_TRANSFER", includeTransfers: "true" }))
        ?.totalCount,
    ).toBe(1);
  });

  it("composes with the other filters", async () => {
    const rows = await seed(2, { bookedOn: "2025-01-10" });
    const [late] = await seed(1, { bookedOn: "2025-08-10" });
    for (const r of [...rows, late]) await flag(r.id, "REPEAT_CHARGE");

    const dashboard = await getDashboard({
      anomaly: "REPEAT_CHARGE",
      from: "2025-06-01",
    });
    expect(dashboard?.transactions.map((r) => r.id)).toEqual([late.id]);
  });

  it("labels the filter with what the rule calls itself", async () => {
    const [row] = await seed(1);
    await flag(row.id, "REPEAT_CHARGE");

    expect((await getDashboard({ anomaly: "REPEAT_CHARGE" }))?.anomalyLabel).toBe(
      "REPEAT_CHARGE title",
    );
    // Unknown rule: no label, but the chip still has to render, so the filter
    // stays clearable rather than stranding an empty ledger.
    expect((await getDashboard({ anomaly: "NO_SUCH_RULE" }))?.anomalyLabel).toBeNull();
  });

  it("falls back to no filter on a malformed value instead of throwing", async () => {
    await seed(3);
    for (const anomaly of [123, "lowercase", "x".repeat(500), ["a", "b"]]) {
      const dashboard = await getDashboard({ anomaly });
      expect(dashboard?.filters.anomaly).toBeUndefined();
      expect(dashboard?.totalCount).toBeGreaterThan(0);
    }
  });

  it("agrees with the ledger chunk past the first page", async () => {
    // More than PAGE_SIZE flagged rows, so a non-zero offset is exercised. This
    // is the case that catches getDashboard and getLedgerChunk resolving the
    // anomaly id set differently — the offsets would silently stop lining up.
    const rows = await seed(60);
    for (const r of rows) await flag(r.id, "REPEAT_CHARGE");

    const filters = { anomaly: "REPEAT_CHARGE" };
    const dashboard = await getDashboard(filters);
    expect(dashboard?.totalCount).toBe(60);
    expect(dashboard?.transactions).toHaveLength(50);

    const second = await getLedgerChunk(dashboard!.nextOffset!, filters);
    expect(second?.rows).toHaveLength(10);
    // No overlap with the first page, and nothing skipped between them.
    const seen = new Set(dashboard!.transactions.map((r) => r.id));
    expect(second!.rows.every((r) => !seen.has(r.id))).toBe(true);
  });
});


describe("the unique index", () => {
  it("rejects the same statement line twice for one account", async () => {
    await db
      .insert(transactions)
      .values(line({ userId: alice.id, externalId: "same-line" }));

    await expect(
      db
        .insert(transactions)
        .values(line({ userId: alice.id, externalId: "same-line" })),
    ).rejects.toThrow();
  });

  it("lets two accounts import the same statement", async () => {
    await db
      .insert(transactions)
      .values(line({ userId: alice.id, externalId: "shared-line" }));

    await expect(
      db
        .insert(transactions)
        .values(line({ userId: bob.id, externalId: "shared-line" })),
    ).resolves.toBeDefined();
  });
});
