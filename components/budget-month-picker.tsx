"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { useRouter } from "@/i18n/navigation";

/**
 * Which month a page is showing — the budget page originally, now shared with
 * `/savings` now that the pots moved to a page of their own. Both read the
 * same `?month=` shape and the same `getSavingsOverview`/`getBudgetOverview`
 * resolution rule, so `basePath` is the only thing that differs between them.
 *
 * State lives in the URL, like the dashboard's filters — a month view is
 * worth linking to, and the page stays server-rendered around it. Reads
 * `useSearchParams`, so the caller wraps it in a `<Suspense>` boundary.
 *
 * `useRouter` is the locale-aware one: `router.replace("/budget?…")` through
 * `next/navigation` navigates to an unprefixed path, and switching months
 * would quietly drop the reader back into the default language.
 */
export function BudgetMonthPicker({
  months,
  month,
  basePath = "/budget",
}: {
  months: string[];
  month: string;
  basePath?: string;
}) {
  const t = useTranslations("Budget");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2">
      <span className="text-[12.5px] font-medium text-text-muted">
        {t("month")}
      </span>
      <select
        value={month}
        disabled={pending}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams);
          params.set("month", event.target.value);
          startTransition(() =>
            router.replace(`${basePath}?${params.toString()}`, { scroll: false }),
          );
        }}
        className={`h-9 rounded-md border border-line-strong bg-surface px-2.5 font-mono text-[16px] sm:text-[13px] text-text transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          pending ? "opacity-60" : ""
        }`}
      >
        {[...months].reverse().map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </label>
  );
}
