"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { useRouter } from "@/i18n/navigation";

/**
 * Which month the budget page is showing.
 *
 * State lives in the URL, like the dashboard's filters — a budget view is
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
}: {
  months: string[];
  month: string;
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
            router.replace(`/budget?${params.toString()}`, { scroll: false }),
          );
        }}
        className={`h-9 rounded-md border border-line-strong bg-surface px-2.5 font-mono text-[13px] text-text transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
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
