"use client";

import { ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useTransition, type ReactNode } from "react";

import { useRouter } from "@/i18n/navigation";
import { formatMoney, type Facets, type Filters } from "@/lib/insights";

/**
 * Two dropdowns, and nothing else.
 *
 * This replaced a seven-control grid — search, account, merchant, a date range,
 * direction, a row of category chips and a transfers toggle. The two that
 * survived are the two a statement is actually read by: which account, and
 * which way the money went.
 *
 * The others still work as URL parameters — `?categories=Housing` and
 * `?merchant=Coop` narrow the ledger exactly as they always did, and "Top
 * merchants" links to the second. What went away is the UI for setting them by
 * hand, not the filter. That is why **Clear** stays: without it a breakdown
 * link would be a one-way trip. (`?categories=` has no link pointing at it any
 * more, now that the category list is gone, but it is still a live filter and a
 * shareable URL.)
 *
 * Filter state lives in the URL rather than in React state, so a view is
 * shareable, bookmarkable and survives a reload. Reading `useSearchParams`
 * means the caller has to wrap this in a `<Suspense>` boundary.
 */

/**
 * A pill, matching the header's controls. `text-[16px]` below `sm` is not a
 * style choice — iOS Safari zooms the page when a focused control is set under
 * 16px. `appearance-none` drops the platform arrow so `Field` can draw one in
 * the accent instead.
 */
const CONTROL =
  "h-11 w-full cursor-pointer appearance-none truncate rounded-full border border-line-strong bg-surface pl-4 pr-10 text-[16px] font-medium text-text transition-colors hover:border-accent hover:bg-surface-muted focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:h-10 sm:text-[14px]";

/**
 * Banking's own words for the two directions. A statement calls them credits
 * and debits; "money in" and "money out" ride along in brackets so the term is
 * never the only thing carrying the meaning. The words themselves live in the
 * `Filters` namespace — only the query values are fixed here, because those are
 * what the URL carries and they must not change with the language.
 */
const DIRECTIONS = [
  { value: "", key: "all" },
  { value: "income", key: "credits" },
  { value: "expense", key: "debits" },
] as const;

/**
 * The arrow is a real element rather than a `background-image` data URI, so it
 * can wear `text-accent` and follow the theme — Blue Stone is `#005b61` on
 * white and `#4cc3cc` on the dark ground, and a colour baked into a URI would
 * be neither.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="min-w-[13rem] flex-1">
      <span className="mb-1.5 block pl-1 text-[12px] font-medium text-text-muted">
        {label}
      </span>
      <span className="relative block">
        {children}
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-accent"
        />
      </span>
    </label>
  );
}

export function TransactionFilters({
  facets,
  filters,
  accountTotals,
  anomalyLabel,
}: {
  facets: Facets;
  filters: Filters;
  /** Net movement per account, shown against each name in the dropdown. */
  accountTotals: Record<string, number>;
  /** What the active `?anomaly=` filter is called, when there is one. */
  anomalyLabel?: string | null;
}) {
  const t = useTranslations("Filters");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    // An empty value means "no filter", and an empty query param would survive
    // in the URL and read as one.
    if (value) params.set(key, value);
    else params.delete(key);

    startTransition(() => {
      // Through the locale-aware router, so changing a filter cannot drop the
      // language the way a bare `/?…` did.
      router.replace(
        { pathname: "/", query: Object.fromEntries(params) },
        { scroll: false },
      );
    });
  }

  // Counts filters set from anywhere, the breakdown links included — those have
  // no control here, so Clear is the only way back from one.
  const active = searchParams.toString().length > 0;

  /** "Privatkonto · CHF 12’450.30", with a real minus for a negative balance. */
  function accountLabel(account: string): string {
    const total = accountTotals[account];
    if (total === undefined) return account;
    return `${account} · ${total < 0 ? "−" : ""}${formatMoney(total)}`;
  }

  return (
    <section
      className={`flex flex-wrap items-end gap-3 transition-opacity ${
        pending ? "opacity-60" : ""
      }`}
      aria-label={t("sectionLabel")}
      data-pending={pending ? "true" : undefined}
    >
      <Field label={t("account")}>
        <select
          className={CONTROL}
          value={filters.account ?? ""}
          onChange={(event) => update("account", event.target.value)}
        >
          <option value="">{t("allAccounts")}</option>
          {facets.accounts.map((account) => (
            <option key={account} value={account}>
              {accountLabel(account)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("direction")}>
        <select
          className={CONTROL}
          value={filters.kind ?? ""}
          onChange={(event) => update("kind", event.target.value)}
        >
          {DIRECTIONS.map((direction) => (
            <option key={direction.value} value={direction.value}>
              {t(direction.key)}
            </option>
          ))}
        </select>
      </Field>

      {/* The one filter with no control of its own — it arrives from a link on
          /anomalies. It renders even when the label came back null (a rule id
          that matches nothing), because otherwise the ledger is empty with
          nothing on screen explaining why or offering a way out. */}
      {filters.anomaly && (
        <button
          type="button"
          onClick={() => update("anomaly", "")}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-accent bg-accent-soft pl-4 pr-3 text-[13px] font-medium text-accent transition-colors hover:bg-surface-muted"
        >
          <span className="truncate">{anomalyLabel ?? filters.anomaly}</span>
          <X aria-hidden className="size-3.5 shrink-0" />
          <span className="sr-only">{t("clear")}</span>
        </button>
      )}

      {active && (
        <button
          type="button"
          onClick={() =>
            startTransition(() => router.replace("/", { scroll: false }))
          }
          className="h-11 shrink-0 cursor-pointer rounded-full border border-line-strong bg-surface px-4 text-[14px] font-medium text-text-muted transition-colors hover:border-danger hover:text-danger sm:h-10"
        >
          {t("clear")}
        </button>
      )}
    </section>
  );
}
