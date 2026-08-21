import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { transactions, users, type NewTransaction, type User } from "@/db/schema";
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

const { getDashboard, listTransactions } = await import(
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

  it("reports page metadata for a result set that fits on one page", async () => {
    const dashboard = await getDashboard({});
    expect(dashboard?.page).toBe(1);
    expect(dashboard?.pageCount).toBe(1);
    // Total across every page, not just `transactions.length` — the same two
    // non-transfer rows the other assertions above see.
    expect(dashboard?.totalCount).toBe(2);
  });

  it("clamps an out-of-range page instead of leaving the list empty", async () => {
    const dashboard = await getDashboard({ page: "99" });
    expect(dashboard?.page).toBe(1);
    expect(dashboard?.transactions).toHaveLength(2);
  });

  it("does not let a malformed page wipe out the other filters", async () => {
    // Unlike `filterSchema`, which fails as one unit, `page` is parsed on its
    // own — a junk value degrades to page 1 without discarding `category`.
    const dashboard = await getDashboard({
      categories: "Housing",
      page: "not-a-number",
    });

    expect(dashboard?.page).toBe(1);
    expect(dashboard?.filters.categories).toEqual(["Housing"]);
    expect(dashboard?.transactions).toHaveLength(1);
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
