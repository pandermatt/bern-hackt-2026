"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import type { Facets, Filters } from "@/lib/insights";

/**
 * The only client component in the app. Filter state lives in the URL rather
 * than in React state, so a view is shareable, bookmarkable, and survives a
 * reload — and the transaction list stays on the server.
 *
 * Reads `useSearchParams`, so the caller has to wrap it in a `<Suspense>`
 * boundary; `components/flash-toaster.tsx` sets the same precedent.
 */

const CONTROL =
  "h-11 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[16px] text-text transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:h-9 sm:text-[13px]";

export function TransactionFilters({
  facets,
  filters,
}: {
  facets: Facets;
  filters: Filters;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    // An empty value means "no filter", and an empty query param would survive
    // in the URL and read as one.
    if (value) params.set(key, value);
    else params.delete(key);
    // A filter change narrows or widens the result set, so a remembered page
    // number no longer points at the same rows.
    params.delete("page");

    startTransition(() => {
      const query = params.toString();
      router.replace(query ? `/?${query}` : "/", { scroll: false });
    });
  }

  function toggleCategory(category: string) {
    const params = new URLSearchParams(searchParams);
    const selected = params.getAll("categories");
    const next = selected.includes(category)
      ? selected.filter((value) => value !== category)
      : [...selected, category];

    params.delete("categories");
    for (const value of next) params.append("categories", value);
    params.delete("page");

    startTransition(() => {
      const query = params.toString();
      router.replace(query ? `/?${query}` : "/", { scroll: false });
    });
  }

  const active = searchParams.toString().length > 0;

  return (
    <section
      className="card p-4"
      aria-label="Filter transactions"
      data-pending={pending ? "true" : undefined}
    >
      <div
        className={`grid gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${
          pending ? "opacity-60" : ""
        }`}
      >
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-text-muted">
            Search
          </span>
          <input
            type="search"
            className={CONTROL}
            placeholder="Merchant or description"
            defaultValue={filters.q ?? ""}
            // `key` forces a remount when the URL changes from elsewhere (a
            // breakdown link, the back button), so the box cannot go stale.
            key={`q-${filters.q ?? ""}`}
            onChange={(event) => update("q", event.target.value.trim())}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-text-muted">
            Account
          </span>
          <select
            className={CONTROL}
            value={filters.account ?? ""}
            onChange={(event) => update("account", event.target.value)}
          >
            <option value="">All accounts</option>
            {facets.accounts.map((account) => (
              <option key={account} value={account}>
                {account}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-text-muted">
            Merchant
          </span>
          <select
            className={CONTROL}
            value={filters.merchant ?? ""}
            onChange={(event) => update("merchant", event.target.value)}
          >
            <option value="">All merchants</option>
            {facets.merchants.map((merchant) => (
              <option key={merchant} value={merchant}>
                {merchant}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-text-muted">
            From
          </span>
          <input
            type="date"
            className={CONTROL}
            min={facets.first}
            max={facets.last}
            value={filters.from ?? ""}
            onChange={(event) => update("from", event.target.value)}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-text-muted">
            To
          </span>
          <input
            type="date"
            className={CONTROL}
            min={facets.first}
            max={facets.last}
            value={filters.to ?? ""}
            onChange={(event) => update("to", event.target.value)}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-text-muted">
            Direction
          </span>
          <select
            className={CONTROL}
            value={filters.kind ?? ""}
            onChange={(event) => update("kind", event.target.value)}
          >
            <option value="">In and out</option>
            <option value="expense">Money out</option>
            <option value="income">Money in</option>
          </select>
        </label>

        {/* Full-width: up to ~19 category chips need room to wrap, which a
            quarter-width grid cell does not have. */}
        <fieldset className="sm:col-span-2 lg:col-span-4">
          <legend className="mb-1.5 block text-[12px] font-medium text-text-muted">
            Categories
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {facets.categories.map((category) => {
              const checked = filters.categories?.includes(category) ?? false;
              return (
                <label
                  key={category}
                  className={`cursor-pointer rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors sm:px-2.5 sm:py-1 ${
                    checked
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line-strong bg-surface text-text-muted hover:bg-surface-muted"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => toggleCategory(category)}
                  />
                  {category}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex items-end justify-between gap-3 sm:col-span-2 lg:col-span-4">
          <label className="flex min-h-10 cursor-pointer items-center gap-2 pb-2 text-[13px] text-text sm:min-h-0">
            <input
              type="checkbox"
              className="size-5 accent-[var(--accent)] sm:size-4"
              checked={filters.includeTransfers}
              onChange={(event) =>
                update("includeTransfers", event.target.checked ? "true" : "")
              }
            />
            {/* Transfers move money between the owner's own accounts — counting
                them as spending double-counts every card purchase. */}
            Show transfers
          </label>

          {active && (
            <button
              type="button"
              onClick={() => startTransition(() => router.replace("/", { scroll: false }))}
              className="-mx-2 min-h-10 cursor-pointer px-2 pb-2 text-[13px] font-medium text-text-muted transition-colors hover:text-danger sm:mx-0 sm:min-h-0 sm:px-0"
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
